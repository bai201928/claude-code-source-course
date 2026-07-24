# Start-Codex-WSL.ps1
# Launches Codex inside WSL2 from the Windows project directory.
# Converts the Windows path to a WSL-compatible path.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")

Write-Host "=== WSL Codex Launcher ==="
Write-Host ""

# Check WSL availability
$wslAvailable = $null
try {
    $wslAvailable = wsl.exe --version 2>&1
    Write-Host "[OK] WSL is available"
} catch {
    Write-Host "[FATAL] WSL is not available on this system." -ForegroundColor Red
    exit 1
}

# Check if Codex exists inside WSL
Write-Host "Checking Codex in WSL..."
$wslCodexCheck = wsl.exe bash -lc "command -v codex 2>/dev/null || echo 'NOT_FOUND'" 2>&1
if ($wslCodexCheck -match "NOT_FOUND" -or [string]::IsNullOrWhiteSpace($wslCodexCheck)) {
    Write-Host "[FATAL] Codex not found inside WSL." -ForegroundColor Red
    Write-Host "Please install Codex in WSL first:" -ForegroundColor Yellow
    Write-Host "  wsl.exe bash" -ForegroundColor Yellow
    Write-Host "  npm install -g @openai/codex" -ForegroundColor Yellow
    Write-Host "  codex --login" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Codex found in WSL: $wslCodexCheck"

# Convert Windows path to WSL path
# e.g., D:\agent\Claude code最新 -> /mnt/d/agent/Claude code最新
$winPath = $projectRoot.ToString()
$driveLetter = $winPath.Substring(0, 1).ToLower()
$pathRest = $winPath.Substring(2).Replace('\', '/')
$wslPath = "/mnt/$driveLetter$pathRest"

Write-Host ""
Write-Host "Windows path: $winPath"
Write-Host "WSL path:    $wslPath"
Write-Host ""

# Check prerequisites
$agentsMd = Join-Path $projectRoot "AGENTS.md"
$firstPrompt = Join-Path $projectRoot "FIRST_CODEX_PROMPT.md"

if (-not (Test-Path $agentsMd)) {
    Write-Host "[FATAL] AGENTS.md not found."
    exit 1
}
if (-not (Test-Path $firstPrompt)) {
    Write-Host "[WARNING] FIRST_CODEX_PROMPT.md not found."
}

Write-Host "=== Launching Codex in WSL ==="
Write-Host "IMPORTANT: Do NOT auto-execute FIRST_CODEX_PROMPT.md."
Write-Host ""

# Launch codex in WSL
wsl.exe bash -lc "cd `"$wslPath`" && codex --sandbox workspace-write"

exit $LASTEXITCODE
