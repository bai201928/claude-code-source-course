# Start-DeepSeekClaude.ps1
# Launches Claude Code configured against DeepSeek API for review tasks.
# Does NOT print API keys. Does NOT modify user environment variables.
#
# Usage:
#   .\Start-DeepSeekClause.ps1 -WorkingDir <path> [-PromptFile <path>]
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
    [Parameter(Mandatory=$true)]
    [string]$WorkingDir,

    [Parameter(Mandatory=$false)]
    [string]$PromptFile,

    [Parameter(Mandatory=$false)]
    [switch]$PlanMode = $false
)

# ---- Validate working directory ----
if (-not (Test-Path $WorkingDir)) {
    Write-Host "[FATAL] Working directory does not exist: $WorkingDir" -ForegroundColor Red
    exit 1
}
$WorkingDir = Resolve-Path $WorkingDir

Write-Host "=== DeepSeek Claude Code Launcher ==="
Write-Host "Working directory: $WorkingDir"

# ---- Check required environment (no values printed) ----
$apiConfigured = $false
if (Test-Path env:ANTHROPIC_BASE_URL) {
    Write-Host "[OK] ANTHROPIC_BASE_URL: configured"
    $apiConfigured = $true
} else {
    Write-Host "[WARNING] ANTHROPIC_BASE_URL: not set"
}
if (Test-Path env:ANTHROPIC_AUTH_TOKEN) {
    Write-Host "[OK] ANTHROPIC_AUTH_TOKEN: configured"
    $apiConfigured = $true
} else {
    Write-Host "[WARNING] ANTHROPIC_AUTH_TOKEN: not set"
}
if (Test-Path env:DEEPSEEK_API_KEY) {
    Write-Host "[OK] DEEPSEEK_API_KEY: configured"
    $apiConfigured = $true
}
if (Test-Path env:ANTHROPIC_MODEL) {
    Write-Host "[OK] ANTHROPIC_MODEL: $env:ANTHROPIC_MODEL"
}

if (-not $apiConfigured) {
    Write-Host "[FATAL] No DeepSeek/Anthropic API configuration detected." -ForegroundColor Red
    Write-Host "Please set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN (or DEEPSEEK_API_KEY)."
    exit 1
}

# ---- Check Claude Code available ----
$claudePath = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claudePath) {
    Write-Host "[FATAL] claude not found in PATH." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Claude Code: $claudePath"

# ---- Check prompt file ----
$promptArg = @()
if ($PromptFile) {
    if (Test-Path $PromptFile) {
        $promptContent = Get-Content $PromptFile -Raw
        Write-Host "[OK] Prompt file: $PromptFile ($($promptContent.Length) chars)"
        $promptArg = @("-p", $promptContent)
    } else {
        Write-Host "[FATAL] Prompt file not found: $PromptFile"
        exit 1
    }
}

# ---- Check for CLAUDE.md in working dir ----
$claudeMd = Join-Path $WorkingDir "CLAUDE.md"
if (Test-Path $claudeMd) {
    Write-Host "[OK] CLAUDE.md found in working directory"
} else {
    Write-Host "[WARNING] No CLAUDE.md in working directory — Claude Code may access project root rules"
}

# ---- Launch ----
Write-Host ""
Write-Host "=== Launching Claude Code (DeepSeek) ==="

Set-Location $WorkingDir

$args = @(
    "--output-format", "json",
    "--max-turns", "12"
)

if ($PlanMode) {
    $args += "--permission-mode", "plan"
} else {
    $args += "--permission-mode", "plan"
}

if ($promptArg.Count -gt 0) {
    $args += $promptArg
}

& claude @args

exit $LASTEXITCODE
