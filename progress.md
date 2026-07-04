# Progress Log

## Repository Startup

- Working directory: `/home/ruanling/code/zalo-api-gateway`.
- Upstream remote is still `origin=https://github.com/monas-team/zaloclaw.git`; no user fork remote has been configured yet.
- Goal: adapt `monas-team/zaloclaw` into a standalone Zalo Personal API Gateway usable by Hermes, curl, n8n, webhooks, or other HTTP clients without requiring OpenClaw at runtime.

## Completed Baseline And Gateway Work

### Harness And Planning

- Cloned upstream repo into `/home/ruanling/code/zalo-api-gateway`.
- Installed dependencies with `npm install`.
- Created and maintained harness files: `AGENTS.md`, `feature_list.json`, `progress.md`, `init.sh`, and `session-handoff.md`.
- Added detailed implementation plan at `docs/GATEWAY_PLAN.md`.
- Updated `feature_list.json` into phase-based work items aligned with the plan.
- Harness validation previously passed with score 87/100; remaining weakness was missing codebase intelligence docs/profile.

### OpenClaw Runtime Split

- Removed OpenClaw plugin entrypoint/package metadata from the maintained runtime path.
- Moved OpenClaw-only implementation files into `legacy/openclaw/`.
- Kept OpenClaw code as legacy reference only; standalone gateway path remains the maintained target.
- Fixed the earlier OpenClaw SDK typecheck blocker by replacing stale type imports in the moved/legacy monitor path.

### Shared Zalo Logic

- Extracted Zalo message normalization, dedup, and media-ingestion guard logic into `src/zalo/message-normalizer.ts`.
- Existing media-ingestion, dedup, sandbox, URL validation, output-filter, and send tests continue to pass.

### Gateway Skeleton

- Added standalone gateway config/auth helpers, HTTP server, health/version routes, and tests.
- Added gateway launch/build scripts.
- Added `GatewayZaloClient` boundary plus mocked tests.
- `GET /health` and `GET /version` can be tested without real Zalo login.

### Messaging And Webhooks

- Added authenticated `POST /messages/send` route with bearer auth, payload validation, `GatewayZaloClient` delegation, and mocked tests.
- Added inbound webhook dispatcher, server event wiring, mocked delivery tests, and webhook bearer token support.
- Added real inbound `zca-js` listener wiring through `ZcaGatewayZaloClient.onMessage()`.
- Added `normalizeGatewayZaloEvent()` for raw zca-js user/group messages.
- Self messages and empty text are dropped before forwarding.
- Added unit coverage for raw user/group normalization and self/empty filtering.

### Curated Actions And Directory Routes

- Completed curated `POST /actions/:action` registry with mocked tests.
- Initial actions include send/reply/reaction/thread info/group members/mark-read where currently supported by the gateway client boundary.
- Added directory-style routes for friends, groups, and group members.

### Hermes Bridge

- Completed external Hermes webhook bridge without modifying Hermes core.
- Added bridge config, gateway client, Hermes CLI wrapper, orchestrator, server, and tests.
- Added Zalo QR login/status CLI scripts and builds.
- Moved Zalo credentials to a Docker-friendly runtime data directory with `.env` support.

### Documentation

- Rewrote `README.md` for the standalone gateway process, actual endpoints, webhook timeout behavior, curl examples, risks, and allowlist requirement.
- Rewrote `SECURITY.md` around Zalo personal account gateway risks, local binding, bearer auth, allowlists, and secret redaction.
- Updated `TOOLS.md` for the gateway direction.
- Added `docs/OPERATIONS.md` runbook with gateway operation, webhook timeout triage, allowlist policy, logging standard, and pre-agent checklist.
- Updated `.env.example` with webhook timeout guidance and gateway-side allowlist variables.

## Gateway Allowlist And Logging Cleanup

### Implemented

- Added gateway policy helper at `src/gateway/policy.ts`.
- Gateway config now parses:
  - `ZALO_GATEWAY_ALLOWED_SENDERS`
  - `ZALO_GATEWAY_ALLOWED_THREADS`
  - `ZALO_GATEWAY_DENY_SENDERS`
  - `ZALO_GATEWAY_DENY_THREADS`
- Inbound Zalo events are checked before webhook dispatch.
- Inbound denylist wins over allowlist.
- Blocked inbound events are dropped and logged as `event=policy.inbound.blocked` with redacted IDs.
- Allowed inbound events are logged as `event=policy.inbound.allowed` with redacted IDs.
- `/messages/send` now rejects unauthorized outbound targets with `403` before calling the Zalo client.
- Send-like curated actions (`send`, `reply-message`, `add-reaction`, `mark-read`) now share the outbound allowlist check and return `403` for non-allowed targets.
- Direct-message receive/send requires `ZALO_GATEWAY_ALLOWED_SENDERS`; group receive/send requires `ZALO_GATEWAY_ALLOWED_THREADS`.
- Webhook failure logging now uses stable event-style log `event=webhook.delivery.failed`.
- `.env.example` now documents enforced gateway-side allowlist variables instead of planned placeholders.

## Verification Evidence

- Baseline after dependency install: `npm test` passed with 9 files / 104 tests.
- Earlier full validation passed: `npm run typecheck && npm run test && npm run build && npm run gateway:build && npm run bridge:hermes:build && npm run zalo:login:build && npm run zalo:status:build`.
- Login CLI build passed: `npm run zalo:login:build` bundles to `dist/zalo-login.js`.
- Status CLI build passed: `npm run zalo:status:build` bundles to `dist/zalo-status.js`.
- Latest verification after action allowlist completion: `npm run typecheck && npm run test` passed.
  - TypeScript compile check passed.
  - 19 test files passed.
  - 148 tests passed.

## Risks And Notes

- `npm install` reports 8 vulnerabilities; no `npm audit fix` was run.
- Zalo personal automation is unofficial and can risk account checkpoint/ban.
- Real Zalo testing must use a secondary account.
- Gateway-side allowlists now exist for inbound webhooks, `/messages/send`, and send-like curated actions.
- Keep Hermes core untouched; integration remains external through bridge/plugin clients that call the gateway.

## Next Step

- Add focused policy tests if more actions become send-like or mutating.
- Review read-only directory/action endpoints to decide whether they should be scoped by the same allowlists.
- Continue gateway hardening around rate limits, durable webhook retry/queueing, and production runbook details.
