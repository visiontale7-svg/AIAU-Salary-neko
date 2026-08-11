[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "This build must run on a Windows host; cross-compilation is not an acceptance result."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetTriple = "x86_64-pc-windows-msvc"
$minimumSourceCommit = "c454199"
$manifestPath = Join-Path $projectRoot "src-tauri\Cargo.toml"
$bundleDirectory = Join-Path $projectRoot "src-tauri\target\$targetTriple\release\bundle\nsis"
$releaseExecutable = Join-Path $projectRoot "src-tauri\target\$targetTriple\release\dialogue-atlas.exe"
$distDirectory = Join-Path $projectRoot "dist"
$windowsSnapshotRelative = "tests/e2e/dialogue-atlas.spec.ts-snapshots/b5-atlas-1536x1024-win32.png"
$windowsSnapshot = Join-Path $projectRoot $windowsSnapshotRelative

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE"
    }
}

function Assert-NoReleaseTestHooks {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths
    )
    $forbidden = @(
        "dialogue-atlas-local-test-key",
        "DIALOGUE_ATLAS_MOCK_SCENARIO",
        "DIALOGUE_ATLAS_MOCK_LOG",
        "DIALOGUE_ATLAS_MOCK_API_KEY",
        "mock-openai-server",
        "OPENAI_BASE_URL",
        "DIALOGUE_ATLAS_CREDENTIAL_ACCOUNT",
        "dialogue-atlas-smoke-"
    )
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Release-hook scan target is missing: $path"
        }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
        $utf16 = [System.Text.Encoding]::Unicode.GetString($bytes)
        foreach ($pattern in $forbidden) {
            if ($path.Contains($pattern) -or $ascii.Contains($pattern) -or $utf16.Contains($pattern)) {
                throw "Release artifact contains forbidden test hook '$pattern': $path"
            }
        }
    }
}

Push-Location $projectRoot
try {
    Invoke-Checked "git" @("merge-base", "--is-ancestor", $minimumSourceCommit, "HEAD")
    $workingTreeChanges = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed with exit code $LASTEXITCODE"
    }
    if ($workingTreeChanges.Count -ne 0) {
        throw "The Windows build requires a clean reviewed commit. Commit or revert all changes first."
    }
    & git ls-files --error-unmatch -- $windowsSnapshotRelative *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "The Windows visual baseline exists but is not committed: $windowsSnapshotRelative"
    }
    $nodeVersion = (& node --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
        throw "Node.js 24 LTS is required; found '$nodeVersion'."
    }
    $rustVersion = (& rustc --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $rustVersion -notmatch '^rustc 1\.97\.1\b') {
        throw "Rust 1.97.1 is required; found '$rustVersion'."
    }
    $installedTargets = @(& rustup target list --installed)
    if ($LASTEXITCODE -ne 0 -or $installedTargets -notcontains $targetTriple) {
        throw "Rust target $targetTriple is not installed."
    }
    if (-not (Test-Path -LiteralPath $windowsSnapshot -PathType Leaf)) {
        throw "The reviewed Windows visual baseline is missing. Run .\scripts\capture-windows-visual-baseline.ps1, inspect the PNG, and commit it before the release build."
    }

    $sourceCommit = (& git rev-parse HEAD | Out-String).Trim()
    Write-Host "Node: $nodeVersion"
    Write-Host "Rust: $rustVersion"
    Write-Host "Reviewed source commit: $sourceCommit"
    Invoke-Checked "npm" @("ci")
    Invoke-Checked "npm" @("run", "typecheck")
    Invoke-Checked "npm" @("test")
    Invoke-Checked "npx" @("playwright", "install", "chromium")
    Invoke-Checked "npm" @("run", "test:e2e")
    Invoke-Checked "cargo" @("check", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple)
    Invoke-Checked "cargo" @("test", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple)
    Invoke-Checked "cargo" @("test", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple, "keychain::tests::installed_windows_credential_manager_local_round_trip_smoke", "--", "--ignored", "--exact")
    if (Test-Path -LiteralPath $bundleDirectory -PathType Container) {
        Get-ChildItem -LiteralPath $bundleDirectory -Filter "*.exe" -File | Remove-Item -Force
    }
    Invoke-Checked "npm" @("run", "tauri", "--", "build", "--target", $targetTriple, "--ci", "--no-sign")

    $installers = @(Get-ChildItem -LiteralPath $bundleDirectory -Filter "*.exe" -File)
    if ($installers.Count -ne 1) {
        throw "Expected exactly one newly built NSIS installer in $bundleDirectory; found $($installers.Count)"
    }

    $scanTargets = @($releaseExecutable)
    $scanTargets += @(Get-ChildItem -LiteralPath $distDirectory -Recurse -File | ForEach-Object { $_.FullName })
    $scanTargets += @($installers | ForEach-Object { $_.FullName })
    Assert-NoReleaseTestHooks -Paths $scanTargets
    Write-Host "Build-output test-hook exclusion scan: passed for $($scanTargets.Count) files"
    Write-Host "After installation, run scripts\verify-windows-installed-bundle.ps1 against the actual install directory to scan the decompressed payload."

    Write-Host "Windows internal installers:"
    foreach ($installer in $installers) {
        $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
        Write-Host ("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), $installer.FullName)
    }
}
finally {
    Pop-Location
}
