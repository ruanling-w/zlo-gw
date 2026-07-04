# Session Handoff

## Current Objective

- Goal: Adapt `monas-team/zaloclaw` into a standalone Zalo Personal API Gateway that Hermes and other clients can use over HTTP/webhooks.
- Current status: Gateway MVP is implemented through messaging, webhooks, curated actions, Hermes bridge, real inbound listener, and gateway-side allowlist/logging cleanup.
- Branch / commit: local clone of upstream `main`; no new branch or commit created yet.

## Completed This Session

- [x] Cloned upstream repo into `/home/ruanling/code/zalo-api-gateway`.
- [x] Installed dependencies with `npm install`.
- [x] Ran baseline tests successfully.
- [x] Created and improved harness files: `AGENTS.md`, `feature_list.json`, `progress.md`, `init.sh`, `session-handoff.md`.
- [x] Added detailed implementation plan at `docs/GATEWAY_PLAN.md`.
- [x] Updated `feature_list.json` into phase-based work items aligned with the plan.
- [x] Removed OpenClaw plugin entrypoint/package metadata from the maintained runtime path.
- [x] Moved OpenClaw-only implementation files into `legacy/openclaw/`.
- [x] Extracted Zalo message normalization/dedup/media-ingestion logic into `src/zalo/message-normalizer.ts`.
- [x] Rewrote primary docs for standalone Zalo API Gateway direction: `README.md`, `docs/GATEWAY_PLAN.md`, `SECURITY.md`, and `TOOLS.md`.
- [x] Started Phase 1 gateway skeleton with config/auth helpers, HTTP server, health/version routes, and gateway tests.
- [x] Added gateway launch/build scripts and started Phase 2 `GatewayZaloClient` boundary with mocked tests.
- [x] Added `POST /messages/send` route with bearer auth, validation, `GatewayZaloClient` delegation, and mocked tests.
- [x] Added inbound webhook dispatcher, server event wiring, and mocked delivery tests.
- [x] Completed Phase 4 curated `POST /actions/:action` registry with mocked tests.
- [x] Completed Phase 5 external Hermes webhook bridge without modifying Hermes core.
- [x] Added Zalo QR login/status CLI scripts and gateway outbound webhook bearer token support.
- [x] Moved Zalo credentials to Docker-friendly runtime data directory with `.env` support.
- [x] Rewrote `README.md` again to match the observed working gateway process, actual endpoints, webhook timeout behavior, logging plan, and allowlist requirement.
- [x] Added `docs/OPERATIONS.md` runbook for gateway operation, webhook timeout triage, allowlist policy, logging standard, and pre-agent checklist.
- [x] Updated `.env.example` with webhook timeout guidance and planned gateway-side allowlist variables.
- [x] Added gateway-side allowlist policy for inbound webhook dispatch and outbound `/messages/send`.
- [x] Extended gateway-side outbound allowlist policy to send-like actions: `send`, `reply-message`, `add-reaction`, and `mark-read`.
- [x] Added authenticated runtime policy API (`GET /policy`, `PUT /policy`) so external agents can manage allowed users/groups without editing env.
- [x] Added policy convenience endpoints, directory query filters, and registered requested next action names with stable placeholder responses where adapter wiring is still pending.
- [x] Added inbound voice/media attachment normalization and wired outbound `send-voice` through the gateway client boundary.
- [x] Wired media send actions: `send-image`, `send-file`, `send-link`, and `send-video`.
- [x] Added Hermes bridge connection endpoints for Zalo QR login orchestration.
- [x] Added one-command app entrypoint, Dockerfile, QR login API endpoints, and cleaned production action registry to wired actions only.
- [x] Standardized policy/webhook failure logs with event-style names and redacted sender/thread IDs.

## Verification Evidence

| Check | Command | Result | Notes |
|---|---|---|---|
| Unit tests | `npm test` | PASS | 19 test files, 146 tests passed after docs rewrite. |
| Full harness | `./init.sh` | PASS | Typecheck and tests pass after docs rewrite. |
| Full validation | `npm run typecheck && npm run test && npm run build && npm run gateway:build && npm run bridge:hermes:build && npm run zalo:login:build && npm run zalo:status:build` | PASS | Typecheck, tests, and all bundle builds passed earlier; rerun bundle builds if packaging changes. |
| Login CLI build | `npm run zalo:login:build` | PASS | Login CLI bundles to `dist/zalo-login.js`. |
| Status CLI build | `npm run zalo:status:build` | PASS | Status CLI bundles to `dist/zalo-status.js`. |
| Harness validation | `node /home/ruanling/.hermes/skills/autonomous-ai-agents/harness-creator/scripts/validate-harness.mjs --target /home/ruanling/code/zalo-api-gateway` | PASS | Score 87/100 after latest plan update; bottleneck is missing codebase_intelligence docs/profile. |
| Allowlist cleanup | `npm run typecheck && npm run test` | PASS | Typecheck passed; 20 test files, 155 tests passed after Hermes QR connection endpoints. |

## Files Changed

- `AGENTS.md`
- `feature_list.json`
- `init.sh`
- `progress.md`
- `session-handoff.md`
- `docs/GATEWAY_PLAN.md`
- `docs/OPERATIONS.md`
- `src/channel/monitor.ts`
- `src/runtime/types.ts`
- `index.ts`
- `package.json`
- `package-lock.json`
- `src/zalo/message-normalizer.ts`
- `tests/media-ingestion.test.ts`
- `tests/message-dedup.test.ts`
- `legacy/openclaw/**`
- `README.md`
- `SECURITY.md`
- `TOOLS.md`
- `src/gateway/types.ts`
- `src/gateway/config.ts`
- `src/gateway/auth.ts`
- `src/gateway/policy.ts`
- `src/gateway/policy-store.ts`
- `src/gateway/routes/policy.ts`
- `src/gateway/routes/health.ts`
- `src/gateway/server.ts`
- `src/gateway/index.ts`
- `tests/gateway/health.test.ts`
- `tests/gateway/auth-config.test.ts`
- `src/gateway/zalo-client.ts`
- `src/gateway/zalo-client.mock.ts`
- `tests/gateway/zalo-client.test.ts`
- `src/gateway/routes/messages.ts`
- `tests/gateway/messages.test.ts`
- `src/gateway/webhooks.ts`
- `tests/gateway/webhooks.test.ts`
- `src/gateway/routes/actions.ts`
- `tests/gateway/actions.test.ts`
- `tests/gateway/policy.test.ts`
- `src/bridge/hermes/types.ts`
- `src/bridge/hermes/config.ts`
- `src/bridge/hermes/hermes-cli.ts`
- `src/bridge/hermes/zalo-gateway-client.ts`
- `src/bridge/hermes/orchestrator.ts`
- `src/bridge/hermes/server.ts`
- `src/bridge/hermes/index.ts`
- `tests/bridge/hermes/orchestrator.test.ts`
- `tests/bridge/hermes/config-client.test.ts`
- `tests/bridge/hermes/server.test.ts`
- `src/cli/zalo-login.ts`
- `src/cli/zalo-status.ts`
- `src/env/load-dotenv.ts`
- `.env.example`
- `.gitignore`

## Decisions Made

- Keep Hermes core untouched.
- Build a standalone Zalo API Gateway before Hermes integration.
- Reuse `zaloclaw` MIT-licensed Zalo client/action logic where practical.
- Keep OpenClaw code only as legacy reference under `legacy/openclaw/`; maintained runtime path should be Zalo gateway focused.
- Primary docs should describe Zalo API Gateway, not OpenClaw plugin usage.
- Start with health/version, messaging, webhook, and curated action APIs instead of porting all 147 actions.
- Track work as phases in `feature_list.json`, with only `phase-0-harness-baseline` active now.
- Gateway-side allowlist and structured logging now exist for inbound webhooks, `/messages/send`, and send-like curated actions.

## Blockers / Risks

- `npm install` reports 8 vulnerabilities; no audit fix was run.
- Zalo personal automation is unofficial and can risk account checkpoint/ban.
- Real Zalo testing must use a secondary account.
- Review read-only directory/action endpoints if they should also be scoped by allowlists before broad exposure.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json`, `progress.md`, `session-handoff.md`, and `docs/GATEWAY_PLAN.md`.
3. Run `./init.sh`; it is currently passing and is the canonical verification path.

## Recommended Next Step

- Add focused policy tests if more actions become send-like or mutating.
- Decide whether read-only directory/action endpoints should be scoped by the same allowlists.
- Continue gateway hardening around rate limits, durable webhook retry/queueing, and production runbook details.
