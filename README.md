# Zalo API Gateway

Standalone HTTP API gateway for Zalo personal accounts, built from the useful Zalo-specific parts of `monas-team/zaloclaw` and refocused away from the OpenClaw plugin runtime.

The gateway owns the Zalo login/session, exposes local HTTP endpoints, and dispatches inbound Zalo messages to webhooks. Hermes, curl, n8n, or any custom app should connect to the gateway instead of talking directly to Zalo.

## Current Status

Working now:

- `npm run gateway` starts the HTTP gateway.
- Gateway listens on `http://127.0.0.1:8787` by default.
- Zalo personal login/session can be managed with the existing CLI helpers.
- Inbound Zalo messages can be received by the gateway.
- Outbound Zalo text messages can be sent through HTTP.
- Gateway can dispatch inbound events to configured webhooks.
- Typecheck/tests pass through `./init.sh`.

Known gaps:

- Logs are still basic and should be structured before production use.
- Auto-reply/bridge consumers must be allowlisted before being trusted.
- Webhook delivery currently retries only by the caller behavior; failed deliveries are logged but not queued durably.
- Some action endpoints are placeholders until the `zca-js` adapter supports them.

## Architecture

```text
Zalo personal account
  <-> zca-js session/client
  <-> Zalo API Gateway HTTP server
  <-> Hermes bridge / curl / n8n / custom webhook consumers
```

Important rule: the gateway is the only component that talks to Zalo. Hermes and other agents should only call the gateway or receive gateway webhooks.

## Requirements

- Node.js >= 22
- npm
- A secondary Zalo personal account for testing

Do not use a primary Zalo account. Zalo personal automation is unofficial and reverse-engineered through `zca-js`; behavior can break and accounts can be checkpointed or locked.

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and replace placeholder tokens. Never commit real cookies, IMEI, QR payloads, API tokens, webhook secrets, user IDs, or group IDs.

## Environment

Gateway:

```bash
ZALO_GATEWAY_DATA_DIR=./run
ZALO_GATEWAY_HOST=127.0.0.1
ZALO_GATEWAY_PORT=8787
ZALO_GATEWAY_TOKEN=change-me-gateway-token
```

Webhook dispatch:

```bash
ZALO_GATEWAY_WEBHOOKS=http://127.0.0.1:8790/webhooks/zalo
ZALO_GATEWAY_WEBHOOK_TOKEN=change-me-bridge-token
```

Hermes bridge, if used:

```bash
HERMES_BRIDGE_HOST=127.0.0.1
HERMES_BRIDGE_PORT=8790
HERMES_BRIDGE_TOKEN=change-me-bridge-token
HERMES_CLI=hermes
HERMES_SESSION_PREFIX=zalo
HERMES_TIMEOUT_MS=120000
ZALO_GATEWAY_URL=http://127.0.0.1:8787
```

Current allowlist fields are bridge-side placeholders:

```bash
HERMES_BRIDGE_ALLOWED_SENDERS=
HERMES_BRIDGE_ALLOWED_THREADS=
```

Use comma-separated Zalo sender IDs/thread IDs once allowlist enforcement is implemented. Until then, do not connect a real auto-reply agent to broad inbound traffic.

## Login And Status

Run Zalo login:

```bash
npm run zalo:login
```

Check stored login/session status:

```bash
npm run zalo:status
```

Stored credentials should live under the runtime data directory. Treat them as secrets.

## Run Gateway

```bash
npm run gateway
```

Expected startup log:

```text
[zalo-api-gateway] listening on http://127.0.0.1:8787
```

If you see repeated lines like this:

```text
[zalo-api-gateway] webhook delivery failed url=http://127.0.0.1:8790/webhooks/zalo error=Webhook dispatch timed out
```

it means `ZALO_GATEWAY_WEBHOOKS` points to a receiver that is not responding. Either start the receiver, fix the URL/port, or temporarily clear `ZALO_GATEWAY_WEBHOOKS` while testing the gateway alone.

## API

Public status endpoints:

```http
GET /health
GET /version
```

Authenticated endpoints require:

```http
Authorization: Bearer <ZALO_GATEWAY_TOKEN>
```

Available endpoints now:

```http
POST /messages/send
GET  /friends
GET  /groups
GET  /groups/:groupId/members
GET  /policy
PUT  /policy
POST /policy/allowed-senders
DELETE /policy/allowed-senders/:id
POST /policy/allowed-threads
DELETE /policy/allowed-threads/:id
POST /actions/:action
```

Supported action names:

```text
send
reply-message
add-reaction
get-thread-info
get-group-members
list-friends
list-groups
mark-read
send-image
send-file
send-link
send-video
send-voice
delete-message
undo-message
forward-message
find-user
find-user-by-username
get-user-info
check-friend-status
get-group-info
get-group-members-info
get-group-link
mute-conversation
mark-unread
pin-conversation
```

`send-voice` is wired through `zca-js`; other newly registered media/management actions may still return `502` with `not implemented` until the adapter call is wired.

## Curl Examples

Health:

```bash
curl http://127.0.0.1:8787/health
```

Version:

```bash
curl http://127.0.0.1:8787/version
```

Send a direct message:

```bash
curl -X POST http://127.0.0.1:8787/messages/send \
  -H 'Authorization: Bearer change-me-gateway-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "threadId": "[REDACTED_USER_ID]",
    "isGroup": false,
    "text": "Xin chao tu Zalo API Gateway"
  }'
```

Send a group message:

```bash
curl -X POST http://127.0.0.1:8787/messages/send \
  -H 'Authorization: Bearer change-me-gateway-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "threadId": "[REDACTED_GROUP_ID]",
    "isGroup": true,
    "text": "Gateway test"
  }'
```

List friends:

```bash
curl 'http://127.0.0.1:8787/friends?count=20&page=1' \
  -H 'Authorization: Bearer change-me-gateway-token'
```

List groups:

```bash
curl http://127.0.0.1:8787/groups \
  -H 'Authorization: Bearer change-me-gateway-token'
```

Use generic action endpoint:

```bash
curl -X POST http://127.0.0.1:8787/actions/get-thread-info \
  -H 'Authorization: Bearer change-me-gateway-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "threadId": "[REDACTED_GROUP_ID]",
    "isGroup": true
  }'
```

## Inbound Webhooks

When the gateway receives a Zalo message, it dispatches an event to every URL in `ZALO_GATEWAY_WEBHOOKS`.

Payload shape:

```json
{
  "type": "message.created",
  "platform": "zalo",
  "threadId": "[REDACTED_THREAD_ID]",
  "messageId": "[REDACTED_MESSAGE_ID]",
  "senderId": "[REDACTED_SENDER_ID]",
  "senderName": "Sender Name",
  "chatType": "dm",
  "text": "hello",
  "timestamp": 1710000000000
}
```

Webhook auth header when `ZALO_GATEWAY_WEBHOOK_TOKEN` is set:

```http
Authorization: Bearer <ZALO_GATEWAY_WEBHOOK_TOKEN>
```

The current dispatcher times out after 10 seconds. A timeout usually means the receiver is missing, blocked, slow, or listening on a different port.

## Allowlist Requirement

The gateway is already able to receive messages and send replies. That is powerful and dangerous if connected to an agent without restrictions.

Before enabling auto-reply, enforce allowlists for both inbound and outbound paths:

```bash
# gateway-side config
ZALO_GATEWAY_ALLOWED_SENDERS=[REDACTED_USER_ID],[REDACTED_USER_ID]
ZALO_GATEWAY_ALLOWED_THREADS=[REDACTED_THREAD_ID],[REDACTED_GROUP_ID]
ZALO_GATEWAY_DENY_SENDERS=
ZALO_GATEWAY_DENY_THREADS=
```

The allowlist can also be managed at runtime by authenticated API clients, so an external agent can choose which users/groups are active without editing gateway env:

```bash
curl -X PUT http://127.0.0.1:8787/policy \
  -H "authorization: Bearer $ZALO_GATEWAY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"allowedSenders":["[REDACTED_USER_ID]"],"allowedThreads":["[REDACTED_GROUP_ID]"]}'
```

Implemented policy:

- Direct messages: inbound allow checks `senderId`; outbound DM sends check the target `threadId` against `ZALO_GATEWAY_ALLOWED_SENDERS`.
- Groups: allow only when the group/thread ID is in `ZALO_GATEWAY_ALLOWED_THREADS`.
- Denylist wins over allowlist.
- Drop unauthorized inbound events before webhook dispatch.
- Reject unauthorized outbound `POST /messages/send` and send-like actions (`send`, `reply-message`, `add-reaction`, `mark-read`) with `403`.
- Log allowed/blocked decisions without leaking message content by default.

## Logging Plan

Current logs are plain text. The next logging cleanup should standardize event names and include correlation fields:

```text
[zalo-api-gateway] event=gateway.listen host=127.0.0.1 port=8787
[zalo-api-gateway] event=zalo.message.received chatType=dm threadId=[REDACTED] senderId=[REDACTED]
[zalo-api-gateway] event=webhook.delivery.failed url=http://127.0.0.1:8790/webhooks/zalo error="Webhook dispatch timed out"
[zalo-api-gateway] event=policy.inbound.blocked reason=sender_not_allowed threadId=[REDACTED] senderId=[REDACTED]
[zalo-api-gateway] event=message.send.success threadId=[REDACTED] messageId=[REDACTED]
```

Recommended fields:

- `event`
- `requestId` or `messageId`
- `threadId`
- `senderId`
- `chatType`
- `targetUrl` for webhooks
- `durationMs`
- `status` or `error`

Do not log full message text, cookies, tokens, QR payloads, or raw Zalo credentials unless explicitly debugging in a private environment.

## Development Verification

Canonical verification:

```bash
./init.sh
```

Equivalent commands:

```bash
npm run typecheck
npm test
```

Build commands:

```bash
npm run gateway:build
npm run build
```

## Project Layout

```text
src/gateway/              HTTP gateway, routes, webhook dispatcher, zca-js adapter
src/zalo/                 Zalo-owned reusable normalization logic
src/client/               Existing zca-js credential/client helpers
src/channel/              Send/thread helpers still being migrated
src/bridge/hermes/        Optional Hermes bridge
legacy/openclaw/          Old OpenClaw plugin code, reference only
docs/GATEWAY_PLAN.md      Implementation plan
AGENTS.md                 Harness instructions
feature_list.json         Phase tracker
progress.md               Current progress and verification notes
session-handoff.md        Restart/handoff state
```

## Relationship To ZaloClaw

This project started from `monas-team/zaloclaw` because it already contains useful Zalo personal-account capabilities and tests. The maintained direction here is different:

- Not an OpenClaw plugin runtime.
- Not tied to OpenClaw channel/tool contracts.
- HTTP/webhook gateway first.
- Hermes integration later as a client or bridge, not a Hermes core patch.

## License

MIT. Preserve upstream attribution from `monas-team/zaloclaw` when reusing or porting code.
