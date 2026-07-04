# AGENTS.md

## Project Goal

This repository is being adapted from `monas-team/zaloclaw` into a standalone Zalo Personal API Gateway.

The gateway must be usable by Hermes, curl, n8n, webhooks, or any HTTP client without requiring OpenClaw at runtime.

## Startup Workflow

Before writing code:

1. Confirm the working directory with `pwd`.
2. Read this file completely.
3. Read `feature_list.json` and pick exactly one active feature.
4. Read `progress.md` and `session-handoff.md` for current state, blockers, verification evidence, and next step.
5. Read project docs when present: `docs/CODEMAP.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/RISK_AREAS.md`, and README.
6. Run `./init.sh` to check the baseline. If it fails, record the blocker before expanding scope.
7. For non-trivial code changes, inspect affected source files and use codebase-memory-mcp when available.

## Definition of Done

A feature is done only when all of these are true:

- Target behavior is implemented and stays within `feature_list.json` scope.
- Required verification commands actually ran, or a concrete blocker is recorded.
- Evidence is recorded in `feature_list.json` or `progress.md`.
- `session-handoff.md` leaves a clean restart path for the next session.
- No Hermes core files were modified for this gateway integration.

## Scope Rules

- One feature at a time: work only on the active feature in `feature_list.json` unless the user explicitly changes it.
- Keep Hermes core untouched. Hermes integration must happen later through a thin plugin/client that talks to this gateway.
- Preserve the upstream MIT license and attribution from `monas-team/zaloclaw`.
- Treat Zalo personal automation as unofficial and risky; keep warnings in user-facing docs.
- Prefer extracting reusable Zalo client/action logic from existing `src/**` before deleting OpenClaw-specific code.
- Do not port all 147 actions at once. Ship a small HTTP gateway MVP first, then expand action coverage in phases.
- Do not mark a feature complete until every `doneCriteria` item is satisfied or explicitly moved out of scope by the user.

## Architecture Direction

Target runtime:

```text
Zalo Personal Account
  <-> zca-js client/session
  <-> standalone Zalo API Gateway HTTP server
  <-> Hermes / curl / n8n / custom webhooks
```

Target service responsibilities:

- Own the Zalo login/session lifecycle.
- Expose local authenticated HTTP APIs for send/read/action calls.
- Emit inbound Zalo events to configured outbound webhooks.
- Keep action schemas and normalized event payloads stable for external clients.
- Keep OpenClaw compatibility only if it does not complicate the standalone gateway path.

## Current Baseline

- Upstream package name: `zaloclaw`.
- Current code is an OpenClaw channel/tool plugin.
- Baseline validation after `npm install`: `npm test` passes, 9 files / 104 tests.
- `npm install` reports 8 vulnerabilities; do not run `npm audit fix` without a specific dependency plan.

## Implementation Plan

The authoritative implementation plan is `docs/GATEWAY_PLAN.md`. Keep `feature_list.json`, `progress.md`, and `session-handoff.md` aligned with it.

Phase summary:

1. Phase 0 - Stabilize harness and baseline, including the known OpenClaw SDK typecheck blocker.
2. Phase 1 - Add standalone HTTP gateway skeleton with `GET /health` and `GET /version`.
3. Phase 2 - Extract a gateway-owned Zalo client boundary around `zca-js` login/session/listener/send behavior.
4. Phase 3 - Add messaging MVP: authenticated `POST /messages/send`, normalized inbound events, and outbound webhook dispatch.
5. Phase 4 - Add curated `POST /actions/:action` registry for a small stable subset of actions.
6. Phase 5 - Add Hermes integration through an external bridge or plugin, without touching Hermes core.

## Validation

Run before and after each phase:

```bash
./init.sh
```

`./init.sh` currently runs:

```bash
npm run typecheck
npm test
```

If `./init.sh` is blocked by a known baseline issue, run the relevant passing subset such as `npm test`, record the blocker in `progress.md`, and do not claim full verification.

For gateway phases, add focused tests for:

- HTTP auth and validation.
- Message send route using a mocked Zalo client.
- Webhook dispatch payload shape and failure handling.
- Action registry parameter validation.

## End of Session

Before ending a session:

1. Update `progress.md` with current state and verification evidence.
2. Update `feature_list.json` status/evidence for the active feature.
3. Update `session-handoff.md` with changed files, blockers, and the recommended next step.
4. Leave the repo restartable from the Startup Workflow, even when verification is blocked.

## Safety

- Never use a primary Zalo account for manual testing.
- Default bind address should be `127.0.0.1`.
- Require an API token for mutating endpoints.
- Default inbound auto-forwarding/webhooks to explicit config only.
- Add allowlists before enabling any auto-reply integration.
