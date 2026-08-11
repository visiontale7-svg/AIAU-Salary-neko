import b5Fixture from "../../fixtures/b5-analysis-snapshot.json";
import rolloutExpectation from "../../fixtures/codex-rollout-minimal.expected.json";
import rolloutRaw from "../../fixtures/codex-rollout-minimal.jsonl?raw";

export interface SourceSpanFixture {
  message_id: string;
  exact_quote: string;
}

export interface SemanticUnitFixture {
  id: string;
  turn_id: string;
  message_id: string;
  speaker: "user" | "assistant";
  level: "primary" | "secondary";
  node_role: "anchor" | "semantic" | "operation";
  short_label: string;
  acts: string[];
  importance: number;
  provenance: "explicit" | "paraphrase" | "inference";
  source_spans: SourceSpanFixture[];
}

export interface B5Fixture {
  schema_version: string;
  fixture_id: string;
  conversation: {
    id: string;
    title: string;
    source_hash: string;
    turn_count: number;
    semantic_unit_count: number;
    primary_unit_count: number;
    secondary_unit_count: number;
  };
  analysis_run: {
    status: string;
    model_id: string;
    provider: "fixture";
    provider_version: string;
    credential_mode: "none";
    store: boolean;
    background: boolean;
  };
  turns: Array<{
    id: string;
    ordinal: number;
    speaker: "user" | "assistant";
    kind: "research" | "operation";
    message_id: string;
    display_label: string;
    source_text: string;
  }>;
  semantic_units: SemanticUnitFixture[];
  virtual_endpoints: Array<{ id: string; kind: string; short_label: string }>;
  relations: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    confidence: number;
    evidence_unit_ids: string[];
  }>;
  modes: Array<{
    id: string;
    kind: string;
    display_label: string;
    inferred: boolean;
    color: string;
  }>;
  mode_memberships: Array<{ mode_id: string; unit_id: string; confidence: number }>;
  layout: {
    positions: Record<string, { x: number; y: number; pinned: boolean }>;
  };
  corrections: unknown[];
}

export function loadB5Fixture(): B5Fixture {
  return structuredClone(b5Fixture) as unknown as B5Fixture;
}

export function loadRolloutRecords(): Array<Record<string, unknown>> {
  return rolloutRaw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function loadRolloutExpectation() {
  return structuredClone(rolloutExpectation);
}
