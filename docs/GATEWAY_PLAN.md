# Zalo API Gateway Implementation Plan

## Objective

Turn this fork into a standalone Zalo Personal API Gateway that can be used by Hermes, curl, n8n, webhooks, or other HTTP clients.

The gateway must keep Hermes core untouched. Hermes integration is a later thin adapter/client that talks to this service through HTTP and webhooks.

## Target Architecture

```text
Zalo Personal Account
  <-> zca-js session/client
  <-> Zalo API Gateway HTTP server
  <-> Hermes / curl / n8n / custom webhook consumers
```

## Current Direction

This repository started from `monas-team/zaloclaw`, but it is no longer maintained as an OpenClaw channel plugin. The Zalo-specific code is being extracted into a gateway-owned runtime.

Current cleanup state:

- Package metadata is `zalo-api-gateway@0.1.0`.
- OpenClaw plugin manifest and runtime files are under `legacy/openclaw/` for reference only.
- `index.ts` exports Zalo-owned reusable logic/types instead of registering an OpenClaw plugin.
- `src/zalo/message-normalizer.ts` owns message normalization, dedup, and media ingestion guard logic.
- `./init.sh`, `npm run typecheck`, and `npm test` pass.

## Non-Goals

- Do not edit Hermes core source code.
- Do not require OpenClaw at runtime.
- Do not port all historical ZaloClaw actions in the first implementation pass.
- Do not expose unauthenticated mutating endpoints.
- Do not encourage primary-account production use.

## Phase 0 - Stabilize Harness And Baseline

Goal: make future coding sessions restartable and keep verification reliable.

Tasks:

1. Keep `AGENTS.md`, `feature_list.json`, `progress.md`, `session-handoff.md`, and `init.sh` current.
2. Keep OpenClaw-only code isolated under `legacy/openclaw/` unless a specific Zalo behavior is being ported.
3. Keep maintained runtime imports focused on `src/zalo/**`, `src/client/**`, gateway files, and safe utility modules.
4. Run `./init.sh` after source or harness edits.

Exit criteria:

- Harness validator remains at least 85/100.
- `npm run typecheck` passes.
- `npm test` passes.
- Any OpenClaw references in maintained paths are intentional and documented.

Status: mostly complete. Continue updating harness files when plan or verification changes.

## Phase 1 - Gateway Skeleton

Goal: add a standalone HTTP service that does not require real Zalo login in tests.

Proposed files:

- `src/gateway/server.ts` - HTTP server factory.
- `src/gateway/routes/health.ts` - health/version routes.
- `src/gateway/config.ts` - gateway config loader.
- `src/gateway/types.ts` - public API payload types.
- `src/gateway/auth.ts` - bearer token guard for mutating endpoints.
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
ZALO_GATEWAY_TOKEN=required-for-mutations
ZALO_GATEWAY_WEBHOOKS=optional comma-separated URLs or config-file equivalent
```

Exit criteria:

- Server can be instantiated in tests without real Zalo login.
- `GET /health` returns service status and whether the Zalo client is connected.
- `GET /version` returns package/version/runtime info.
- Tests cover auth helper and health/version route shape.
- `./init.sh` passes.

## Phase 2 - Zalo Client Boundary

Goal: wrap existing `zca-js` login/session/listener/send behavior behind a gateway-owned interface.

Proposed files:

- `src/gateway/zalo-client.ts` - interface and concrete adapter around existing client code.
- `src/gateway/zalo-client.mock.ts` or test fixture - mock client for route tests.
- Reuse from `src/client/zalo-client.ts`, `src/client/credentials.ts`, `src/channel/send.ts`, and `src/zalo/message-normalizer.ts` after reading source paths.

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

## Phase 3 - Messaging MVP

Goal: support basic outbound text send and inbound event forwarding.

API:

```http
POST /messages/send
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

Response:

```json
{
  "ok": true,
  "messageId": "...",
  "threadId": "..."
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

Exit criteria:

- `POST /messages/send` requires bearer token.
- Route validates required fields and returns stable JSON errors.
- Webhook dispatcher sends normalized inbound events to configured URLs.
- Tests cover success, validation failure, auth failure, and webhook failure handling.
- `./init.sh` passes.

## Phase 4 - Curated Action Registry

Goal: expose a small, stable action API that can later grow toward the historical ZaloClaw action set.

API:

```http
POST /actions/:action
```

Initial actions:

- `send`
- `reply-message`
- `add-reaction`
- `get-thread-info`
- `get-group-members`
- `mark-read`
- `send-image` only after media handling is confirmed safe

Implementation rules:

- Reuse validation and behavior from historical ZaloClaw code where practical.
- Keep action handlers independent from OpenClaw tool call signatures.
- Return `{ "ok": true, "data": ... }` or `{ "ok": false, "error": ... }` consistently.

Exit criteria:

- Action registry has typed handler map.
- Tests cover each initial action with mocked Zalo client.
- Public docs list supported actions and explicitly say the remaining action surface is phased.
- `./init.sh` passes.

## Phase 5 - Hermes Integration Adapter

Goal: connect Hermes to the gateway without touching Hermes core.

Options:

1. Thin Hermes platform plugin consuming Zalo webhooks and calling gateway send APIs.
2. Simpler external webhook bridge that calls Hermes CLI and then `POST /messages/send`.

Preferred path:

- Start with external webhook bridge for curl-level validation.
- Promote to Hermes gateway plugin only after the Zalo API Gateway is stable.

Exit criteria:

- A Zalo message can trigger Hermes through webhook/adapter.
- Hermes reply can be sent back through `POST /messages/send`.
- No Hermes core files are modified.

## Verification Matrix

| Phase | Required verification |
|---|---|
| 0 | `./init.sh`, harness validator |
| 1 | gateway health tests, `./init.sh` |
| 2 | mocked client tests, `./init.sh` |
| 3 | route/auth/webhook tests, `./init.sh` |
| 4 | action registry tests, `./init.sh` |
| 5 | local integration smoke test with mocked or secondary Zalo account |

## Current Known Risks

- Zalo personal account automation is unofficial and may break when Zalo changes web behavior.
- Real Zalo testing should use a secondary account only.
- `npm install` currently reports vulnerabilities; review dependency impact before running automatic audit fixes.
- Old docs may still mention OpenClaw until fully rewritten or archived.
