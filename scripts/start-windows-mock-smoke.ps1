[CmdletBinding()]
param(
    [ValidateSet("success", "partial", "invalid_evidence", "retry_once", "slow")]
    [string]$Scenario = "success"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
    throw "This native smoke helper must run on Windows."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$stdoutPath = Join-Path $env:TEMP ("dialogue-atlas-mock-{0}.out" -f [Guid]::NewGuid())
$stderrPath = Join-Path $env:TEMP ("dialogue-atlas-mock-{0}.err" -f [Guid]::NewGuid())
$requestLog = Join-Path $env:TEMP ("dialogue-atlas-requests-{0}.jsonl" -f [Guid]::NewGuid())
$credentialAccount = "dialogue-atlas-smoke-$([Guid]::NewGuid().ToString('N'))"
$credentialTarget = "$credentialAccount.com.visiontale.dialogueatlas"
$mockProcess = $null

Push-Location $projectRoot
try {
    $env:DIALOGUE_ATLAS_MOCK_SCENARIO = $Scenario
    $env:DIALOGUE_ATLAS_MOCK_LOG = $requestLog
    $env:DIALOGUE_ATLAS_CREDENTIAL_ACCOUNT = $credentialAccount
    $mockProcess = Start-Process -FilePath "node" -ArgumentList @("tests/helpers/mock-openai-server.mjs") -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $deadline = (Get-Date).AddSeconds(10)
    $metadata = $null
    while ((Get-Date) -lt $deadline) {
        if ($mockProcess.HasExited) {
            throw "The local mock exited before startup: $(Get-Content -LiteralPath $stderrPath -Raw)"
        }
        if (Test-Path -LiteralPath $stdoutPath) {
            $firstLine = Get-Content -LiteralPath $stdoutPath -TotalCount 1
            if ($firstLine) {
                $metadata = $firstLine | ConvertFrom-Json
                break
            }
        }
        Start-Sleep -Milliseconds 100
    }
    if ($null -eq $metadata) {
        throw "The local mock did not report its endpoint within 10 seconds."
    }

    $env:OPENAI_BASE_URL = $metadata.baseUrl
    Write-Host "Local OpenAI acceptance endpoint: $($metadata.baseUrl)"
    Write-Host "Enter this TEST-ONLY key in Dialogue Atlas settings: $($metadata.apiKey)"
    Write-Host "Captured requests will be written to: $requestLog"
    & npm run tauri -- dev
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri development app exited with code $LASTEXITCODE"
    }
}
finally {
    if ($null -ne $mockProcess -and -not $mockProcess.HasExited) {
        Stop-Process -Id $mockProcess.Id -Force
    }
    & cmdkey.exe "/delete:$credentialTarget" *> $null
    Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DIALOGUE_ATLAS_MOCK_SCENARIO -ErrorAction SilentlyContinue
    Remove-Item Env:DIALOGUE_ATLAS_MOCK_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:DIALOGUE_ATLAS_CREDENTIAL_ACCOUNT -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    Pop-Location
}
