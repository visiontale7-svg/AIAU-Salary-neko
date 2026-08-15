# Progress Log

## Session: 2026-08-13 — Dialogue Calendar v1

### Phase 1: 时间与持久化基础层
- **Status:** complete
- Actions taken:
  - Recovered the completed Windows handoff plan and established calendar v1 as the new active objective.
  - Reconfirmed the no-model/no-network boundary for index, preview, and calendar work.
  - Split implementation into temporal persistence, local indexing/commands, and frontend calendar work packages.
- Verification pending:
  - Real raw sample timestamps in Asia/Tokyo.
  - Flat/paste undated behavior.
  - Old-database migration and full regression.
- Error noted: the first Vitest invocation used unsupported `--runInBand`; TypeScript passed, and tests will be rerun with the repository-native command.
- First calendar integration test run: 13 files / 49 tests passed; the new calendar UI suite failed during import because its jsdom localStorage was not initialized. Fix delegated to the frontend work package.
- Frontend after repair: TypeScript and 14 Vitest files / 52 tests pass. Generated both macOS visual candidates and inspected them; final baseline will show a selected entry without changing ordinary startup selection.
- Approved the regenerated month/week visual baselines after inspecting both at original 1536×1024 resolution. The week frame now begins at a fully visible 08:00 and preserves selected-entry detail without hiding the morning events.
- A mid-edit Rust check intentionally caught the temporal worker before helper/query definitions landed; no integration verdict is recorded until that work package finishes.

### Calendar v1 completion receipt
- Added migration `0003_calendar_time_index.sql`, message-level occurrence time/provenance, strict calendar aggregates, immutable session+SHA versions, canonical legacy mapping, and history access.
- Added macOS startup/manual session indexing, four-file production concurrency, cancellation/progress, cache retention, source move/missing handling, and streaming preview with SHA/signature checks.
- Added fixed Tokyo month/week views, 42-cell Sunday calendar, 3+N overflow, exact-minute week anchors, 45-minute clusters, undated records, details, history versions, and atlas navigation.
- Hardened the parser against JSON key order, multi-megabyte developer/tool/reasoning rows, incomplete tails, duplicate-warning growth, active-file mutation, and forged/tampered time summaries.
- Isolated all analysis progress consumers by `conversationId` before `runId`, preventing unrelated concurrent jobs from closing the active import/calendar flow.
- Real fixtures passed with Tokyo last activity `2026-08-08 20:50:14` and `2026-08-07 15:43:08`; the flat visible export remained undated.
- Real-home zero-model smoke passed: 511 discovered, 508 visible, 3 skipped, 0 partial in 223.70 seconds serial; the production worker uses up to four concurrent files.
- Native release app launched and completed a real local index; the August month view showed 402 dated conversations and 5 undated records without a model request.
- Final DMG was mounted read-only and launched directly after the last rebuild; cached calendar data had already been verified to reappear immediately after restart. SHA-256: `b51f07aa045c2bfac03430bc762d98f37ac23b435f834023b39f5d1c136585e3`.
- Added a direct 51 MiB streaming-preview regression containing only two visible messages and large hidden developer rows; the preview completed with exactly the two visible messages and a full SHA-256.
- Final automated regression: Rust 80 passed / 6 ignored, Vitest 56/56, Playwright 13/13, TypeScript and production frontend build passed.
- Final independent contract audit reported no remaining P0/P1. Windows-native MSVC/installer validation remains an external Windows-host gate.
- The final macOS-to-Windows target attempt again stopped in third-party `ring` because this host lacks the MSVC SDK header `assert.h`; it is not Windows-native acceptance and did not expose a calendar source error.

## Session: 2026-08-11

### Phase 6: Windows Codex Transfer Package
- **Status:** complete
- Actions taken:
  - Re-read the persistent plan and confirmed the Windows-native acceptance gate remains pending.
  - Started preparing a single portable ZIP containing only committed source/history and a Windows Codex first-read guide.
  - Audited tracked and ignored content: only `.env.example` matched credential-like names; build output, dependencies, Rust target, and test artifacts remain ignored.
  - Added `WINDOWS_CODEX_HANDOFF.md` with environment setup, scope boundaries, exact scripts, mock scenarios, manual smoke checks, and a required receipt template.
  - Hardened the Windows handoff scripts after independent audit: committed/clean visual gate, ASCII-safe screenshot selector, 30-second slow response, two-launch credential persistence smoke, emergency cleanup copy, and release test-hook scanning.
  - Added a synthetic flat visible-export JSONL fixture and a Rust black-box import test for Chinese/emoji paths, attachment exclusion, phase normalization, and email redaction.
  - Created a `--no-local` staging clone, removed its origin, set a repository-only neutral Git identity, and confirmed clean status with no unreachable Git objects.
  - Built a single-root ZIP with extended macOS metadata disabled, then passed archive integrity, forbidden-path, required-file, Git ancestry, clean status, remote, identity, and unreachable-object checks after extraction.
  - Confirmed the handoff archive contains 220 entries and no `__MACOSX`, dependency directories, build output, application database/log, real `.env`, or test-result directory.

### Phase 1: Baseline & Discovery
- **Status:** complete
- **Started:** 2026-08-11
- Actions taken:
  - Read the planning-with-files instructions and templates.
  - Ran session catch-up; no unsynchronized planning context was reported.
  - Confirmed the project directory currently has no Git metadata.
  - Captured the approved Windows implementation requirements and acceptance boundaries.
  - Audited ignore rules and sensitive filenames, initialized a local Git repository, and staged the current 137-file tree as the user-owned baseline.
  - Ran the complete available pre-port baseline: TypeScript, Vitest, Rust check/tests, and Playwright all passed.
  - Added a localhost-only OpenAI acceptance server supporting success, partial, invalid-evidence, retry-on-next-run, and slow scenarios.
  - Added contract tests proving loopback binding, dummy-key authentication, UTF-16 evidence, privacy flags, and deterministic failure behavior.
  - Added Windows PowerShell helpers for locked build/hash generation and native mock smoke startup.
  - Added the Windows native acceptance checklist and exact honest release statement.
  - Integrated backend platform capabilities, provider enforcement, macOS-only Codex compilation, stale-setting repair, and LocalAppData selection.
  - Integrated local-only Windows Credential Manager storage and the NSIS current-user overlay.
  - Added the serialized credential-delete boundary requested by the plan and validated the Windows overlay JSON schema.
  - Visually inspected the updated 1536×1024 baseline; only the intended honest example provenance changed and graph layout remained intact.
  - Ran the integrated full regression, production frontend build, macOS Tauri app/DMG build, bundle scan, and zero-model Codex readiness smoke.
  - Added a Windows-only real Credential Manager round-trip smoke to the deterministic Windows build script.
  - Hardened credential writes so a failed Local-persistence verification removes the just-written entry, and platformized the backend save-success message.
  - Restricted OpenAI endpoint overrides to debug-only loopback, added single-instance focus, removed remaining fixture-as-AI copy, isolated/cleaned mock credentials, pinned Windows tool versions, and added a human-gated win32 screenshot workflow.
  - Re-ran debug and release Rust suites plus Playwright after audit fixes; all passed.
  - Checked for a local Windows VM/runtime and found none, leaving native Windows acceptance as an explicit external gate.
  - Rebuilt the unsigned macOS regression app/DMG after all audit fixes and re-scanned the final release bundle for test-only hooks.
  - Received independent final Rust/security and frontend/packaging verdicts with no remaining P0/P1 findings; the remaining gates require a Windows 11 x64 host.
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)
  - `.gitignore` (added `*.tsbuildinfo`)
  - `tests/helpers/mock-openai-server.mjs` and `.d.mts` (created)
  - `tests/mock-openai-server.test.ts` (created)
  - `package.json` (added `mock:openai` test helper command)
  - `scripts/build-windows-internal.ps1` (created)
  - `scripts/start-windows-mock-smoke.ps1` (created)
  - `docs/windows-internal-mvp.md` (created)
  - `src-tauri/src/platform.rs` and related backend domain/command/provider/repository/lib files
  - `src-tauri/src/keychain.rs`, Cargo target dependencies/lock, and `src-tauri/tauri.windows.conf.json`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Session catch-up | Project root | Report prior unsynced context or remain empty | No unsynced context reported | pass |
| Baseline secret/name scan | Project root | No database, log, credential, or real `.env` staged | Only `.env.example` found | pass |
| TypeScript baseline | `npm run typecheck` | No type errors | Exit 0 | pass |
| Frontend unit baseline | `npm test` | Existing suite passes | 35/35 passed | pass |
| Rust baseline | Cargo check and test, locked | Compile and tests pass without paid turns | Check passed; 49 passed, 4 ignored | pass |
| Browser E2E baseline | `npm run test:e2e` | Existing browser-demo suite passes | 10/10 passed | pass |
| Local OpenAI mock contracts | Focused Vitest | Four privacy/protocol scenarios pass | 4/4 passed | pass |
| TypeScript after mock helper | `npm run typecheck` | ESM helper declarations resolve | Exit 0 | pass |
| Backend platform/storage Rust suite | Locked Cargo tests | Platform, provider, LocalAppData, and credential changes preserve macOS | 57 passed, 4 paid/native smokes ignored | pass |
| Credential integration | Keychain-focused tests and format check | Local persistence helpers and serialized cleanup API compile cleanly | 4/4 passed; format/config parse passed | pass |
| Integrated TypeScript | `npm run typecheck` | No cross-platform type regressions | Exit 0 | pass |
| Integrated Vitest | `npm test` | Platform, mock, graph, and import contracts pass | 44/44 passed | pass |
| Integrated Rust | fmt, locked check/all-targets, locked tests | No formatting/compile/test regression | 58 passed, 4 paid/native smokes ignored | pass |
| Integrated Playwright | `npm run test:e2e` | B5, fixture provenance, and provider flows pass | 11/11 passed | pass |
| Production frontend | `npm run build` | Vite production bundle builds | Exit 0 | pass |
| Mock exclusion | Search `dist` and macOS `.app` | No mock helper, scenario variable, or test key bundled | No matches | pass |
| macOS packaging | Tauri build, unsigned internal | `.app` and `.dmg` produced after final fixes | Exit 0; DMG SHA-256 `cc97e201e2e9114aef987fc70b3228e1aa07ca6742c397ee48074c022fcd674a` | pass |
| Codex readiness | Exact no-model ignored smoke | Sandbox/login/protocol readiness without turn | 1/1 passed, no model request | pass |
| Audit-fix Rust debug/release | Locked debug and release tests | cfg combinations and hardened endpoint/credential paths pass | 61 passed, 4 ignored in each profile | pass |
| Audit-fix Playwright | Full suite | Fixture-source copy and graph regressions pass | 11/11 passed | pass |
| Windows host discovery | Local virtualization/application scan | Find a usable Windows 11 runner or record absence | No Windows VM/runtime found | external-gate |
| Windows target cross-check | `x86_64-pc-windows-msvc` from macOS | Identify source/dependency errors if possible | Reached `ring`; blocked by missing MSVC `assert.h`/SDK | environment-blocked |
| Final release-hook scan | `dist` and rebuilt macOS `.app` | No mock helper, dummy key, debug endpoint/account override | No matches | pass |
| Windows handoff source clone | `git clone --no-local` | Clean Git tree, no origin, neutral local identity, no unreachable objects | All checks produced expected empty/output values | pass |
| Windows handoff archive | ZIP integrity and entry audit | One top-level repo; no excluded cache/data paths | 220 entries; integrity and forbidden-path checks passed | pass |
| Windows handoff extraction | Fresh temporary directory | Exact source commit and clean portable Git state survive extraction | HEAD/ancestor/identity/required-file checks passed | pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-11 | `fatal: not a git repository` | 1 | Will initialize a local baseline after auditing ignore rules |
| 2026-08-11 | TS7016 for the new `.mjs` mock helper | 1 | Replaced the declaration file suffix with `.d.mts` |
| 2026-08-11 | Windows cross-check failed in `ring` due missing MSVC `assert.h` | 1 | Deferred full compile to required Windows 11/MSVC host |
| 2026-08-11 | Clippy component unavailable | 1 | Kept fmt, check, unit, and diff checks as local verification |
| 2026-08-11 | Exact readiness filter selected zero tests | 1 | Corrected to the full no-model test name before rerunning |
| 2026-08-11 | Registry source command referenced nonexistent `credential.rs` | 1 | Read actual `cred.rs`/`store.rs` and confirmed account-first target naming |
| 2026-08-11 | New fixture-source E2E selected only the mode drawer header | 1 | Scoped the assertion to the containing right-drawer aside and reran it |
| 2026-08-11 | One fake Codex process assertion failed while debug and release Rust suites ran concurrently | 1 | The focused test passed; serial full debug and release suites each passed 61/61 non-ignored tests |
| 2026-08-11 | Rust fmt check found one long new assertion | 1 | Ran `cargo fmt --all` |
| 2026-08-11 | New flat-export fixture test expected `[邮箱_1]`, but the product contract uses `[邮箱]` | 1 | Corrected the assertion to the existing deterministic placeholder |
| 2026-08-11 | Initial staging clone command selected the destination as `workdir` before it existed | 1 | Re-ran from the existing temporary parent and addressed the clone with `git -C` |
| 2026-08-11 | Initial extraction verification selected the repository as `workdir` before unzip created it | 1 | Extracted from the existing parent and used `git -C` for all repository assertions |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Local implementation and macOS regression are complete; Windows-native acceptance is pending |
| Where am I going? | Capture the Win32 baseline and run the locked build/native smoke on Windows 11 x64 |
| What's the goal? | Windows 11 x64 API-only internal MVP without regressing macOS |
| What have I learned? | See `findings.md` |
| What have I done? | Implemented the API-only Windows port, test harness, packaging gates, and local/macOS verification |
