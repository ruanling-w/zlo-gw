# Code Map

Generated from `codebase-memory-mcp` profile: `.harness/repo-profile.json`.

## Project

- Root: `/home/ruanling/code/zalo-api-gateway`
- Stack: `typescript`
- Package manager: `npm`
- Codebase-memory project: `home-ruanling-code-zalo-api-gateway`

## Languages

| language | file_count |
| --- | --- |
| TypeScript | 86 |
| YAML | 2 |
| Python | 2 |
| Bash | 1 |
| HTML | 1 |

## Main Packages

| name | node_count | fan_in | fan_out |
| --- | --- | --- | --- |
| gateway | 162 | 0 | 0 |
| openclaw | 120 | 0 | 0 |
| bridge | 41 | 0 | 0 |
| features | 30 | 0 | 0 |
| zalo_platform | 28 | 0 | 0 |
| channel | 27 | 0 | 0 |
| client | 26 | 0 | 0 |
| config | 18 | 0 | 0 |
| safety | 14 | 0 | 0 |
| parsing | 13 | 0 | 0 |
| zalo | 12 | 0 | 0 |
| tools | 11 | 0 | 0 |
| thread-queue | 5 | 0 | 0 |
| media-ingestion | 4 | 0 | 0 |
| types | 2 | 0 | 0 |

## Entry Points

- listZaloClawAccountIds — `legacy/openclaw/accounts.ts`
- resolveDefaultZaloClawAccountId — `legacy/openclaw/accounts.ts`
- checkZaloClawAuthenticated — `legacy/openclaw/accounts.ts`
- resolveZaloClawAccount — `legacy/openclaw/accounts.ts`
- resolveZaloClawAccountSync — `legacy/openclaw/accounts.ts`
- listEnabledZaloClawAccounts — `legacy/openclaw/accounts.ts`
- getZaloClawUserInfo — `legacy/openclaw/accounts.ts`
- monitorZaloClawProvider — `legacy/openclaw/monitor.ts`
- setZaloClawRuntime — `legacy/openclaw/runtime.ts`
- getZaloClawRuntime — `legacy/openclaw/runtime.ts`
- collectZaloClawStatusIssues — `legacy/openclaw/status-issues.ts`
- loadHermesBridgeConfig — `src/bridge/hermes/config.ts`
- createHermesBridgeServer — `src/bridge/hermes/server.ts`
- listenHermesBridge — `src/bridge/hermes/server.ts`
- downloadFileFromUrl — `src/channel/file-downloader.ts`
- downloadFilesFromUrls — `src/channel/file-downloader.ts`
- downloadImageFromUrl — `src/channel/image-downloader.ts`
- downloadImagesFromUrls — `src/channel/image-downloader.ts`
- probeZaloClaw — `src/channel/probe.ts`
- markdownToZaloStyles — `src/channel/send.ts`

## Hot Symbols

- error — fan-in 29
- getApi — fan-in 28
- log — fan-in 19
- json — fan-in 16
- json — fan-in 13
- getZaloClawConfig — fan-in 13
- isRecord — fan-in 11
- getGroupInfo — fan-in 10
- requiredString — fan-in 10
- hasStoredCredentials — fan-in 10

## Critical Symbol Queries

- `.*Provider.*` -> legacy/openclaw/monitor.ts
- `.*Adapter.*` -> hermes-plugin/zalo_platform/adapter.py, tests/hermes-plugin-zalo.test.ts, hermes-plugin/zalo_platform/adapter.py
- `error` -> src/gateway/routes/messages.ts, hermes-plugin/zalo_platform/adapter.py, src/gateway/routes/policy.ts
- `getApi` -> src/client/zalo-client.ts, src/client/zalo-client.ts
- `json` -> src/gateway/types.ts, feature_list.json, feature_list.json
- `getZaloClawConfig` -> src/config/config-manager.ts
- `isRecord` -> src/gateway/routes/actions.ts
- `getGroupInfo` -> src/gateway/routes/actions.ts

## Required Agent Behavior

- Use this file to choose where to start reading, not as proof of correctness.
- Before editing non-trivial code, query codebase-memory for affected symbols and callers.
- Always read the real source files before editing.
- Record important graph findings in `progress.md`.
