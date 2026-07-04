# Risk Areas

## Detected Risks

- high-fan-in-symbol: error — fan-in 29
- high-fan-in-symbol: getApi — fan-in 28
- high-fan-in-symbol: log — fan-in 19
- high-fan-in-symbol: json — fan-in 16
- high-fan-in-symbol: json — fan-in 13
- high-fan-in-symbol: getZaloClawConfig — fan-in 13
- high-fan-in-symbol: isRecord — fan-in 11
- high-fan-in-symbol: getGroupInfo — fan-in 10
- high-fan-in-symbol: requiredString — fan-in 10
- high-fan-in-symbol: hasStoredCredentials — fan-in 10
- api-routes: 12 route nodes detected; route changes need auth/error contract checks.

## High Fan-In Hotspots

- error: fan-in 29 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.actions.error`
- getApi: fan-in 28 — `home-ruanling-code-zalo-api-gateway.src.client.zalo-client.getApi`
- log: fan-in 19 — `home-ruanling-code-zalo-api-gateway.legacy.openclaw.monitor.log`
- json: fan-in 16 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.actions.json`
- json: fan-in 13 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.login.json`
- getZaloClawConfig: fan-in 13 — `home-ruanling-code-zalo-api-gateway.src.config.config-manager.getZaloClawConfig`
- isRecord: fan-in 11 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.actions.isRecord`
- getGroupInfo: fan-in 10 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.actions.getGroupInfo`
- requiredString: fan-in 10 — `home-ruanling-code-zalo-api-gateway.src.gateway.routes.actions.requiredString`
- hasStoredCredentials: fan-in 10 — `home-ruanling-code-zalo-api-gateway.src.client.zalo-client.hasStoredCredentials`

## Safety Rules

- Do not patch around inconsistent state with another fallback; find the authoritative state/source.
- Do not modify high-risk files without targeted tests or explicit verification evidence.
- Do not perform destructive operations without explicit user approval.
- Do not trust graph results alone; confirm with source reads and tests.
