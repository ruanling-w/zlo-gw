"""Zalo platform adapter for Hermes Agent.

This plugin intentionally keeps Zalo automation outside Hermes. A standalone
Zalo API Gateway owns zca-js, QR login, credentials, gateway-side policy, and
Zalo session lifecycle. The adapter only subscribes to the gateway SSE stream
and sends Hermes replies back through the gateway HTTP API.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

try:
    import httpx

    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)

logger = logging.getLogger(__name__)

DEFAULT_GATEWAY_URL = "http://127.0.0.1:8787"
RECONNECT_BACKOFF = [2, 5, 10, 30, 60]
STREAM_READ_TIMEOUT_SECONDS = 120.0
SEND_TIMEOUT_SECONDS = 30.0
MAX_MESSAGE_LENGTH = 4000


class _FatalStreamError(Exception):
    """Raised for unrecoverable stream errors such as authorization failure."""


def _truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _normalise_base_url(value: str) -> str:
    raw = (value or DEFAULT_GATEWAY_URL).strip() or DEFAULT_GATEWAY_URL
    return raw.rstrip("/")


def _auth_header(token: str) -> Dict[str, str]:
    token = (token or "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _event_timestamp(value: Any) -> datetime:
    try:
        if value is None:
            raise ValueError("missing timestamp")
        numeric = float(value)
        if numeric > 10_000_000_000:
            numeric = numeric / 1000.0
        return datetime.fromtimestamp(numeric, tz=timezone.utc)
    except Exception:
        return datetime.now(tz=timezone.utc)


def _event_data(record: Dict[str, Any]) -> Dict[str, Any]:
    data = record.get("data")
    if isinstance(data, dict):
        return data
    return record


def _event_id(record: Dict[str, Any], data: Dict[str, Any]) -> str:
    return str(record.get("id") or data.get("messageId") or uuid.uuid4().hex)


def _chat_type(data: Dict[str, Any]) -> str:
    return "group" if data.get("chatType") == "group" else "dm"


def _normalise_attachment_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"voice", "audio"}:
        return "audio/mpeg"
    if raw == "image":
        return "image/jpeg"
    if raw == "video":
        return "video/mp4"
    if raw == "file":
        return "application/octet-stream"
    if "/" in raw:
        return raw
    return "application/octet-stream"


def _message_type_for_attachments(attachments: List[Dict[str, Any]]) -> MessageType:
    if not attachments:
        return MessageType.TEXT
    first_type = str(attachments[0].get("type") or "").lower()
    if first_type == "voice":
        return MessageType.VOICE
    if first_type == "audio":
        return MessageType.AUDIO
    if first_type == "image":
        return MessageType.PHOTO
    if first_type == "video":
        return MessageType.VIDEO
    if first_type == "sticker":
        return MessageType.STICKER
    return MessageType.DOCUMENT


def check_requirements() -> bool:
    """Return True when dependencies and minimum gateway config are present."""
    return HTTPX_AVAILABLE and bool(os.getenv("ZALO_GATEWAY_URL", "").strip())


def validate_config(config) -> bool:
    extra = getattr(config, "extra", {}) or {}
    return bool(extra.get("gateway_url") or os.getenv("ZALO_GATEWAY_URL", "").strip())


def is_connected(config) -> bool:
    return validate_config(config)


class ZaloPlatformAdapter(BasePlatformAdapter):
    """Hermes platform adapter backed by the standalone Zalo API Gateway."""

    MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH
    supports_code_blocks = False
    splits_long_messages = True

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform("zalo"))
        extra = config.extra or {}
        self._gateway_url = _normalise_base_url(
            extra.get("gateway_url") or os.getenv("ZALO_GATEWAY_URL", DEFAULT_GATEWAY_URL)
        )
        self._api_token = (
            extra.get("token")
            or os.getenv("ZALO_GATEWAY_TOKEN", "")
        ).strip()
        self._events_token = (
            extra.get("events_token")
            or os.getenv("ZALO_GATEWAY_EVENTS_TOKEN", "")
            or self._api_token
        ).strip()
        self._last_event_id = str(extra.get("last_event_id") or "").strip()
        self._stream_task: Optional[asyncio.Task] = None
        self._http_client: Optional["httpx.AsyncClient"] = None
        self._seen_messages: Dict[str, float] = {}

    @property
    def name(self) -> str:
        return "Zalo"

    @property
    def authorization_is_upstream(self) -> bool:
        """Gateway policy API is the Zalo trust boundary for this adapter."""
        return True

    async def connect(self) -> bool:
        if not HTTPX_AVAILABLE:
            logger.warning("[%s] httpx not installed. Run: pip install httpx", self.name)
            return False
        if not self._gateway_url:
            logger.warning("[%s] ZALO_GATEWAY_URL not configured", self.name)
            return False
        try:
            self._http_client = httpx.AsyncClient(timeout=None)
            self._stream_task = asyncio.create_task(self._run_event_stream())
            self._mark_connected()
            logger.info("[%s] Connected to Zalo Gateway SSE at %s/events", self.name, self._gateway_url)
            return True
        except Exception as exc:
            logger.error("[%s] Failed to connect: %s", self.name, exc)
            return False

    async def disconnect(self) -> None:
        self._running = False
        self._mark_disconnected()
        if self._stream_task:
            self._stream_task.cancel()
            try:
                await self._stream_task
            except asyncio.CancelledError:
                pass
            self._stream_task = None
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self._seen_messages.clear()
        logger.info("[%s] Disconnected", self.name)

    async def _run_event_stream(self) -> None:
        backoff_idx = 0
        while self._running:
            stream_start = time.monotonic()
            try:
                await self._consume_event_stream()
            except asyncio.CancelledError:
                return
            except _FatalStreamError:
                self._running = False
                return
            except Exception as exc:
                if not self._running:
                    return
                logger.warning("[%s] Event stream error: %s", self.name, exc)

            if not self._running:
                return
            if time.monotonic() - stream_start >= 60.0:
                backoff_idx = 0
            delay = RECONNECT_BACKOFF[min(backoff_idx, len(RECONNECT_BACKOFF) - 1)]
            logger.info("[%s] Reconnecting Zalo event stream in %ds", self.name, delay)
            await asyncio.sleep(delay)
            backoff_idx += 1

    async def _consume_event_stream(self) -> None:
        assert self._http_client is not None
        url = urljoin(f"{self._gateway_url}/", "events")
        headers = {"Accept": "text/event-stream", **_auth_header(self._events_token)}
        if self._last_event_id:
            headers["Last-Event-ID"] = self._last_event_id

        async with self._http_client.stream(
            "GET",
            url,
            headers=headers,
            timeout=httpx.Timeout(connect=15.0, read=STREAM_READ_TIMEOUT_SECONDS, write=15.0, pool=15.0),
        ) as response:
            if response.status_code in {401, 403}:
                self._set_fatal_error(
                    "zalo_gateway_unauthorized",
                    "Zalo Gateway rejected event stream auth. Check ZALO_GATEWAY_EVENTS_TOKEN or ZALO_GATEWAY_TOKEN.",
                    retryable=False,
                )
                raise _FatalStreamError(f"HTTP {response.status_code}")
            response.raise_for_status()
            async for record in self._iter_sse_records(response):
                if not self._running:
                    return
                await self._handle_sse_record(record)

    async def _iter_sse_records(self, response) -> Any:
        event_name = "message"
        event_id = ""
        data_lines: List[str] = []
        async for raw_line in response.aiter_lines():
            line = raw_line.rstrip("\r")
            if line == "":
                if data_lines:
                    payload = "\n".join(data_lines)
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        data = {"raw": payload}
                    record = {"event": event_name, "data": data}
                    if event_id:
                        record["id"] = event_id
                    yield record
                event_name = "message"
                event_id = ""
                data_lines = []
                continue
            if line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            if value.startswith(" "):
                value = value[1:]
            if field == "event":
                event_name = value
            elif field == "id":
                event_id = value
            elif field == "data":
                data_lines.append(value)

    async def _handle_sse_record(self, record: Dict[str, Any]) -> None:
        event_name = str(record.get("event") or "message")
        if event_name == "heartbeat":
            if record.get("id"):
                self._last_event_id = str(record["id"])
            return
        data = _event_data(record)
        if data.get("type") != "message.created":
            return
        msg_id = _event_id(record, data)
        self._last_event_id = msg_id
        if self._is_duplicate(msg_id):
            return
        text = str(data.get("text") or "").strip()
        attachments = [item for item in data.get("attachments") or [] if isinstance(item, dict)]
        if not text and not attachments:
            return
        chat_id = str(data.get("threadId") or "").strip()
        sender_id = str(data.get("senderId") or "").strip()
        if not chat_id or not sender_id:
            logger.debug("[%s] Dropping malformed Zalo event without threadId/senderId", self.name)
            return

        media_urls = [str(item.get("url")).strip() for item in attachments if item.get("url")]
        media_types = [_normalise_attachment_type(item.get("type")) for item in attachments if item.get("url")]
        chat_type = _chat_type(data)
        source = self.build_source(
            chat_id=chat_id,
            chat_name=str(data.get("threadName") or chat_id),
            chat_type=chat_type,
            user_id=sender_id,
            user_name=str(data.get("senderName") or sender_id),
            thread_id=chat_id if chat_type == "group" else None,
            message_id=msg_id,
        )
        message_event = MessageEvent(
            text=text,
            message_type=_message_type_for_attachments(attachments),
            source=source,
            raw_message=data,
            message_id=msg_id,
            media_urls=media_urls,
            media_types=media_types,
            timestamp=_event_timestamp(data.get("timestamp")),
        )
        await self.handle_message(message_event)

    def _is_duplicate(self, msg_id: str) -> bool:
        now = time.time()
        if len(self._seen_messages) > 1000:
            cutoff = now - 300
            self._seen_messages = {k: v for k, v in self._seen_messages.items() if v > cutoff}
        if msg_id in self._seen_messages:
            return True
        self._seen_messages[msg_id] = now
        return False

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        if not self._http_client:
            return SendResult(success=False, error="HTTP client not initialized")
        metadata = metadata or {}
        is_group = bool(metadata.get("isGroup")) or bool(metadata.get("is_group"))
        if metadata.get("chat_type") == "group" or metadata.get("thread_id"):
            is_group = True
        headers = {"Content-Type": "application/json", **_auth_header(self._api_token)}
        url = urljoin(f"{self._gateway_url}/", "messages/send")
        chunks = self.truncate_message(content, self.MAX_MESSAGE_LENGTH)
        message_ids: List[str] = []
        for chunk in chunks:
            payload = {"threadId": chat_id, "isGroup": is_group, "text": chunk}
            if reply_to:
                payload["replyToMessageId"] = reply_to
            try:
                resp = await self._http_client.post(url, json=payload, headers=headers, timeout=SEND_TIMEOUT_SECONDS)
            except Exception as exc:
                logger.error("[%s] Send error: %s", self.name, exc)
                return SendResult(success=False, error=str(exc))
            if resp.status_code >= 300:
                return SendResult(success=False, error=f"HTTP {resp.status_code}: {resp.text[:200]}")
            try:
                data = resp.json()
            except Exception:
                data = {}
            message_ids.append(str(data.get("messageId") or data.get("id") or uuid.uuid4().hex[:12]))
        return SendResult(
            success=True,
            message_id=message_ids[-1] if message_ids else None,
            continuation_message_ids=tuple(message_ids[:-1]),
        )

    async def send_voice(
        self,
        chat_id: str,
        audio_path: str,
        caption: Optional[str] = None,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **_kwargs,
    ) -> SendResult:
        if not self._http_client:
            return SendResult(success=False, error="HTTP client not initialized")
        if not os.path.isfile(audio_path):
            return SendResult(success=False, error=f"Voice file not found: {audio_path}")

        metadata = metadata or {}
        is_group = bool(metadata.get("isGroup")) or bool(metadata.get("is_group"))
        if metadata.get("chat_type") == "group" or metadata.get("thread_id"):
            is_group = True
        headers = {"Content-Type": "application/json", **_auth_header(self._api_token)}
        url = urljoin(f"{self._gateway_url}/", "actions/send-voice")
        voice_url = audio_path
        if not voice_url.startswith("file://"):
            voice_url = f"file://{os.path.abspath(voice_url)}"
        payload = {"threadId": chat_id, "isGroup": is_group, "voiceUrl": voice_url}
        try:
            resp = await self._http_client.post(url, json=payload, headers=headers, timeout=SEND_TIMEOUT_SECONDS)
        except Exception as exc:
            logger.error("[%s] Send voice error: %s", self.name, exc)
            return SendResult(success=False, error=str(exc))
        if resp.status_code >= 300:
            return SendResult(success=False, error=f"HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            data = resp.json()
        except Exception:
            data = {}
        result_data = data.get("data") if isinstance(data.get("data"), dict) else data
        message_id = result_data.get("messageId") if isinstance(result_data, dict) else None
        return SendResult(
            success=True,
            message_id=str(message_id or data.get("messageId") or uuid.uuid4().hex[:12]),
        )

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {"name": chat_id, "type": "group" if str(chat_id).startswith("group") else "dm"}


def _env_enablement() -> Optional[dict]:
    gateway_url = os.getenv("ZALO_GATEWAY_URL", "").strip()
    if not gateway_url:
        return None
    seed: dict = {"gateway_url": _normalise_base_url(gateway_url)}
    token = os.getenv("ZALO_GATEWAY_TOKEN", "").strip()
    if token:
        seed["token"] = token
    events_token = os.getenv("ZALO_GATEWAY_EVENTS_TOKEN", "").strip()
    if events_token:
        seed["events_token"] = events_token
    home = os.getenv("ZALO_HOME_CHANNEL", "").strip()
    if home:
        seed["home_channel"] = {
            "chat_id": home,
            "name": os.getenv("ZALO_HOME_CHANNEL_NAME", home),
        }
    return seed


async def _standalone_send(
    pconfig,
    chat_id: str,
    message: str,
    *,
    thread_id: Optional[str] = None,
    media_files: Optional[List[str]] = None,
    force_document: bool = False,
) -> Dict[str, Any]:
    if not HTTPX_AVAILABLE:
        return {"error": "zalo standalone send: httpx not installed"}
    extra = getattr(pconfig, "extra", {}) or {}
    gateway_url = _normalise_base_url(extra.get("gateway_url") or os.getenv("ZALO_GATEWAY_URL", DEFAULT_GATEWAY_URL))
    token = (extra.get("token") or os.getenv("ZALO_GATEWAY_TOKEN", "")).strip()
    target = thread_id or chat_id
    if not target:
        return {"error": "zalo standalone send: chat_id is required"}
    payload = {"threadId": target, "isGroup": bool(thread_id), "text": message[:MAX_MESSAGE_LENGTH]}
    headers = {"Content-Type": "application/json", **_auth_header(token)}
    try:
        async with httpx.AsyncClient(timeout=SEND_TIMEOUT_SECONDS) as client:
            resp = await client.post(urljoin(f"{gateway_url}/", "messages/send"), json=payload, headers=headers)
        if resp.status_code >= 300:
            return {"error": f"zalo HTTP {resp.status_code}: {resp.text[:200]}"}
        try:
            data = resp.json()
        except Exception:
            data = {}
        return {
            "success": True,
            "platform": "zalo",
            "chat_id": target,
            "message_id": data.get("messageId") or data.get("id") or uuid.uuid4().hex[:12],
        }
    except Exception as exc:
        return {"error": f"zalo standalone send failed: {exc}"}


def register(ctx) -> None:
    """Plugin entry point called by the Hermes plugin system."""
    ctx.register_platform(
        name="zalo",
        label="Zalo",
        adapter_factory=lambda cfg: ZaloPlatformAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=["ZALO_GATEWAY_URL"],
        install_hint="pip install httpx   # already a Hermes dependency",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="ZALO_HOME_CHANNEL",
        standalone_sender_fn=_standalone_send,
        max_message_length=MAX_MESSAGE_LENGTH,
        emoji="💬",
        pii_safe=True,
        allow_update_command=True,
        platform_hint=(
            "You are communicating via Zalo through a standalone Zalo API Gateway. "
            "Use plain text by default, keep replies concise, and avoid assuming "
            "Zalo supports rich Markdown rendering."
        ),
    )
