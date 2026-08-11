# Findings & Decisions

## Requirements
- The Windows handoff must be a single ZIP with all source, Git history, scripts, fixtures, and an explicit Markdown operating guide for Windows Codex.
- The ZIP must exclude build caches, databases, logs, environment files, credentials, and machine-specific Git remotes.
- Windows 11 x64 internal NSIS build, current-user installation, unsigned for internal use.
- Windows supports OpenAI API only; macOS Codex support must remain unchanged.
- SQLite uses LocalAppData and Windows API keys use local-only Credential Manager persistence.
- No real API key is available, so full analysis is verified through a localhost-only test harness.
- No save-for-later workflow, data migration, Windows Codex, signing, updater, MSI, ARM64, or public distribution.

## Research Findings
- The clean transfer boundary is the committed repository plus the new handoff guide. The repository has no configured remote or tracked symlink; the only tracked environment-style file is the non-secret `.env.example`.
- Large tracked assets are limited to expected icons, lock files, generated Tauri schemas, and the approved Darwin visual baseline; ignored `node_modules`, `dist`, Rust `target`, and test output must not enter the ZIP.
- Independent transfer audit found that ordinary local clones copied unreachable Git objects; the staging copy must use `git clone --no-local`, remove `origin`, and pass a zero-output unreachable-object check.
- The original Windows scripts needed stronger handoff gates: an ASCII-only screenshot selector for Windows PowerShell compatibility, committed/clean baseline enforcement, a human-usable slow delay, two launches before credential cleanup, and a Windows release test-hook scan.
- The current directory is not a Git repository, so the current source tree must be captured as a local baseline before broad edits.
- Prior repository inspection found the OpenAI, SQLite, React Flow, ELK, import, and analysis layers platform-neutral; the Codex runner is macOS-specific.
- Current Tauri `app_data_dir()` maps to roaming data on Windows; `app_local_data_dir()` is the required LocalAppData boundary.
- `keyring::Entry::new` uses Windows Credential Manager but defaults to Enterprise persistence; strict local persistence requires the Windows store modifier `persistence=Local`.
- The present environment is Apple Silicon macOS; Windows native build/install evidence must remain a separate acceptance gate.
- Existing `.gitignore` already excludes `node_modules`, frontend/Rust build output, Playwright artifacts, SQLite files, and `.env*` secrets; `*.tsbuildinfo` was added before the baseline.
- The staged baseline contains 137 source/config/fixture/icon files and no discovered database, log, credential, or non-example environment file.
- `OpenAiClient` already honors a process-local `OPENAI_BASE_URL`, sends `store:false` and `background:false`, and exposes `/models` plus strict `/responses`; this is the clean test seam for a localhost mock with no production toggle.
- Existing OpenAI tests already cover request privacy flags and in-flight cancellation, but there is no reusable server that supplies deterministic segmentation/relations/modes for a native smoke run.
- README and `.env.example` are currently macOS-specific and must be updated only after capability/storage behavior is implemented and verified.
- Backend capabilities, provider rejection, macOS-arm64 Codex compile gates, stale-setting repair, historical provenance preservation, and LocalAppData path are implemented with 57 passing Rust tests.
- Windows Credential Manager now uses direct `Store::build` with exact `persistence=Local`, serializes access, and fail-closes on missing or mismatched persistence; NSIS overlay and target-specific Cargo dependencies are implemented.
- A macOS-hosted full Windows target check reaches third-party `ring` and then fails for missing MSVC `assert.h`; this confirms the remaining blocker is the absent Windows SDK, not a sufficient Windows build result.
- Manual integration review confirmed backend capability JSON, provider rejection ordering, historical provenance, and compile gates match the approved contract. The credential wrapper needed an explicit serialized delete method, and the Windows overlay needed its schema marker; both were added during integration.
- Frontend integration review found two small contract gaps: a forged Windows capability list could still expose Codex, and the shortcut rendered `Ctrl K` rather than `Ctrl+K`. Normalization now strips Codex on every non-macOS platform and the exact shortcut copy is fixed.
- Production-source search finds no mock server, scenario, or dummy-key reference under `src`; the only production seam is the pre-existing `OPENAI_BASE_URL` override in the Rust HTTP client. Final bundle scanning is still required.
- Native Windows credential persistence needed a test that exercises the real OS store rather than only validating modifiers. A Windows-only ignored smoke now writes a unique dummy entry, checks `Local`, reads it, removes it, and is invoked explicitly by the Windows build script.
- PowerShell is not installed on the macOS host, so script parsing/execution remains part of the mandatory Windows-host receipt.
- Final Rust audit found that a failed post-write persistence check could leave the just-written credential behind and that the backend success message still named macOS Keychain. Failed verification now best-effort deletes the credential before returning the original error, and success copy derives from platform capabilities.
- Final front/security audit found four material gaps: release builds trusted arbitrary `OPENAI_BASE_URL`, second-instance focus was not implemented, deeper fixture UI still said AI inference, and Windows Playwright had no reviewed win32 baseline. Release now fixes the official endpoint, debug accepts only explicit loopback `/v1`; single-instance focuses `main`; fixture copy is source-aware; and Windows build fails with an explicit baseline-capture workflow instead of silently approving one.
- Windows mock smoke uses a constrained debug-only credential account with target format `{account}.com.visiontale.dialogueatlas`, then deletes it and removes stdout/stderr metadata on exit.
- Debug and release Rust suites both pass after the endpoint/cfg hardening; this specifically covers the release-test combination that originally could have omitted the debug URL validator.
- No Parallels, UTM, VMware, VirtualBox executable, or local Windows VM bundle was found on this host, so native Windows screenshot/NSIS/Credential Manager validation cannot be completed locally.
- The final macOS release rebuild contains no mock-server name, dummy key, debug endpoint override, or debug credential-account override; its unsigned DMG hash is `cc97e201e2e9114aef987fc70b3228e1aa07ca6742c397ee48074c022fcd674a`.
- Independent final Rust/security review found no remaining P0/P1 in the current diff. A Windows installer is still not a delivered artifact until the Windows-only visual, build, Credential Manager, install, scaling, and persistence gates pass.
- Independent frontend/packaging review also found no remaining P0/P1 after fixture correction, restore, toast, and mode-detail copy became source-aware and the 11-test browser suite passed.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Embed platform capabilities in `AnalysisSettings` | Reuses the existing settings IPC and makes backend support authoritative |
| Compile-gate the whole macOS Codex implementation | Avoids fragile per-function Windows conditionals and prevents unsupported code from entering the Windows binary |
| Keep localhost mock in tests only | Exercises the real HTTP/analysis pipeline without shipping fake analysis behavior |
| Preserve raw/clean JSONL import contracts | Existing privacy boundary excludes tools, attachments, and hidden reasoning |
| Implement the mock as a standalone Node test helper plus contract test | It can be launched beside the native app on Windows, uses no new production dependency, and is excluded from Tauri `frontendDist` |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| No Git history for distinguishing pre-existing edits | Treat the entire current tree as user-owned baseline; initialize local history before implementation edits |
| Windows MSVC target cannot fully compile on the Mac host | Keep the native Windows build/install checklist mandatory and do not claim completion from cross-checks |
| No reviewed Windows Playwright baseline exists on this Mac | Added a Windows-only capture-and-review script; the release build refuses to proceed until the win32 PNG is committed |

## Resources
- `/Users/visiontale7/Desktop/workshop/dialogue-atlas`
- Tauri Windows prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- Windows Credential persistence: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentiala

## Visual/Browser Findings
- The existing graph UI has a browser-demo B5 snapshot; on Windows it must be labeled as example data rather than an active Codex result.
- The updated 1536×1024 Darwin baseline visibly shows `固定示例图谱 · 未运行分析`, `B5 固定示例对话`, and `示例标注`; graph geometry, evidence panel, toolbar, mode islands, and legend remain intact with no obvious clipping or overlap regression.
