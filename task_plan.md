# Task Plan: Dialogue Atlas Windows 11 Internal MVP

## Goal
Port Dialogue Atlas to Windows 11 x64 as an API-key-only Tauri application while preserving the existing macOS Codex path, local privacy boundaries, and graph behavior.

## Next Step
Create and verify one self-contained Windows Codex handoff ZIP from the clean committed repository.

## Current Phase
Phase 6

## Phases

### Phase 1: Baseline & Discovery
- [x] Capture the current source tree and ignore rules without losing user work
- [x] Run current macOS frontend/Rust baseline checks
- [x] Confirm platform, credential, packaging, UI, and test seams
- **Status:** complete

### Phase 2: Platform & Storage Implementation
- [x] Add backend platform capability authority and Windows provider rejection
- [x] Compile-gate macOS Codex modules without changing macOS behavior
- [x] Move SQLite to local app-data and implement local-only Windows credentials
- **Status:** complete

### Phase 3: Windows UI & Packaging
- [x] Render providers and credential copy from backend capabilities
- [x] Add Windows shortcuts/path handling and honest demo provenance
- [x] Add NSIS current-user Windows configuration
- **Status:** complete

### Phase 4: Offline Provider Test Harness
- [x] Add a test-only localhost OpenAI mock for models/responses
- [x] Cover success, partial, invalid evidence, cancellation, and retry behavior
- [x] Prove mock configuration is absent from release packaging
- **Status:** complete

### Phase 5: Verification & Handoff
- [x] Run frontend, Rust, Playwright, packaging, and macOS regression checks available here
- [x] Prepare Windows build/smoke instructions and evidence checklist
- [x] Record unverified Windows-native and live-OpenAI acceptance gates honestly
- **Status:** complete locally; Windows-native acceptance remains an external gate

### Phase 6: Windows Codex Transfer Package
- [x] Confirm the committed source and exact transfer boundary
- [ ] Create a clean portable repository copy plus first-read Windows Codex instructions
- [ ] Build one ZIP, audit its contents, extract-test it, and record SHA-256
- **Status:** in_progress

## Key Questions
1. Which existing files already contain concurrent user edits that must be preserved?
2. Can the current macOS host compile-check a Windows target, or must that remain a Windows-host gate?
3. Which native Windows assertions can be automated without bundling any mock provider into production?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Windows exposes only `openai_api` | The user explicitly deferred the Windows Codex quota path |
| Use localhost mock analysis for acceptance | No usable real API key is available; production must not claim live-provider verification |
| Keep database provider enum cross-platform | Historical provenance remains readable while execution support stays platform-gated |
| Use LocalAppData and local-persistence Credential Manager entries | Keeps conversation data and secrets local to the Windows machine |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Repository has no Git metadata | 1 | Create a local baseline after verifying ignore rules and preserving the current tree |
| TypeScript did not associate `.d.ts` with an `.mjs` helper | 1 | Use the ESM declaration suffix `.d.mts` |
| Full Windows cross-check stops in `ring` because macOS lacks the MSVC SDK/sysroot | 1 | Keep Windows-native compile/install as an explicit Windows-host gate; validate platform-specific source and dependency trees here |
| Clippy component is unavailable in the current Rust toolchain | 1 | Record as an environment limitation; retain fmt, check, tests, and diff checks as local gates |
| Initial exact readiness-test filter matched zero tests | 1 | Use the full test name `installed_cli_readiness_smoke_makes_no_model_request` |
| Registry-source inspection included a nonexistent `credential.rs` glob | 1 | Read the actual `cred.rs` and `store.rs`; confirmed Windows target format is `{account}.{service}` |
| New mode-drawer E2E scoped its assertion to the drawer header only | 1 | Select the containing `aside.right-drawer` and assert its heading before checking disclosure copy |
| Parallel debug/release Rust suites caused one transient fake-process assertion failure | 1 | Re-ran the affected test, then both complete profiles serially; all 61 tests passed in each profile |
| New flat-export test expected a numbered email placeholder | 1 | Matched the existing deterministic redaction contract, which uses `[邮箱]` |
| Rust formatting check found one long new assertion | 1 | Applied the repository formatter before rerunning tests |

## Notes
- Do not perform a paid OpenAI or Codex model request.
- Do not claim Windows native acceptance from macOS-only checks.
- Preserve existing user changes and macOS provider behavior.
