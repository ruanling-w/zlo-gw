# Hermes Zalo Platform Plugin

This plugin is the preferred Hermes integration for the standalone Zalo API Gateway.

## Architecture

```text
Zalo personal account
  <-> Zalo API Gateway
       |-- GET /events        # authenticated SSE inbound stream
       |-- POST /messages/send # outbound replies
  <-> Hermes Zalo Platform Plugin
  <-> Hermes Gateway / Agent sessions
```

The plugin does not run `zca-js`, store Zalo credentials, or handle QR login. Those stay in the standalone gateway so the same gateway can also serve n8n, curl, webhooks, and other agents.

## Install

Copy or symlink this plugin into a Hermes plugin platform directory, for example:

```bash
mkdir -p ~/.hermes/plugins/platforms/zalo
cp -R hermes-plugin/* ~/.hermes/plugins/platforms/zalo/
hermes plugins enable platforms/zalo
```

Then configure the gateway URL and tokens:

```bash
ZALO_GATEWAY_URL=http://127.0.0.1:8787
ZALO_GATEWAY_TOKEN=[REDACTED]
ZALO_GATEWAY_EVENTS_TOKEN=[REDACTED]
```

`ZALO_GATEWAY_EVENTS_TOKEN` is optional when the event stream uses the same token as the gateway API.

## Runtime Behavior

- Connects to `GET /events` using `Accept: text/event-stream`.
- Uses `Last-Event-ID` to resume records that are still in the gateway ring buffer.
- Converts `message.created` records into Hermes `MessageEvent` objects.
- Sends Hermes replies through `POST /messages/send`.
- Keeps the legacy webhook bridge unnecessary for the native Hermes path, but the bridge can remain as a fallback during migration.

## Policy

Zalo chat authorization is owned by the Zalo Gateway policy API. The plugin marks
Zalo events as already authorized upstream, so Hermes does not require a second
env-based allowlist for each sender. Add/remove allowed users or groups through
the gateway at runtime:

```bash
curl -X POST "$ZALO_GATEWAY_URL/policy/allowed-threads" \
  -H "Authorization: Bearer $ZALO_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["2569557197086949134"]}'
```

No Hermes Gateway restart is needed when policy changes. Zalo Gateway applies the
policy before publishing events to SSE.
