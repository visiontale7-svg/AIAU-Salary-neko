# Dialogue Atlas Windows 11 x64 internal MVP

This document is the Windows-native acceptance receipt template. A macOS build or cross-check cannot complete these gates.

## Supported boundary

- Windows 11 x64 only.
- OpenAI API provider only. The macOS Codex provider is not compiled into the Windows binary.
- Per-user NSIS installation, LocalAppData SQLite, local-machine Windows Credential Manager entry.
- Internal unsigned distribution. SmartScreen warnings are expected.
- Live OpenAI analysis remains unverified until a user-authorized real key is available.

## Prerequisites

Install Node.js 24 LTS, Rust 1.97.1 with the `x86_64-pc-windows-msvc` target, Visual Studio 2022 Build Tools with Desktop development with C++, and a Windows 11 SDK.

## Deterministic build

The first Windows runner must create a platform-specific screenshot once:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\capture-windows-visual-baseline.ps1
```

Inspect the opened `b5-atlas-1536x1024-win32.png` at 100% scale. Confirm the example provenance, graph geometry, evidence panel, toolbar, and text rendering, then commit that PNG. The release build deliberately refuses to auto-create or silently approve a missing visual baseline.

Then run from PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\build-windows-internal.ps1
```

The script installs locked dependencies, runs TypeScript/Vitest/Playwright/Rust checks, writes and removes one uniquely named dummy Credential Manager entry to prove exact `Local` persistence, builds the unsigned current-user NSIS installer, and prints its SHA-256. Do not publish the installer externally.

## Local full-flow analysis

The mock server is a test helper and is not part of `dist` or the Tauri bundle. Start the native development app and mock together:

```powershell
.\scripts\start-windows-mock-smoke.ps1 -Scenario success
```

Paste the printed test-only key in Settings. The debug app stores it under a unique smoke-only Credential Manager account; the script removes that entry and its stdout/stderr metadata when the app exits, without touching any real Dialogue Atlas API key. Use `fixtures\codex-rollout-minimal.jsonl`, confirm the privacy preview, and start analysis. The graph must contain verified units, response relations, a mode island, and exact evidence.

Repeat targeted behavior with:

```powershell
.\scripts\start-windows-mock-smoke.ps1 -Scenario partial
.\scripts\start-windows-mock-smoke.ps1 -Scenario invalid_evidence
.\scripts\start-windows-mock-smoke.ps1 -Scenario slow
.\scripts\start-windows-mock-smoke.ps1 -Scenario retry_once
```

Expected behavior:

- `partial`: relation-stage failure is visible and no relation is fabricated.
- `invalid_evidence`: invalid source evidence is rejected or replaced only by deterministic fallback and marked for review.
- `slow`: cancellation stops the local job without an automatic replay.
- `retry_once`: the first analysis fails; only an explicit user retry starts a new request.

Inspect the printed request-log path and confirm every response request has `store:false`, `background:false`, and only confirmed visible/redacted conversation text.
The request log intentionally contains the confirmed test conversation text. Delete it after recording the required assertions.

## Native acceptance checklist

- [ ] NSIS installs without UAC under the current user.
- [ ] First launch opens one window; a second launch focuses it.
- [ ] Settings shows only OpenAI API and names Windows Credential Manager.
- [ ] The initial B5 screen is labeled as example data, not an active Codex analysis.
- [ ] `Ctrl+K` focuses search.
- [ ] Raw rollout and visible-export JSONL files open from a path containing Chinese characters and emoji.
- [ ] Missing API key leaves preview available, blocks analysis before run creation, and opens actionable settings guidance.
- [ ] The mock success path produces semantic units, evidence-backed relations, modes, and usage counters.
- [ ] Corrections, pinned node positions, mode visibility, and viewport survive restart.
- [ ] Credential persistence is exactly `Local` and survives app restart/sign-out/sign-in on the same machine.
- [ ] The API key is absent from SQLite, logs, browser storage, request logs, and error messages.
- [ ] SQLite exists only under `%LOCALAPPDATA%\com.visiontale.dialogueatlas`; the corresponding `%APPDATA%` path is absent.
- [ ] Cancellation and explicit retry behave as described above without automatic paid replay.
- [ ] The UI remains usable at 125% and 150% display scaling.
- [ ] Reinstalling the same or newer internal build preserves database and credentials; downgrade is rejected.
- [ ] The produced installer SHA-256 matches the build receipt.

## Release statements

Use this status before the Windows-native checklist and installer build are complete:

> The Windows 11 x64 API-only port is implemented and has passed the available source, frontend, Rust, and macOS regression checks. Windows-native compilation, Credential Manager behavior, NSIS installation, and visual smoke testing have not yet been completed, so no Windows installer is currently an accepted deliverable. No live OpenAI API request has been performed.

Only after every native checklist item above passes may the receipt use:

> Windows 11 x64 packaging, local storage, Credential Manager, import, and deterministic offline analysis flow have been verified. The installer is unsigned and intended for internal side-loading. No live OpenAI API request has been performed, so live-provider connectivity and billing remain unverified.
