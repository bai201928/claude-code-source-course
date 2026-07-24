# Start-Codex.ps1
# Launches interactive Codex from the project root with safe sandbox settings.
# Does NOT auto-execute FIRST_CODEX_PROMPT.md.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")

# Check prerequisites
$agentsMd = Join-Path $projectRoot "AGENTS.md"
$firstPrompt = Join-Path $projectRoot "FIRST_CODEX_PROMPT.md"

if (-not (Test-Path $agentsMd)) {
    Write-Host "[FATAL] AGENTS.md not found at: $agentsMd" -ForegroundColor Red
    Write-Host "Please run bootstrap initialization first."
    exit 1
}

if (-not (Test-Path $firstPrompt)) {
    Write-Host "[ERROR] FIRST_CODEX_PROMPT.md not found at: $firstPrompt" -ForegroundColor Red
    Write-Host "Please create it first." -ForegroundColor Red
    exit 1
}

# Check if Codex exists on Windows
$codexPath = (Get-Command codex -ErrorAction SilentlyContinue).Source
if (-not $codexPath) {
    Write-Host "[FATAL] codex not found in Windows PATH." -ForegroundColor Red
    Write-Host "Try running Start-Codex-WSL.ps1 if Codex is installed in WSL." -ForegroundColor Yellow
    exit 1
}

Write-Host "Codex found at: $codexPath"
Write-Host ""

# Get Codex help to verify it works and check available options
Write-Host "Checking Codex capabilities..."
$helpOutput = & codex --help 2>&1
Write-Host ""

# Determine safe sandbox mode
# Prefer workspace-write if available, otherwise fall back to read-only
$sandboxFlag = "--sandbox"
$sandboxMode = "workspace-write"

# Check if codex supports --sandbox flag
if ($helpOutput -match '--sandbox') {
    Write-Host "Sandbox mode: $sandboxMode"
} else {
    Write-Host "[INFO] --sandbox flag not detected; launching with defaults"
    $sandboxFlag = $null
}

Write-Host ""
Write-Host "=== Launching interactive Codex ==="
Write-Host "Project root: $projectRoot"
Write-Host "AGENTS.md: present"
Write-Host "FIRST_CODEX_PROMPT.md: present (copy content into Codex when ready)"
Write-Host ""
Write-Host "IMPORTANT: Do NOT auto-execute FIRST_CODEX_PROMPT.md."
Write-Host "           Read and confirm understanding first."
Write-Host ""

# Change to project root
Set-Location $projectRoot

# Launch Codex
if ($sandboxFlag) {
    & codex $sandboxFlag $sandboxMode
} else {
    & codex
}

exit $LASTEXITCODE
