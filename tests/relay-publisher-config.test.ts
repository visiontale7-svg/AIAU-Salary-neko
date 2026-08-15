import { describe, expect, it } from "vitest";
import { validateRelayServiceUrl } from "../src/relay/relayPublisher";

describe("Relay desktop service URL policy", () => {
  it("keeps loopback HTTP behind the explicit local-integration gate", () => {
    expect(() => validateRelayServiceUrl("http://127.0.0.1:54321", "Supabase URL"))
      .toThrow(/HTTPS/);
    expect(validateRelayServiceUrl("http://127.0.0.1:54321", "Supabase URL", true))
      .toBe("http://127.0.0.1:54321");
    expect(() => validateRelayServiceUrl("http://relay.example", "Supabase URL", true))
      .toThrow(/HTTPS/);
  });

  it("rejects credentials and URL metadata even for loopback", () => {
    expect(() => validateRelayServiceUrl("http://user@127.0.0.1:54321", "Supabase URL", true))
      .toThrow(/账号/);
    expect(() => validateRelayServiceUrl("http://127.0.0.1:54321?key=value", "Supabase URL", true))
      .toThrow(/查询参数/);
  });
});
