# Task Plan: Dialogue Atlas Windows 11 Internal MVP

## Goal
Port Dialogue Atlas to Windows 11 x64 as an API-key-only Tauri application while preserving the existing macOS Codex path, local privacy boundaries, and graph behavior.

## Next Step
Commit the verified baseline, then delegate non-overlapping backend, storage/packaging, and frontend implementation packages.

## Current Phase
Phase 1

## Phases

### Phase 1: Baseline & Discovery
- [x] Capture the current source tree and ignore rules without losing user work
- [x] Run current macOS frontend/Rust baseline checks
- [ ] Confirm platform, credential, packaging, UI, and test seams
- **Status:** in_progress

### Phase 2: Platform & Storage Implementation
- [ ] Add backend platform capability authority and Windows provider rejection
- [ ] Compile-gate macOS Codex modules without changing macOS behavior
- [ ] Move SQLite to local app-data and implement local-only Windows credentials
- **Status:** pending

### Phase 3: Windows UI & Packaging
- [ ] Render providers and credential copy from backend capabilities
- [ ] Add Windows shortcuts/path handling and honest demo provenance
- [ ] Add NSIS current-user Windows configuration
- **Status:** pending

### Phase 4: Offline Provider Test Harness
- [ ] Add a test-only localhost OpenAI mock for models/responses
- [ ] Cover success, partial, invalid evidence, cancellation, and retry behavior
- [ ] Prove mock configuration is absent from release packaging
- **Status:** pending

### Phase 5: Verification & Handoff
- [ ] Run frontend, Rust, Playwright, packaging, and macOS regression checks available here
- [ ] Prepare Windows build/smoke instructions and evidence checklist
- [ ] Record unverified Windows-native and live-OpenAI acceptance gates honestly
- **Status:** pending

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

## Notes
- Do not perform a paid OpenAI or Codex model request.
- Do not claim Windows native acceptance from macOS-only checks.
- Preserve existing user changes and macOS provider behavior.
