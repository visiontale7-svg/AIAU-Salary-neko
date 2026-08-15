# Dialogue Atlas deterministic fixtures

These fixtures are local-only acceptance inputs. They never invoke OpenAI.

## `codex-rollout-minimal.jsonl`

Expected parser result:

- six visible source messages grouped into two user turns and two assistant turns;
- assistant commentary and final text are retained within their response turn;
- the duplicate `event_msg.agent_message` records are ignored;
- developer, reasoning, tool call, and tool output records are ignored;
- `<recommended_plugins>`, `<environment_context>`, and `<skills_instructions>` blocks are removed from the first user message;
- the visible prompt after those injected blocks is retained;
- the second user message remains a separate operational interruption.

The exact black-box expectation is stored in
`codex-rollout-minimal.expected.json` so Rust and frontend adapters can share the
same assertion without duplicating prose.

## `conversation-export-flat-minimal.jsonl`

Expected parser result:

- the exact first-record scope unlocks the privacy-filtered flat export dialect;
- five visible messages form four speaker turns;
- assistant `commentary` and `final_answer` remain separate source messages but share one response turn;
- the attachment filename is ignored rather than imported as dialogue text;
- the emoji is retained and the synthetic email is represented in the redaction preview;
- this fixture intentionally contains only synthetic text and no real credential or personal file path.

## `b5-analysis-snapshot.json`

Expected graph result:

- 15 visible turns;
- 41 semantic units: 29 primary and 12 secondary;
- eight user-origin units, including one operational interruption;
- five inferred, non-exclusive conversation modes;
- explicit interruption/resumption, reclassification, withdrawal/downgrade, and unresolved-endpoint relations;
- every semantic unit and displayed relation contains source evidence.

The B5 fixture is a deterministic UI and contract fixture, not a claim that a live
model must reproduce the same segmentation.
