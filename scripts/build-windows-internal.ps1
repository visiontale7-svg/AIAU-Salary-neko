[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "This build must run on a Windows host; cross-compilation is not an acceptance result."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetTriple = "x86_64-pc-windows-msvc"
$manifestPath = Join-Path $projectRoot "src-tauri\Cargo.toml"
$bundleDirectory = Join-Path $projectRoot "src-tauri\target\$targetTriple\release\bundle\nsis"
$windowsSnapshot = Join-Path $projectRoot "tests\e2e\dialogue-atlas.spec.ts-snapshots\b5-atlas-1536x1024-win32.png"

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

Push-Location $projectRoot
try {
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

    Write-Host "Node: $nodeVersion"
    Write-Host "Rust: $rustVersion"
    Invoke-Checked "npm" @("ci")
    Invoke-Checked "npm" @("run", "typecheck")
    Invoke-Checked "npm" @("test")
    Invoke-Checked "npx" @("playwright", "install", "chromium")
    Invoke-Checked "npm" @("run", "test:e2e")
    Invoke-Checked "cargo" @("check", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple)
    Invoke-Checked "cargo" @("test", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple)
    Invoke-Checked "cargo" @("test", "--locked", "--manifest-path", $manifestPath, "--target", $targetTriple, "keychain::tests::installed_windows_credential_manager_local_round_trip_smoke", "--", "--ignored", "--exact")
    Invoke-Checked "npm" @("run", "tauri", "--", "build", "--target", $targetTriple, "--ci", "--no-sign")

    $installers = @(Get-ChildItem -LiteralPath $bundleDirectory -Filter "*.exe" -File)
    if ($installers.Count -eq 0) {
        throw "No NSIS installer was produced in $bundleDirectory"
    }

    Write-Host "Windows internal installers:"
    foreach ($installer in $installers) {
        $hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
        Write-Host ("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), $installer.FullName)
    }
}
finally {
    Pop-Location
}
