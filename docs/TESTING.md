# Testing Guide

## Standard Verification Commands

- `npm run typecheck`
- `npm test`
- `npm run build`

## Detected Test Files

- `tests/bridge/hermes/config-client.test.ts`
- `tests/bridge/hermes/orchestrator.test.ts`
- `tests/bridge/hermes/server.test.ts`
- `tests/credentials.test.ts`
- `tests/gateway/actions.test.ts`
- `tests/gateway/auth-config.test.ts`
- `tests/gateway/directory.test.ts`
- `tests/gateway/events.test.ts`
- `tests/gateway/health.test.ts`
- `tests/gateway/messages.test.ts`
- `tests/gateway/policy.test.ts`
- `tests/gateway/webhooks.test.ts`
- `tests/gateway/zalo-client.test.ts`
- `tests/hermes-plugin-zalo.test.ts`
- `tests/media-ingestion.test.ts`
- `tests/mention-parser.test.ts`
- `tests/message-dedup.test.ts`
- `tests/output-filter.test.ts`
- `tests/send.test.ts`
- `tests/thread-queue.test.ts`
- `tests/thread-sandbox.test.ts`
- `tests/url-validator.test.ts`

## Test Selection Rules

- API route or auth/error wrapper changes: run API contract/integration tests plus type-check.
- Task, queue, worker, billing, or rollback changes: run task integration/regression tests.
- Provider/adapter changes: run provider integration tests and any contract tests.
- UI component changes: run relevant unit tests and build/type-check.
- If no targeted test exists for a bug fix, add a regression test before marking done.

## Evidence Requirement

Record the exact command and result in `progress.md` or the active feature's `verificationEvidence` before claiming done.
