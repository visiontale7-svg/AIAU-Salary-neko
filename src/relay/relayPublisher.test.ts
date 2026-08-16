import { describe, expect, it } from "vitest";
import type { RelayPackageV1 } from "@dialogue-atlas/relay-contract";
import {
  buildRelayInviteUrl,
  publishRelayPackage,
  relayRuntimeConfig,
  validateRelayPublishableKey,
  validateRelayServiceUrl,
} from "./relayPublisher";

const runtimeProcess = Reflect.get(globalThis, "process") as
  | { env?: Record<string, string | undefined> }
  | undefined;
const localSupabaseSmoke = runtimeProcess?.env?.RELAY_LOCAL_SUPABASE_SMOKE === "1";

describe("relayRuntimeConfig", () => {
  it("accepts explicit loopback services only behind the local integration flag", () => {
    expect(relayRuntimeConfig({
      supabaseUrl: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_fixture",
      relayWebUrl: "http://127.0.0.1:5173",
      localIntegration: "1",
      dev: false,
    })).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_fixture",
      relayWebUrl: "http://127.0.0.1:5173",
    });
  });

  it("fails closed when packaged configuration is incomplete or loopback is not explicitly enabled", () => {
    expect(relayRuntimeConfig({
      supabaseUrl: "",
      publishableKey: "",
      relayWebUrl: "",
      localIntegration: "",
      dev: false,
    })).toBeNull();
    expect(() => relayRuntimeConfig({
      supabaseUrl: "http://127.0.0.1:54321",
      publishableKey: "sb_publishable_fixture",
      relayWebUrl: "http://127.0.0.1:5173",
      localIntegration: "0",
      dev: false,
    })).toThrow(/必须使用 HTTPS/);
  });

  it("accepts bare HTTPS origins and rejects remote plaintext or URL decorations", () => {
    expect(validateRelayServiceUrl("https://relay.example.com/", "Relay Web URL"))
      .toBe("https://relay.example.com");
    expect(() => validateRelayServiceUrl("http://relay.example.com", "Relay Web URL", true))
      .toThrow(/必须使用 HTTPS/);
    expect(() => validateRelayServiceUrl("https://relay.example.com/subpath", "Relay Web URL"))
      .toThrow(/origin/);
    expect(() => validateRelayServiceUrl("https://relay.example.com/?invite=secret", "Relay Web URL"))
      .toThrow(/origin/);
  });

  it("accepts only modern public client keys", () => {
    expect(validateRelayPublishableKey(" sb_publishable_fixture ")).toBe("sb_publishable_fixture");
    expect(() => validateRelayPublishableKey("sb_secret_fixture")).toThrow(/secret|service-role/);
    expect(() => validateRelayPublishableKey("legacy-anon-jwt")).toThrow(/sb_publishable_/);
  });
});

describe("buildRelayInviteUrl", () => {
  it("builds the canonical local room route with the bearer token only in the fragment", () => {
    const inviteUrl = buildRelayInviteUrl(
      "http://127.0.0.1:5173",
      "room/with space",
      "invite_token?with&reserved#characters",
    );
    const parsed = new URL(inviteUrl);
    expect(parsed.origin).toBe("http://127.0.0.1:5173");
    expect(parsed.pathname).toBe("/room/room%2Fwith%20space");
    expect(parsed.search).toBe("");
    expect(parsed.hash).not.toContain("#characters");
    expect(new URLSearchParams(parsed.hash.slice(1)).get("invite"))
      .toBe("invite_token?with&reserved#characters");
  });

  it("refuses an incomplete invitation", () => {
    expect(() => buildRelayInviteUrl("http://127.0.0.1:5173", "", "invite_token"))
      .toThrow(/不能为空/);
    expect(() => buildRelayInviteUrl("http://127.0.0.1:5173", "room_1", ""))
      .toThrow(/不能为空/);
  });
});

describe.skipIf(!localSupabaseSmoke)("desktop Relay publisher integration", () => {
  it("creates a real local room and returns separate canonical and bearer URLs", async () => {
    const suffix = Date.now().toString(36);
    const pkg: RelayPackageV1 = {
      schemaVersion: "relay-v1",
      packageId: `pkg_desktop_smoke_${suffix}`,
      clientPublishId: `publish_desktop_smoke_${suffix}`,
      title: "Desktop publisher local smoke",
      publishedAt: new Date().toISOString(),
      graph: {
        nodes: [{
          id: "n001",
          origin: "source",
          label: "Only the approved public graph reaches Relay",
          kind: "anchor",
          speaker: "user",
          acts: ["question"],
          modeIds: ["m001"],
          evidenceIds: [],
          importance: 1,
          primary: true,
        }],
        edges: [],
        modes: [{ id: "m001", kind: "exploration", label: "Frame", color: "#496e9e", memberNodeIds: ["n001"] }],
        layout: { n001: { x: 120, y: 160 } },
      },
      evidence: {},
    };

    const published = await publishRelayPackage(`snapshot_desktop_smoke_${suffix}`, pkg);
    const canonical = new URL(published.receipt.relayUrl);
    const invite = new URL(published.inviteUrl);
    expect(canonical.origin).toBe("http://127.0.0.1:5173");
    expect(canonical.pathname).toBe(`/room/${published.receipt.roomId}`);
    expect(canonical.search).toBe("");
    expect(canonical.hash).toBe("");
    expect(invite.origin).toBe(canonical.origin);
    expect(invite.pathname).toBe(canonical.pathname);
    expect(invite.search).toBe("");
    expect(new URLSearchParams(invite.hash.slice(1)).get("invite")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  }, 15_000);
});
