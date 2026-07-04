# Security Notes

Zalo API Gateway is intended to expose a Zalo personal account through local HTTP APIs and outbound webhooks. Zalo personal account automation is unofficial and carries account and operational risk.

## Account Safety

- Use a secondary Zalo account for development and testing.
- Do not use a primary personal account for early gateway testing.
- Expect QR/session checkpoint flows to change when Zalo updates its web client.
- Keep the gateway local-only until auth, allowlists, and rate limits are verified.

## Secrets

Never commit or paste real values for:

- Zalo cookies or session data.
- IMEI values.
- User agent strings tied to an account session.
- QR payloads.
- Bearer tokens.
- Real user IDs, group IDs, or thread IDs when sharing logs.

Use `[REDACTED]` in docs, logs, examples, and handoff notes.

## Gateway Exposure

Mutating endpoints must require bearer auth before they are connected to a real Zalo account.

Recommended defaults:

```text
ZALO_GATEWAY_HOST=127.0.0.1
ZALO_GATEWAY_PORT=8787
ZALO_GATEWAY_TOKEN=[REDACTED]
```

Do not bind to `0.0.0.0` unless the deployment has network-level access control.

## Agent Safety

Before connecting Hermes or any other agent runtime:

- Configure allowlists for senders and groups.
- Add loop protection so bot replies do not recursively trigger themselves.
- Add rate limits per thread and globally.
- Log rejected events without leaking secrets.
- Prefer dry-run/mocked Zalo client tests before real-account tests.

## Dependency Notes

This project uses `zca-js`, an unofficial Zalo API library. Treat upstream changes as compatibility risk and verify behavior with a secondary account after dependency updates.
