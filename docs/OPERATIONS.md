# Zalo Gateway Operations

## Runbook

Recommended production topology runs Zalo Gateway in Docker and Hermes connector on the host.

Build and run the standalone gateway:

```bash
npm run build:all
npm run gateway
```

Run the connector where Hermes CLI is available:

```bash
npm run connector:hermes
```

Expected log:

```text
[zalo-api-gateway] listening on http://127.0.0.1:8787
```

Check health:

```bash
curl http://127.0.0.1:8787/health
```

Check Zalo session:

```bash
npm run zalo:status
```

If the session is missing or expired:

```bash
npm run zalo:login
```

## Webhook Timeout Noise

Repeated log:

```text
[zalo-api-gateway] webhook delivery failed url=http://127.0.0.1:8790/webhooks/zalo error=Webhook dispatch timed out
```

Meaning: the gateway is receiving Zalo events and trying to POST them to the configured webhook, but that receiver does not answer within 10 seconds.

Fix options:

1. Start the bridge/receiver on `127.0.0.1:8790`.
2. Change `ZALO_GATEWAY_WEBHOOKS` to the correct receiver URL.
3. Clear `ZALO_GATEWAY_WEBHOOKS` while testing the gateway without a bridge.
4. Increase timeout later only after confirming the receiver is healthy.

Do not ignore this in agent mode. If webhooks time out, the bridge may process slowly, duplicate work, or miss replies depending on the consumer.

## Immediate Safety Rule

The gateway can currently receive any inbound Zalo message and dispatch it to the bridge if webhooks are configured. If the bridge auto-replies, every user/group that reaches this Zalo account can trigger replies.

Until gateway-side allowlists are implemented:

- Keep `ZALO_GATEWAY_WEBHOOKS` empty during broad testing.
- Or enforce allowlists in the bridge using `HERMES_BRIDGE_ALLOWED_SENDERS` and `HERMES_BRIDGE_ALLOWED_THREADS` if the bridge supports them.
- Use a secondary Zalo account.
- Test only in a private group or known DM.

## Required Allowlist Behavior

Gateway-side allowlist must be added before broad auto-reply use.

Config:

```bash
ZALO_GATEWAY_ALLOWED_SENDERS=[REDACTED_USER_ID],[REDACTED_USER_ID]
ZALO_GATEWAY_ALLOWED_THREADS=[REDACTED_THREAD_ID],[REDACTED_GROUP_ID]
ZALO_GATEWAY_DENY_SENDERS=
ZALO_GATEWAY_DENY_THREADS=
```

Runtime API for external controllers/agents:

```bash
GET /policy
PUT /policy
POST /policy/allowed-senders
DELETE /policy/allowed-senders/:id
POST /policy/allowed-threads
DELETE /policy/allowed-threads/:id
```

`PUT /policy` replaces the policy JSON persisted under `ZALO_GATEWAY_DATA_DIR/gateway-policy.json`, so an agent can choose allowed users/groups without editing gateway env.

Inbound policy:

- If deny sender/thread matches, drop event.
- If gateway-side allowlists are configured but empty, default is safe mode: no auto-forward to agent.
- Direct messages require `senderId` in `ZALO_GATEWAY_ALLOWED_SENDERS`.
- Group messages require `threadId`/group ID in `ZALO_GATEWAY_ALLOWED_THREADS`.
- Log `policy.inbound.allowed` or `policy.inbound.blocked` without message text.

Outbound policy:

- `POST /messages/send` and send-like action routes (`send`, `reply-message`, `add-reaction`, `mark-read`) check the target before sending/mutating.
- DM sends require target `threadId` in `ZALO_GATEWAY_ALLOWED_SENDERS`.
- Group sends require target `threadId`/group ID in `ZALO_GATEWAY_ALLOWED_THREADS`.
- Denylist wins.
- Non-allowed target returns `403`.

## Logging Standard

Use stable event names and redacted identifiers:

```text
[zalo-api-gateway] event=gateway.listen host=127.0.0.1 port=8787
[zalo-api-gateway] event=zalo.message.received chatType=dm threadId=[REDACTED] senderId=[REDACTED]
[zalo-api-gateway] event=policy.inbound.allowed threadId=[REDACTED] senderId=[REDACTED]
[zalo-api-gateway] event=policy.inbound.blocked reason=sender_not_allowed threadId=[REDACTED] senderId=[REDACTED]
[zalo-api-gateway] event=webhook.delivery.failed targetUrl=http://127.0.0.1:8790/webhooks/zalo error="Webhook dispatch timed out" durationMs=10000
[zalo-api-gateway] event=message.send.success threadId=[REDACTED] messageId=[REDACTED]
```

Do not log:

- Full message text by default.
- Zalo cookies.
- IMEI.
- User agent secrets.
- Bearer tokens.
- QR payloads.
- Raw credentials.

## Pre-Agent Checklist

Before connecting Hermes or any auto-reply agent:

- `npm run zalo:status` shows authenticated.
- `curl /health` works.
- `ZALO_GATEWAY_WEBHOOKS` points to a real receiver.
- The receiver responds quickly.
- Allowed users/groups are configured.
- Unknown users/groups are blocked.
- Logs show policy decisions.
- A manual `POST /messages/send` to an allowed test thread works.
- A manual `POST /messages/send` or `POST /actions/send` to a blocked test target returns `403`.
