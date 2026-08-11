[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "This installed-bundle scan must run on Windows."
}

if (-not (Test-Path -LiteralPath $InstallDirectory -PathType Container)) {
    throw "Installed application directory does not exist: $InstallDirectory"
}

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

$root = (Resolve-Path -LiteralPath $InstallDirectory).Path
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File)
if ($files.Count -eq 0) {
    throw "Installed application directory contains no files: $root"
}

foreach ($file in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
    $utf16 = [System.Text.Encoding]::Unicode.GetString($bytes)
    foreach ($pattern in $forbidden) {
        if ($file.FullName.Contains($pattern) -or $ascii.Contains($pattern) -or $utf16.Contains($pattern)) {
            throw "Installed application contains forbidden test hook '$pattern': $($file.FullName)"
        }
    }
}

Write-Host "Installed payload test-hook exclusion scan: passed for $($files.Count) files under $root"
