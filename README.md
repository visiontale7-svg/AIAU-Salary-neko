# Dialogue Atlas

Dialogue Atlas is a macOS-first, single-user desktop MVP that turns one visible Codex/GPT conversation into an evidence-linked graph of semantic units, dialogue acts, directed relations, revisions, optional mode memberships, and unresolved branches.

The B5 fixture is a visual and contract oracle: 15 turns, 41 semantic units, 29 initially expanded, and 12 secondary fragments. Live model output is deliberately not required to reproduce those exact counts.

## First use

1. Open **Settings** and choose an analysis provider:
   - **Codex via ChatGPT (included usage / credits)** prefers the exact, signed `codex-cli 0.147.0-alpha.6.5` bundled with the installed ChatGPT app, with the audited Homebrew `0.145.0` build retained as a fallback. Both are pinned by version and SHA-256 on Apple Silicon and use the `gpt-5.6-luna` model through a ChatGPT login. Included Codex usage is consumed first; after the plan limit, purchased credits may be consumed, and enabled auto top-up may trigger a charge. Other CLI versions or binary hashes fail closed until their isolation contract is reviewed.
   - **OpenAI API** uses `gpt-5-mini`. Rust writes the API key to macOS Keychain, never SQLite or browser storage.
2. Import a raw Codex rollout JSONL, a header-marked visible conversation export JSONL, or paste a transcript separated with `用户/GPT` or `User/Assistant` markers.
3. Review the detected turns, speaker assignments, and privacy redactions before analysis.
4. Inspect every visible node or edge through exact source evidence; use **纠正分析** for append-only local corrections.

Raw Codex rollout import reads only visible `response_item.message` text for `user` and `assistant`. It excludes developer messages, reasoning, tool calls/outputs, duplicate event messages, unsupported media blocks, and known injected context blocks. Exact Codex attachment wrappers are reduced to the user's visible request while the mentioned local path stays excluded. The JSONL picker also accepts the app's privacy-scoped visible conversation export format: an exact first-line `record_type="conversation"` header followed by top-level `user`/`assistant` text records. Attachment arrays and all non-message records are ignored; arbitrary headerless `role/text` JSONL is rejected. Pasted text is analyzed literally after confirmation.

Both providers use strict JSON Schema followed by deterministic local evidence validation. The OpenAI API path uses `store:false` and non-background requests; this is not the same as organization-level Zero Data Retention. The Codex path sends the confirmed visible/redacted text through the local, ChatGPT-authenticated `codex app-server` protocol. Every thread is ephemeral and both `thread/start` and `turn/start` explicitly pass `environments: []`; dynamic tools, capability roots, MCP inventory, user config, skills, apps, web search, and all reported CLI features must remain empty or disabled. This removes the model's filesystem/execution environment (a non-filesystem Plan tool may still exist). Any file, command, MCP, image-view, web-search, or other privileged item fails closed.

The app-server runs inside a disposable `/private/tmp` runtime and a second macOS filesystem policy permits reads only from the exact audited Codex binary, exact Codex-owned `auth.json`, required system paths, and that runtime. Writes are limited to the runtime plus that exact auth file so Codex can rotate an expiring token; all other user files remain denied. Readiness performs an allow-inside/deny-outside sentinel test, checks the pinned CLI version and arm64 SHA-256, verifies empty instruction sources/workspace roots/MCP inventory without starting a model turn, and separately checks the model-visible input list for injected wrappers. A temporary read-through link to `auth.json` lets Codex authenticate; the app never parses or copies its contents. Remote data handling follows the selected ChatGPT/Codex account's data controls.

The exact visible source text remains in the local SQLite database without application-level encryption; the MVP assumes a trusted local macOS account. Automated tests use a fake Codex executable. The installed-CLI smoke test performs only local version/login/sandbox/app-server handshakes and never sends `turn/start`, so it does not spend included usage or credits.

Readiness is a compatibility and authentication check only. It cannot read remaining plan usage, credit balance, auto top-up state, target-model availability, or the cost of a future run. A separate, user-authorized end-to-end verification analyzed the supplied 32-turn rollout with prompt `dialogue-atlas-v2`: 38 verified/fallback units became 25 primary nodes plus 13 folded operation fragments, with 13 evidence-backed relations and five modes. One GPT turn required deterministic fallback and two proposed units failed exact-evidence validation, so the immutable snapshot is honestly marked `partial` with three review items. The run recorded 18,588 input and 10,167 output tokens; those counters are reproducibility evidence, not a currency-cost estimate.

Stopping an analysis ends the local job or CLI process as promptly as possible, but a remote request that was already accepted may still produce billable usage or consume ChatGPT-plan credits.

The import dialog's explicit reanalysis action uses the currently selected provider and starts a complete new run; it does not resume or silently replay the prior paid request. The backend `retry_failed_stage` command is reserved for retrying with the failed run's recorded provider/model and also creates a new full run.

## Development

```bash
npm install
npm run tauri dev
```

`npm run dev` opens the browser-only B5 preview. It can preview pasted turn boundaries but intentionally cannot run imported-text analysis or access local files/Keychain.

Core locations:

- `src/`: React Flow graph, ELK worker, evidence UI, import flow, corrections, and Tauri adapter.
- `src-tauri/src/`: import/privacy pipeline, Responses client, validation, SQLite, Keychain, commands, and append-only correction replay.
- `fixtures/`: deterministic rollout and B5 contracts.
- `tests/`: Vitest contracts, 300-unit ELK target, and Playwright interaction/visual regression.

## Verification

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run check:rust
npm run test:rust
npm run tauri build
```

The packaged outputs are created under:

- `src-tauri/target/release/bundle/macos/Dialogue Atlas.app`
- `src-tauri/target/release/bundle/dmg/Dialogue Atlas_0.1.0_aarch64.dmg`

Final DMG SHA-256: `22cce2f62898d972bada5855d663b6c3f3fdec54a6222a4800c296d85cbbae73`.

The current Apple Silicon build is ad-hoc signed for personal use and is not Developer ID signed or notarized for public distribution.

## MVP boundaries

The first version is macOS-only and single-window, with local import/storage and remote model analysis through the selected provider. It is limited to 100 visible turns, 120,000 characters, and 300 semantic units. It does not support ChatGPT export JSON, hidden chain-of-thought, tool-call graphs, app accounts, cloud sync, collaboration, report export, or a full snapshot version tree. Reanalysis creates a new immutable snapshot; prior corrections are not silently migrated.
