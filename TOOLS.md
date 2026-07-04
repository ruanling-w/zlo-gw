# Tooling

Use the project harness first:

```bash
./init.sh
```

The harness runs:

```bash
npm run typecheck
npm test
```

Direct commands:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Development Rules

- Keep runtime code focused on the standalone Zalo API Gateway plan.
- Do not add new OpenClaw plugin dependencies to maintained runtime paths.
- Keep OpenClaw-only code under `legacy/openclaw/` unless porting a specific Zalo behavior.
- Add tests for gateway routes before connecting a real Zalo account.
- Use placeholders such as `[REDACTED]` for credentials and account identifiers.

## Current Baseline

- Package: `zalo-api-gateway@0.1.0`
- Node: `>=22`
- Canonical verification: `./init.sh`
- Plan: `docs/GATEWAY_PLAN.md`
