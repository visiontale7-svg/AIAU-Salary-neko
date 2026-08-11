[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "The Windows visual baseline must be captured on a real Windows runner."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$snapshot = Join-Path $projectRoot "tests\e2e\dialogue-atlas.spec.ts-snapshots\b5-atlas-1536x1024-win32.png"

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
    Invoke-Checked "npm" @("ci")
    Invoke-Checked "npx" @("playwright", "install", "chromium")
    Invoke-Checked "npx" @(
        "playwright",
        "test",
        "tests/e2e/dialogue-atlas.spec.ts",
        "--grep",
        "renders the approved 1536×1024 graph-first frame",
        "--update-snapshots"
    )
    if (-not (Test-Path -LiteralPath $snapshot -PathType Leaf)) {
        throw "Playwright did not create the expected Windows snapshot at $snapshot"
    }
    Write-Host "Review this Windows-only baseline before committing it: $snapshot"
    Start-Process -FilePath $snapshot
}
finally {
    Pop-Location
}

