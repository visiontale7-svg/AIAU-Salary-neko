import { describe, expect, it } from "vitest";
import { B5_SNAPSHOT } from "../src/fixtures/b5";

describe("frontend B5 snapshot integration", () => {
  it("maps the deterministic acceptance counts into the browser demo contract", () => {
    const semanticUnits = B5_SNAPSHOT.units.filter((unit) => unit.kind !== "unresolved");
    const primaryUnits = semanticUnits.filter((unit) => !unit.secondary);
    const secondaryUnits = semanticUnits.filter((unit) => unit.secondary);

    expect(B5_SNAPSHOT.conversation).toMatchObject({
      turns: 15,
      totalUnits: 41,
      expandedUnits: 29,
      hiddenUnits: 12,
    });
    expect(semanticUnits).toHaveLength(41);
    expect(primaryUnits).toHaveLength(29);
    expect(secondaryUnits).toHaveLength(12);
  });

  it("keeps the default withdrawal chain evidence and operation node observable", () => {
    const correctionEdge = B5_SNAPSHOT.relations.find((relation) => relation.id === "R28");
    const interruption = B5_SNAPSHOT.units.find((unit) => unit.id === "U06");
    const unresolved = B5_SNAPSHOT.units.find((unit) => unit.kind === "unresolved");

    expect(correctionEdge?.evidence.user?.exactQuote).toContain(
      "每句话要像研究一样，都得有依据为自己辩护才行",
    );
    expect(correctionEdge?.evidence.assistant?.exactQuote).toContain(
      "我需要明确撤回之前的宽泛判断",
    );
    expect(interruption).toMatchObject({
      speaker: "user",
      kind: "operation",
      label: "网络波动，请继续",
      modeIds: [],
    });
    expect(unresolved).toMatchObject({ kind: "unresolved", state: "open" });
  });

  it("uses structural roles rather than source-text length as the node contract", () => {
    const userAnchor = B5_SNAPSHOT.units.find((unit) => unit.id === "U08")!;
    const longAssistant = B5_SNAPSHOT.units.find((unit) => unit.id === "G15")!;

    expect(userAnchor.fullText.length).toBeLessThan(longAssistant.fullText.length);
    expect(userAnchor.kind).toBe("anchor");
    expect(userAnchor.importance).toBeGreaterThan(longAssistant.importance);
    expect(B5_SNAPSHOT.conversation).not.toHaveProperty("speakerShare");
    expect(B5_SNAPSHOT.conversation).not.toHaveProperty("wordCount");
  });
});
