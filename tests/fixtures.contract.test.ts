import { describe, expect, it } from "vitest";
import {
  loadB5Fixture,
  loadRolloutExpectation,
  loadRolloutRecords,
} from "./helpers/fixtures";

describe("Codex rollout fixture", () => {
  it("contains every record class the importer must accept or reject", () => {
    const records = loadRolloutRecords();
    const responsePayloads = records
      .filter((record) => record.type === "response_item")
      .map((record) => record.payload as { type?: string; role?: string; phase?: string });

    expect(responsePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", role: "developer" }),
        expect.objectContaining({ type: "message", role: "user" }),
        expect.objectContaining({ type: "message", role: "assistant", phase: "commentary" }),
        expect.objectContaining({ type: "message", role: "assistant", phase: "final_answer" }),
        expect.objectContaining({ type: "reasoning" }),
        expect.objectContaining({ type: "custom_tool_call" }),
        expect.objectContaining({ type: "custom_tool_call_output" }),
      ]),
    );

    const eventMessages = records.filter((record) => {
      const payload = record.payload as { type?: string } | undefined;
      return record.type === "event_msg" && payload?.type === "agent_message";
    });
    expect(eventMessages).toHaveLength(3);

    const firstUser = responsePayloads.find(
      (payload) => payload.type === "message" && payload.role === "user",
    ) as unknown as { content: Array<{ text: string }> };
    expect(firstUser.content[0].text).toContain("<environment_context>");
    expect(firstUser.content[0].text).toContain("<skills_instructions>");
    expect(firstUser.content[0].text).toContain("请先判断这个研究方向");

    const expectation = loadRolloutExpectation();
    expect(expectation.message_count).toBe(6);
    expect(expectation.turn_count).toBe(4);
    expect(expectation.turns[1].message_indexes).toEqual([1, 2]);
    expect(expectation.turns[2]).toMatchObject({
      speaker: "user",
      operation_only: true,
    });
  });
});

describe("B5 deterministic analysis snapshot", () => {
  it("locks the approved 15-turn, 41-unit presentation contract", () => {
    const fixture = loadB5Fixture();
    const primary = fixture.semantic_units.filter((unit) => unit.level === "primary");
    const secondary = fixture.semantic_units.filter((unit) => unit.level === "secondary");

    expect(fixture.turns).toHaveLength(15);
    expect(fixture.semantic_units).toHaveLength(41);
    expect(primary).toHaveLength(29);
    expect(secondary).toHaveLength(12);
    expect(fixture.semantic_units.filter((unit) => unit.speaker === "user")).toHaveLength(8);
    expect(fixture.analysis_run).toMatchObject({
      provider: "fixture",
      provider_version: "fixture-no-model-call",
      credential_mode: "none",
    });
    expect(
      fixture.semantic_units.filter(
        (unit) => unit.speaker === "user" && unit.node_role === "anchor",
      ),
    ).toHaveLength(7);
    expect(fixture.semantic_units.find((unit) => unit.id === "U06")).toMatchObject({
      turn_id: "T10",
      node_role: "operation",
      short_label: "网络波动，请继续",
    });
  });

  it("keeps every semantic unit anchored in exact visible source text", () => {
    const fixture = loadB5Fixture();
    const turnByMessage = new Map(fixture.turns.map((turn) => [turn.message_id, turn]));

    for (const unit of fixture.semantic_units) {
      expect(unit.source_spans.length, `${unit.id} has evidence`).toBeGreaterThan(0);
      for (const span of unit.source_spans) {
        const source = turnByMessage.get(span.message_id)?.source_text;
        expect(source, `${unit.id} refers to a visible message`).toBeTypeOf("string");
        const startUtf16 = source!.indexOf(span.exact_quote);
        expect(startUtf16, `${unit.id} quote is exact`).toBeGreaterThanOrEqual(0);
        const endUtf16 = startUtf16 + span.exact_quote.length;
        expect(source!.slice(startUtf16, endUtf16)).toBe(span.exact_quote);

        // UTF-16 contract values used when the importer materializes SourceSpan.
        expect({ start_utf16: startUtf16, end_utf16: endUtf16 }).toMatchObject({
          start_utf16: expect.any(Number),
          end_utf16: expect.any(Number),
        });
      }
    }
  });

  it("has evidence-backed, directionally explicit relations and an unresolved endpoint", () => {
    const fixture = loadB5Fixture();
    const unitIds = new Set(fixture.semantic_units.map((unit) => unit.id));
    const endpointIds = new Set(fixture.virtual_endpoints.map((endpoint) => endpoint.id));

    for (const relation of fixture.relations) {
      expect(unitIds.has(relation.source) || endpointIds.has(relation.source)).toBe(true);
      expect(unitIds.has(relation.target) || endpointIds.has(relation.target)).toBe(true);
      expect(relation.evidence_unit_ids.length, `${relation.id} has evidence`).toBeGreaterThan(0);
      expect(relation.evidence_unit_ids.every((id) => unitIds.has(id))).toBe(true);
    }

    expect(fixture.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "U06", target: "G13", type: "中断后续答" }),
        expect.objectContaining({ source: "U07", target: "G16", type: "重新归类" }),
        expect.objectContaining({ source: "G19", target: "G15", type: "撤回" }),
        expect.objectContaining({ source: "G21", target: "G16", type: "降级" }),
        expect.objectContaining({ source: "G21", target: "Q_UNRESOLVED", type: "未解决" }),
      ]),
    );
  });

  it("models modes as optional, overlapping inference rather than exhaustive clustering", () => {
    const fixture = loadB5Fixture();
    const membershipsByUnit = fixture.mode_memberships.reduce(
      (result, membership) => {
        const current = result.get(membership.unit_id) ?? [];
        current.push(membership);
        result.set(membership.unit_id, current);
        return result;
      },
      new Map<string, typeof fixture.mode_memberships>(),
    );

    expect(fixture.modes).toHaveLength(5);
    expect(fixture.modes.every((mode) => mode.inferred)).toBe(true);
    expect(membershipsByUnit.get("G01")?.length).toBeGreaterThan(1);
    expect(membershipsByUnit.get("G05")?.length).toBeGreaterThan(1);
    expect(membershipsByUnit.has("U06")).toBe(false);
  });

  it("does not encode speaker word-share or text-volume metrics", () => {
    const serialized = JSON.stringify(loadB5Fixture());
    for (const forbiddenKey of [
      "speaker_share",
      "word_share",
      "word_count",
      "text_ratio",
      "text_volume",
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
  });
});
