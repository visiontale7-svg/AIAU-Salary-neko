# Findings & Decisions

## Requirements
- Windows 11 x64 internal NSIS build, current-user installation, unsigned for internal use.
- Windows supports OpenAI API only; macOS Codex support must remain unchanged.
- SQLite uses LocalAppData and Windows API keys use local-only Credential Manager persistence.
- No real API key is available, so full analysis is verified through a localhost-only test harness.
- No save-for-later workflow, data migration, Windows Codex, signing, updater, MSI, ARM64, or public distribution.

## Research Findings
- The current directory is not a Git repository, so the current source tree must be captured as a local baseline before broad edits.
- Prior repository inspection found the OpenAI, SQLite, React Flow, ELK, import, and analysis layers platform-neutral; the Codex runner is macOS-specific.
- Current Tauri `app_data_dir()` maps to roaming data on Windows; `app_local_data_dir()` is the required LocalAppData boundary.
- `keyring::Entry::new` uses Windows Credential Manager but defaults to Enterprise persistence; strict local persistence requires the Windows store modifier `persistence=Local`.
- The present environment is Apple Silicon macOS; Windows native build/install evidence must remain a separate acceptance gate.
- Existing `.gitignore` already excludes `node_modules`, frontend/Rust build output, Playwright artifacts, SQLite files, and `.env*` secrets; `*.tsbuildinfo` was added before the baseline.
- The staged baseline contains 137 source/config/fixture/icon files and no discovered database, log, credential, or non-example environment file.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Embed platform capabilities in `AnalysisSettings` | Reuses the existing settings IPC and makes backend support authoritative |
| Compile-gate the whole macOS Codex implementation | Avoids fragile per-function Windows conditionals and prevents unsupported code from entering the Windows binary |
| Keep localhost mock in tests only | Exercises the real HTTP/analysis pipeline without shipping fake analysis behavior |
| Preserve raw/clean JSONL import contracts | Existing privacy boundary excludes tools, attachments, and hidden reasoning |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| No Git history for distinguishing pre-existing edits | Treat the entire current tree as user-owned baseline; initialize local history before implementation edits |

## Resources
- `/Users/visiontale7/Desktop/workshop/dialogue-atlas`
- Tauri Windows prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- Windows Credential persistence: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentiala

## Visual/Browser Findings
- The existing graph UI has a browser-demo B5 snapshot; on Windows it must be labeled as example data rather than an active Codex result.
