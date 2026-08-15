# Relay privacy contract

## What remains local

- Raw Codex JSONL and all excluded developer, reasoning, tool, and event records.
- Complete visible transcript and full source messages.
- Local conversation, message, turn, semantic-unit, relation, mode, and snapshot IDs.
- Source file paths, imported file signatures, prompts, provider configuration, raw model output, and validation objects.
- Corrections, unpublished evidence, and the local-to-public ID map.

## What can be published

- Owner-approved primary graph nodes and the relations whose endpoints are also approved.
- Modes that still have at least one published member.
- Stable finite node positions and an optional viewport.
- An evidence excerpt only when the owner approves that excerpt individually.
- A bounded room title chosen during the publish review.

All published graph IDs are regenerated (`n001`, `r001`, `m001`, `e001`). The package contains at most 120 nodes and is rejected when references do not close or coordinates are not finite.

## Final privacy checks

Every public string is scanned again before publication. Credential-shaped text, email addresses, UUIDs, Unix/macOS paths, and Windows paths are rejected. The runtime validator also rejects private snapshot-shaped keys such as `fullText`, `sourceMessages`, `rawModelOutput`, `prompt`, `provider`, `messageId`, and `turnId` anywhere in the object.

## Realtime payload rule

Presence and Broadcast never contain evidence or comment bodies. They are limited to membership presence, selected/editing node IDs, viewing version, typing state, drag previews, and minimal durable-activity hints. Clients read protected content again through RLS.

## Devin disclosure

When the owner explicitly creates a Devin run, the approved Action Brief is sent to Devin. It contains only the task objective, fixed repository/baseline, allowed files, acceptance commands, forbidden actions, and approved minimum context. It does not contain the raw transcript. Returned Session event text is scanned and redacted before database persistence.

An owner can later send a bounded follow-up to that approved run. Follow-up text is part of the outbound request: it is scanned for credentials, email addresses, local paths, UUIDs, and other forbidden shared text, then stored as an append-only `devin_events` record, sent to Devin, and displayed to room members who can read the run. It is therefore cloud-shared collaboration data, not local-only draft text. Delivery outcomes are recorded separately as sent, rejected, or unknown and do not contain a second copy of the message body.

## Failure behavior

- A failed package build or room publish does not alter the local snapshot, corrections, or layout.
- Missing Supabase or Devin configuration fails closed; the app does not silently fall back to a different destination.
- Realtime failure leaves Postgres as the durable source and the local private analysis unchanged.
