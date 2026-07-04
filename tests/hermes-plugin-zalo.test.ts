import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adapter = readFileSync(new URL("../hermes-plugin/zalo_platform/adapter.py", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../hermes-plugin/plugin.yaml", import.meta.url), "utf8");

describe("Hermes Zalo platform plugin", () => {
  it("manifest describes a platform plugin", () => {
    expect(manifest).toMatch(/^kind: platform$/m);
    expect(manifest).toMatch(/^\s*- name: ZALO_GATEWAY_URL$/m);
    expect(manifest).toMatch(/^\s*- name: ZALO_GATEWAY_EVENTS_TOKEN$/m);
  });

  it("registers a Zalo platform adapter", () => {
    expect(adapter).toMatch(/ctx\.register_platform\(/);
    expect(adapter).toMatch(/name="zalo"/);
    expect(adapter).toMatch(/adapter_factory=lambda cfg: ZaloPlatformAdapter\(cfg\)/);
    expect(adapter).toMatch(/def authorization_is_upstream/);
    expect(adapter).not.toMatch(/allowed_users_env="ZALO_ALLOWED_USERS"/);
    expect(manifest).not.toMatch(/ZALO_ALLOWED_USERS/);
  });

  it("uses gateway SSE inbound and HTTP outbound", () => {
    expect(adapter).toMatch(/"Accept": "text\/event-stream"/);
    expect(adapter).toMatch(/"Last-Event-ID"/);
    expect(adapter).toMatch(/"messages\/send"/);
    expect(adapter).toMatch(/"message\.created"/);
  });

  it("preserves media attachments and exposes voice send for Hermes voice mode", () => {
    expect(adapter).toMatch(/media_urls=media_urls/);
    expect(adapter).toMatch(/media_types=media_types/);
    expect(adapter).toMatch(/MessageType\.VOICE/);
    expect(adapter).toMatch(/async def send_voice/);
    expect(adapter).toMatch(/"actions\/send-voice"/);
  });
});
