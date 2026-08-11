# Dialogue Atlas Windows Codex package manifest

This internal handoff package contains one clean Git working tree whose history includes implementation commit `c454199`.

The retained internal Git history includes local author metadata, and planning notes may mention the original macOS workspace path. This is acceptable only for the user's own Windows handoff; do not redistribute the ZIP externally without creating a history-free sanitized export.

Included:

- committed application source and Git history;
- JavaScript and Rust lock files;
- Windows Tauri/NSIS configuration;
- Windows baseline, build, and mock-smoke PowerShell scripts;
- installed-payload test-hook scanning script;
- raw rollout, flat visible-export, and deterministic B5 fixtures;
- `WINDOWS_CODEX_HANDOFF.md` and `docs/windows-internal-mvp.md`.

Excluded:

- Git remotes;
- `node_modules`, `dist`, Rust `target`;
- Playwright/test temporary output;
- `.env` files other than the synthetic `.env.example`;
- databases and logs;
- real credentials, API keys, Keychain/Credential Manager data, and Codex auth files;
- macOS build artifacts and Windows installers.

The fixtures intentionally contain clearly synthetic test strings such as dummy API keys and emails. They are contract data, not usable credentials.

After extraction, verify from the repository root:

```powershell
git status --short
git remote -v
git fsck --no-reflogs --unreachable
```

All three commands should produce no output.
