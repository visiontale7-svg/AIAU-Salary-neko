import { describe, expect, it } from "vitest";
import type { RelayPackageV1 } from "./relay-v1";
import { validateRelayPackage } from "./validation";

function fixture(): RelayPackageV1 {
  return {
    schemaVersion: "relay-v1",
    packageId: "pkg_demo_01",
    clientPublishId: "publish_demo_01",
    title: "Dialogue Atlas Relay",
    publishedAt: "2026-08-15T00:00:00.000Z",
    graph: {
      nodes: [{
        id: "n001",
        origin: "source",
        label: "Turn private AI dialogue into a team decision",
        kind: "anchor",
        acts: ["proposal"],
        modeIds: ["m001"],
        evidenceIds: ["e001"],
        importance: 0.9,
        primary: true,
      }],
      edges: [],
      modes: [{ id: "m001", kind: "goal", label: "Goal", color: "#dbeafe", memberNodeIds: ["n001"] }],
      layout: { n001: { x: 120, y: 80 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    evidence: { e001: { excerpt: "A deliberately public excerpt", speaker: "user" } },
  };
}

describe("RelayPackageV1 privacy contract", () => {
  it("accepts a closed allowlisted graph", () => {
    expect(validateRelayPackage(fixture())).toEqual({ ok: true, errors: [] });
  });

  const jwt = [
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiJzeW50aGV0aWMifQ",
    "synthetic_signature_123456",
  ].join(".");
  const opaqueBearer = ["synthetic", "opaque", "credential"].join("_");
  const basicCredential = ["c3ludGhldGlj", "Y3JlZGVudGlhbA=="].join("");

  it.each([
    ["email", "person@example.com"],
    ["unix path", "/Users/private/secret.jsonl"],
    ["generic unix path", "/workspace/team/private.md"],
    ["windows path", "C:\\Users\\private\\secret.jsonl"],
    ["windows UNC path", "\\\\private-server\\team-share\\secret.jsonl"],
    ["uuid-v4", "80000000-0000-4000-8000-000000000001"],
    ["uuid-v7", "80000000-0000-7000-8000-000000000002"],
    ["secret", "DEVIN_API_KEY=cog_supersecretvalue"],
    ["authorization bearer", `Authorization: Bearer ${jwt}`],
    ["authorization basic", `Authorization: Basic ${basicCredential}`],
    ["bare bearer", `Bearer ${opaqueBearer}`],
    ["standalone jwt", jwt],
    ["private key marker", "-----BEGIN PRIVATE KEY-----"],
    ["typed private key marker", "-----BEGIN OPENSSH PRIVATE KEY-----"],
  ])("rejects %s canaries recursively", (_label, canary) => {
    const value = fixture();
    value.evidence.e001.excerpt = canary;
    expect(validateRelayPackage(value).ok).toBe(false);
  });

  it("does not treat ordinary prose using bearer as a credential", () => {
    const value = fixture();
    value.evidence.e001.excerpt = "The ticket bearer can enter with the team.";
    expect(validateRelayPackage(value)).toEqual({ ok: true, errors: [] });
  });

  it("rejects private snapshot-shaped fields even if empty", () => {
    const value = { ...fixture(), sourceMessages: [] };
    expect(validateRelayPackage(value).errors).toContain("$.sourceMessages: forbidden key");
  });

  it("rejects dangling graph references and non-finite coordinates", () => {
    const value = fixture();
    value.graph.edges.push({ id: "r001", origin: "source", source: "n001", target: "n999", type: "supports", label: "supports", evidenceIds: [] });
    value.graph.layout.n001.x = Number.NaN;
    const result = validateRelayPackage(value);
    expect(result.errors).toContain("edge r001 target is missing");
    expect(result.errors).toContain("layout for n001 is missing or non-finite");
  });
});
