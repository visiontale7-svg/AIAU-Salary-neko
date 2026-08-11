# Dialogue Atlas

Dialogue Atlas is a local, single-user desktop MVP that turns one visible Codex/GPT conversation into an evidence-linked graph of semantic units, dialogue acts, directed relations, revisions, optional mode memberships, and unresolved branches. The maintained desktop targets are Apple Silicon macOS and an internal Windows 11 x64 build.

The B5 fixture is a visual and contract oracle: 15 turns, 41 semantic units, 29 initially expanded, and 12 secondary fragments. Live model output is deliberately not required to reproduce those exact counts.

## First use

1. Open **Settings** and choose an analysis provider:
   - On Apple Silicon macOS, **Codex via ChatGPT (included usage / credits)** prefers the exact, signed `codex-cli 0.147.0-alpha.6.5` bundled with the installed ChatGPT app, with the audited Homebrew `0.145.0` build retained as a fallback. Both are pinned by version and SHA-256 and use `gpt-5.6-luna` through a ChatGPT login. Included Codex usage is consumed first; after the plan limit, purchased credits may be consumed, and enabled auto top-up may trigger a charge. Other CLI versions or binary hashes fail closed until their isolation contract is reviewed.
   - **OpenAI API** uses `gpt-5-mini`. Rust writes the API key to macOS Keychain or a local-persistence Windows Credential Manager entry, never SQLite or browser storage.
   - Windows exposes only OpenAI API. The macOS Codex runner, Seatbelt policy, auth bridge, and process code are not compiled into the Windows binary.
2. Import a raw Codex rollout JSONL, a header-marked visible conversation export JSONL, or paste a transcript separated with `用户/GPT` or `User/Assistant` markers.
3. Review the detected turns, speaker assignments, and privacy redactions before analysis.
4. Inspect every visible node or edge through exact source evidence; use **纠正分析** for append-only local corrections.

Raw Codex rollout import reads only visible `response_item.message` text for `user` and `assistant`. It excludes developer messages, reasoning, tool calls/outputs, duplicate event messages, unsupported media blocks, and known injected context blocks. Exact Codex attachment wrappers are reduced to the user's visible request while the mentioned local path stays excluded. The JSONL picker also accepts the app's privacy-scoped visible conversation export format: an exact first-line `record_type="conversation"` header followed by top-level `user`/`assistant` text records. Attachment arrays and all non-message records are ignored; arbitrary headerless `role/text` JSONL is rejected. Pasted text is analyzed literally after confirmation.

Both providers use strict JSON Schema followed by deterministic local evidence validation. The OpenAI API path uses `store:false` and non-background requests; this is not the same as organization-level Zero Data Retention. The Codex path sends the confirmed visible/redacted text through the local, ChatGPT-authenticated `codex app-server` protocol. Every thread is ephemeral and both `thread/start` and `turn/start` explicitly pass `environments: []`; dynamic tools, capability roots, MCP inventory, user config, skills, apps, web search, and all reported CLI features must remain empty or disabled. This removes the model's filesystem/execution environment (a non-filesystem Plan tool may still exist). Any file, command, MCP, image-view, web-search, or other privileged item fails closed.

The app-server runs inside a disposable `/private/tmp` runtime and a second macOS filesystem policy permits reads only from the exact audited Codex binary, exact Codex-owned `auth.json`, required system paths, and that runtime. Writes are limited to the runtime plus that exact auth file so Codex can rotate an expiring token; all other user files remain denied. Readiness performs an allow-inside/deny-outside sentinel test, checks the pinned CLI version and arm64 SHA-256, verifies empty instruction sources/workspace roots/MCP inventory without starting a model turn, and separately checks the model-visible input list for injected wrappers. A temporary read-through link to `auth.json` lets Codex authenticate; the app never parses or copies its contents. Remote data handling follows the selected ChatGPT/Codex account's data controls.

The exact visible source text remains in the local SQLite database without application-level encryption; the MVP assumes a trusted local OS account. Windows stores the database under `%LOCALAPPDATA%\com.visiontale.dialogueatlas`; macOS retains its Application Support location. Automated tests use a fake Codex executable. The installed-CLI smoke test performs only local version/login/sandbox/app-server handshakes and never sends `turn/start`, so it does not spend included usage or credits.

Readiness is a compatibility and authentication check only. It cannot read remaining plan usage, credit balance, auto top-up state, target-model availability, or the cost of a future run. A separate, user-authorized end-to-end verification analyzed the supplied 32-turn rollout with prompt `dialogue-atlas-v2`: 38 verified/fallback units became 25 primary nodes plus 13 folded operation fragments, with 13 evidence-backed relations and five modes. One GPT turn required deterministic fallback and two proposed units failed exact-evidence validation, so the immutable snapshot is honestly marked `partial` with three review items. The run recorded 18,588 input and 10,167 output tokens; those counters are reproducibility evidence, not a currency-cost estimate.

Stopping an analysis ends the local job or CLI process as promptly as possible, but a remote request that was already accepted may still produce billable usage or consume ChatGPT-plan credits.

The import dialog's explicit reanalysis action uses the currently selected provider and starts a complete new run; it does not resume or silently replay the prior paid request. The backend `retry_failed_stage` command is reserved for retrying with the failed run's recorded provider/model and also creates a new full run.

## Development

```bash
npm install
npm run tauri dev
```

`npm run dev` opens the browser-only B5 preview. It can preview pasted turn boundaries but intentionally cannot run imported-text analysis or access local files or OS credential stores.

The test-only local OpenAI acceptance server can be started with `npm run mock:openai`. Debug builds accept `OPENAI_BASE_URL` only when it is an explicit `http://127.0.0.1:<port>/v1` or `http://localhost:<port>/v1` endpoint. Release builds ignore that environment variable and always use `https://api.openai.com/v1`. The mock rejects requests that are not `store:false` and non-background, is not imported by production source, and is not bundled by Tauri. Windows-native build and mock-smoke instructions are in [docs/windows-internal-mvp.md](docs/windows-internal-mvp.md).

Core locations:

- `src/`: React Flow graph, ELK worker, evidence UI, import flow, corrections, and Tauri adapter.
- `src-tauri/src/`: import/privacy pipeline, Responses client, validation, SQLite, OS credential storage, commands, and append-only correction replay.
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
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` on a Windows build host

The current Apple Silicon build is ad-hoc signed for personal use and is not Developer ID signed or notarized for public distribution.
The Windows NSIS build is unsigned and intended only for internal side-loading; its build script prints the artifact SHA-256. No live OpenAI request has been performed for the Windows port, so live-provider connectivity and billing remain unverified until separately authorized.

## MVP boundaries

The MVP is single-window and supports Apple Silicon macOS plus an internal Windows 11 x64 target. It is limited to 100 visible turns, 120,000 characters, and 300 semantic units. Windows 10, ARM64, MSI, Authenticode, automatic updates, macOS-to-Windows database migration, Windows Codex usage, save-for-later imports, application-layer SQLite encryption, and public distribution are outside this release. It also does not support ChatGPT export JSON, hidden chain-of-thought, tool-call graphs, app accounts, cloud sync, collaboration, report export, or a full snapshot version tree. Reanalysis creates a new immutable snapshot; prior corrections are not silently migrated.
