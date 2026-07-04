# Zalo API Gateway Implementation Plan

## Objective

Turn this fork into a standalone Zalo Personal API Gateway that can be used by Hermes, curl, n8n, webhooks, SSE clients, or other HTTP clients.

The gateway must stay agent-agnostic. Hermes integration must live outside the gateway as a Hermes Zalo platform plugin that talks to this service through HTTP and an event stream. Hermes core must remain untouched.

## Target Architecture

```text
Zalo Personal Account
  <-> zca-js session/client
  <-> Zalo API Gateway HTTP server
       |-- HTTP API: send/read/action/policy/login
       |-- outbound webhooks: n8n, custom agents, legacy bridge
       `-- SSE /events: Hermes Zalo platform plugin and local subscribers
  <-> Hermes / n8n / curl / custom agent consumers
```

The long-term Hermes path is:

```text
Zalo Gateway Docker service
  <-> Hermes Zalo Platform Plugin in ~/.hermes/plugins/platforms/zalo/
  <-> Hermes Gateway / Agent sessions
```

The existing external Hermes bridge remains a legacy/fallback connector until the native plugin is available.

## Current Direction

This repository started from `monas-team/zaloclaw`, but it is no longer maintained as an OpenClaw channel plugin. The Zalo-specific code has been extracted into a gateway-owned runtime.

Current cleanup state:

- Package metadata is `zalo-api-gateway@0.1.0`.
- OpenClaw plugin manifest and runtime files are under `legacy/openclaw/` for reference only.
- `index.ts` exports Zalo-owned reusable logic/types instead of registering an OpenClaw plugin.
- `src/zalo/message-normalizer.ts` owns message normalization, dedup, and media ingestion guard logic.
- Gateway HTTP routes, webhook dispatch, policy enforcement, QR login, and curated actions are implemented.
- The current Hermes connector uses webhooks and Hermes CLI; it should be superseded by a Hermes platform plugin that subscribes to gateway events.
- `./init.sh`, `npm run typecheck`, and `npm test` pass.

## Non-Goals

- Do not edit Hermes core source code.
- Do not make the Zalo Gateway depend on Hermes, OpenClaw, or any single agent runtime.
- Do not require OpenClaw at runtime.
- Do not port all historical ZaloClaw actions in one pass.
- Do not expose unauthenticated mutating endpoints or unauthenticated event streams.
- Do not encourage primary-account production use.

## Phase 0 - Stabilize Harness And Baseline

Goal: make future coding sessions restartable and keep verification reliable.

Tasks:

1. Keep `AGENTS.md`, `feature_list.json`, `progress.md`, `session-handoff.md`, and `init.sh` current.
2. Keep OpenClaw-only code isolated under `legacy/openclaw/` unless a specific Zalo behavior is being ported.
3. Keep maintained runtime imports focused on `src/zalo/**`, `src/client/**`, gateway files, bridge/plugin files, and safe utility modules.
4. Run `./init.sh` after source or harness edits.

Exit criteria:

- Harness validator remains at least 85/100.
- `npm run typecheck` passes.
- `npm test` passes.
- Any OpenClaw references in maintained paths are intentional and documented.

Status: complete, but keep harness files aligned with each architecture change.

## Phase 1 - Gateway Skeleton

Goal: add a standalone HTTP service that does not require real Zalo login in tests.

Implemented files include:

- `src/gateway/server.ts` - HTTP server factory.
- `src/gateway/routes/health.ts` - health/version routes.
- `src/gateway/config.ts` - gateway config loader.
- `src/gateway/types.ts` - public API payload types.
- `src/gateway/auth.ts` - bearer token guard.
- `src/gateway/index.ts` - standalone entrypoint.
- `tests/gateway/health.test.ts` - route tests.

Initial API:

```http
GET /health
GET /version
```

Config keys:

```text
ZALO_GATEWAY_HOST=127.0.0.1
ZALO_GATEWAY_PORT=8787
ZALO_GATEWAY_TOKEN=required-for-api-access
ZALO_GATEWAY_WEBHOOKS=optional comma-separated URLs
```

Exit criteria:

- Server can be instantiated in tests without real Zalo login.
- `GET /health` returns service status and whether the Zalo client is connected.
- `GET /version` returns package/version/runtime info.
- Tests cover auth helper and health/version route shape.
- `./init.sh` passes.

Status: complete.

## Phase 2 - Zalo Client Boundary

Goal: wrap existing `zca-js` login/session/listener/send behavior behind a gateway-owned interface.

Implemented/target files:

- `src/gateway/zalo-client.ts` - interface and concrete adapter around existing client code.
- `src/gateway/zalo-client.mock.ts` - mock client for route tests.
- Reuse from `src/client/zalo-client.ts`, `src/client/credentials.ts`, `src/channel/send.ts`, and `src/zalo/message-normalizer.ts` where practical.

Interface sketch:

```ts
export interface GatewayZaloClient {
  status(): Promise<ZaloGatewayStatus>;
  sendText(input: SendTextInput): Promise<SendMessageResult>;
  onMessage(handler: (event: NormalizedZaloEvent) => void): Disposable;
}
```

Exit criteria:

- Gateway route code depends only on `GatewayZaloClient`.
- Unit tests can use a mocked client.
- Real `zca-js` credentials remain outside tests.
- `./init.sh` passes.

Status: complete for current gateway routes; extend as new actions are wired.

## Phase 3 - Messaging, Webhooks, And Policy MVP

Goal: support basic outbound send, inbound event forwarding, and gateway-side safety policy.

API:

```http
POST /messages/send
GET  /policy
PUT  /policy
POST /policy/allowed-senders
DELETE /policy/allowed-senders/:id
POST /policy/allowed-threads
DELETE /policy/allowed-threads/:id
```

Request:

```json
{
  "threadId": "zalo-thread-or-user-id",
  "isGroup": false,
  "text": "message text",
  "metadata": {
    "urgency": 0,
    "messageTtl": 0
  }
}
```

Inbound event shape:

```json
{
  "type": "message.created",
  "platform": "zalo",
  "threadId": "...",
  "messageId": "...",
  "senderId": "...",
  "senderName": "...",
  "chatType": "dm|group",
  "text": "...",
  "timestamp": 0,
  "raw": {}
}
```

Current fan-out behavior:

- Gateway dispatches allowed inbound events to every URL in `ZALO_GATEWAY_WEBHOOKS`.
- Webhook delivery uses `POST` with JSON body and optional bearer auth from `ZALO_GATEWAY_WEBHOOK_TOKEN`.
- Gateway denies inbound and outbound traffic outside allowlists before forwarding/sending.

Exit criteria:

- `POST /messages/send` requires bearer token.
- Route validates required fields and returns stable JSON errors.
- Webhook dispatcher sends normalized inbound events to configured URLs.
- Gateway-side policy covers inbound forwarding and outbound send-like actions.
- Tests cover success, validation failure, auth failure, policy failure, and webhook failure handling.
- `./init.sh` passes.

Status: complete for webhooks and policy.

## Phase 4 - Curated Action Registry

Goal: expose a small, stable action API that can later grow toward the historical ZaloClaw action set.

API:

```http
POST /actions/:action
```

Current action set:

- `send`
- `reply-message`
- `add-reaction`
- `get-thread-info`
- `get-group-members`
- `list-friends`
- `list-groups`
- `mark-read`
- `send-image`
- `send-file`
- `send-link`
- `send-video`
- `send-voice`

Implementation rules:

- Reuse validation and behavior from historical ZaloClaw code where practical.
- Keep action handlers independent from OpenClaw tool call signatures.
- Return `{ "ok": true, "data": ... }` or `{ "ok": false, "error": ... }` consistently.
- Apply outbound policy to send-like and mutating actions.

Exit criteria:

- Action registry has typed handler map.
- Tests cover each initial action with mocked Zalo client.
- Public docs list supported actions and explicitly say the remaining action surface is phased.
- `./init.sh` passes.

Status: complete for the current curated action set.

## Phase 5 - Legacy Hermes Webhook Bridge

Goal: keep a working Hermes path while the native plugin is built.

Implemented behavior:

```text
Zalo Gateway webhook
  -> src/bridge/hermes HTTP receiver
  -> Hermes CLI runner
  -> POST /messages/send back to Zalo Gateway
```

Status:

- Useful for smoke tests and deployments that do not need a native Hermes platform adapter yet.
- Should not be the final Hermes integration model.
- Must remain optional so the gateway can serve non-Hermes consumers.

Exit criteria:

- A Zalo message can trigger Hermes through webhook/adapter.
- Hermes reply can be sent back through `POST /messages/send`.
- No Hermes core files are modified.

Status: complete as legacy/fallback connector.

## Phase 6 - Gateway SSE Event Stream

Goal: add a pull-based event stream so native platform plugins and local agents can subscribe without exposing their own webhook server.

Target API:

```http
GET /events
Authorization: Bearer <ZALO_GATEWAY_TOKEN or dedicated stream token>
Accept: text/event-stream
```

Target behavior:

- Reuse the same normalized event shape used by webhooks.
- Apply the same gateway-side inbound policy before publishing to streams.
- Keep outbound webhooks working for n8n and generic consumers.
- Emit SSE records like:

```text
id: <monotonic-sequence-or-message-id>
event: message.created
data: {"type":"message.created","platform":"zalo",...}
```

- Emit heartbeat records to keep long-running connections alive.
- Maintain a small ring buffer and support `Last-Event-ID` replay if practical.
- Close subscriptions cleanly on server shutdown.

Proposed files:

- `src/gateway/events.ts` - event hub, subscriptions, ring buffer, SSE formatting.
- `src/gateway/routes/events.ts` - authenticated `GET /events` route.
- `tests/gateway/events.test.ts` - stream auth, event delivery, heartbeat/replay basics.

Exit criteria:

- Authenticated SSE clients receive allowed inbound events.
- Unauthorized clients are rejected.
- Webhook dispatch and SSE publishing share the same normalized event and policy decision.
- Tests cover at least one live stream delivery with a mocked Zalo client.
- `./init.sh` passes.

Status: complete for authenticated stream delivery, heartbeat support, and policy-shared fan-out. Replay support exists for records still in the in-memory ring buffer via `Last-Event-ID`.

## Phase 7 - Hermes Zalo Platform Plugin

Goal: replace the legacy Hermes CLI bridge with a Hermes platform plugin while keeping the Zalo Gateway independent.

Target layout:

```text
hermes-plugin/
  plugin.yaml
  __init__.py
  adapter.py
  client.py
  events.py
  README.md
```

Installed layout:

```text
~/.hermes/plugins/platforms/zalo/
```

Target plugin behavior:

- Register a Hermes platform named `zalo` with `ctx.register_platform(...)`.
- Connect to `GET /events` on the Zalo Gateway during platform start.
- Map Zalo `threadId` and `chatType` to Hermes gateway session keys.
- Dispatch inbound Zalo text to Hermes as a platform message.
- Send Hermes replies through `POST /messages/send`.
- Expose optional slash/CLI helpers for QR login, status, and policy management if Hermes plugin APIs allow it.
- Never import `zca-js` or own Zalo credentials; those remain inside the gateway.

Config/env:

```text
ZALO_GATEWAY_URL=http://127.0.0.1:8787
ZALO_GATEWAY_TOKEN=...
ZALO_PLATFORM_EVENT_MODE=sse
ZALO_PLATFORM_SESSION_PREFIX=zalo
```

Exit criteria:

- Plugin can be installed/enabled without modifying Hermes core.
- Hermes receives Zalo messages through gateway SSE.
- Hermes replies are sent back through gateway HTTP API.
- Legacy webhook bridge remains available but docs mark the plugin as the preferred Hermes path.
- A smoke test path is documented using a secondary Zalo account or mocked gateway events.

Status: initial plugin implemented in `hermes-plugin/`; needs live Hermes gateway smoke testing against a running Zalo API Gateway.

## Verification Matrix

| Phase | Required verification |
|---|---|
| 0 | `./init.sh`, harness validator |
| 1 | gateway health tests, `./init.sh` |
| 2 | mocked client tests, `./init.sh` |
| 3 | route/auth/webhook/policy tests, `./init.sh` |
| 4 | action registry tests, `./init.sh` |
| 5 | local webhook bridge smoke test with mocked or secondary Zalo account |
| 6 | SSE stream tests, webhook regression tests, `./init.sh` |
| 7 | plugin install/load smoke test and mocked gateway event flow |

## Current Known Risks

- Zalo personal account automation is unofficial and may break when Zalo changes web behavior.
- Real Zalo testing should use a secondary account only.
- `npm install` currently reports vulnerabilities; review dependency impact before running automatic audit fixes.
- Hermes platform plugin API details must be checked against Hermes built-in platform adapters before implementation.
- SSE replay needs careful bounds so slow subscribers do not create unbounded memory usage.
- Old docs may still mention the legacy bridge as the primary Hermes path until fully updated.
