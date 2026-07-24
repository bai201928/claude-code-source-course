# Verify-Environment.ps1
# Checks that all required tools and project files are present.
# Does NOT print API keys, tokens, or credentials.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Claude Code Curriculum — Environment Verification ==="
Write-Host ""

# ---- Project root ----
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")
Write-Host "[PROJECT] Root: $projectRoot"

# ---- 1.md ----
$oneMd = Join-Path $projectRoot "1.md"
if (Test-Path $oneMd) {
    Write-Host "[OK] 1.md: present"
} else {
    Write-Host "[MISSING] 1.md"
}

# ---- Git ----
try {
    $gitVersion = & git --version 2>&1
    Write-Host "[OK] git: $gitVersion"
} catch {
    Write-Host "[MISSING] git"
}

# ---- Node ----
try {
    $nodeVersion = & node --version 2>&1
    Write-Host "[OK] node: $nodeVersion"
} catch {
    Write-Host "[MISSING] node"
}

# ---- Python ----
try {
    $pyVersion = & python --version 2>&1
    Write-Host "[OK] python: $pyVersion"
} catch {
    try {
        $pyVersion = & py --version 2>&1
        Write-Host "[OK] py: $pyVersion"
    } catch {
        Write-Host "[MISSING] python / py"
    }
}

# ---- Codex (Windows native) ----
try {
    $codexVersion = & codex --version 2>&1
    Write-Host "[OK] codex (Windows): $codexVersion"
    $codexWindows = $true
} catch {
    Write-Host "[MISSING] codex (Windows native)"
    $codexWindows = $false
}

# ---- Codex (WSL) ----
try {
    $wslCodex = & wsl.exe bash -lc "command -v codex 2>/dev/null && codex --version 2>/dev/null || echo 'NOT_FOUND'" 2>&1
    if ($wslCodex -match "NOT_FOUND") {
        Write-Host "[INFO] codex (WSL): not found"
        $codexWsl = $false
    } else {
        Write-Host "[OK] codex (WSL): $wslCodex"
        $codexWsl = $true
    }
} catch {
    Write-Host "[INFO] codex (WSL): could not check"
    $codexWsl = $false
}

# ---- Claude Code ----
try {
    $claudeVersion = & claude --version 2>&1
    Write-Host "[OK] claude: $claudeVersion"
} catch {
    Write-Host "[MISSING] claude"
}

# ---- DeepSeek / API configuration (no values printed) ----
$deepseekConfigured = $false
if (Test-Path env:DEEPSEEK_API_KEY) {
    $deepseekConfigured = $true
}
if (Test-Path env:ANTHROPIC_BASE_URL) {
    $deepseekConfigured = $true
}
if (Test-Path env:ANTHROPIC_AUTH_TOKEN) {
    $deepseekConfigured = $true
}
if ($deepseekConfigured) {
    Write-Host "[OK] DeepSeek/Anthropic API: configured"
} else {
    Write-Host "[WARNING] DeepSeek/Anthropic API: not detected (DEEPSEEK_API_KEY/ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN)"
}

# ---- Source snapshot ----
$snapshotPath = Join-Path $projectRoot "source-snapshot"
$snapshotJson = Join-Path $snapshotPath "SNAPSHOT.json"
$claudeCodePath = Join-Path $projectRoot "claude-code-CLI"

if (Test-Path $snapshotJson) {
    Write-Host "[OK] source-snapshot/SNAPSHOT.json: present"
} else {
    Write-Host "[WARNING] source-snapshot/SNAPSHOT.json: missing"
}

if ((Test-Path $claudeCodePath) -and (Test-Path (Join-Path $claudeCodePath "src"))) {
    $tsCount = (Get-ChildItem -Path (Join-Path $claudeCodePath "src") -Recurse -Filter "*.ts" -ErrorAction SilentlyContinue).Count
    Write-Host "[OK] claude-code-CLI/src/: $tsCount TypeScript files found (source snapshot candidate)"
} else {
    Write-Host "[WARNING] claude-code-CLI/src/: not found (source snapshot may be missing)"
}

# ---- Required files checklist ----
$requiredFiles = @(
    "AGENTS.md",
    ".gitignore",
    "input/learner-profile.md",
    "input/project-decisions.md",
    "input/original-course.md",
    "input/required-topics.yaml",
    "orchestrator/config/course.yaml",
    "orchestrator/config/risk-rules.yaml",
    "orchestrator/config/release-rules.yaml",
    "orchestrator/prompts/codex-orchestrator.md",
    "orchestrator/prompts/fact-review-a.md",
    "orchestrator/prompts/fact-review-b.md",
    "orchestrator/prompts/teaching-review.md",
    "orchestrator/prompts/json-repair.md",
    "orchestrator/prompts/stage-release-review.md",
    "orchestrator/schemas/fact-review-a.schema.json",
    "orchestrator/schemas/fact-review-b.schema.json",
    "orchestrator/schemas/teaching-review.schema.json",
    "orchestrator/schemas/adjudication.schema.json",
    "orchestrator/schemas/knowledge-base.schema.json",
    "review-template/CLAUDE.md",
    "FIRST_CODEX_PROMPT.md"
)

Write-Host ""
Write-Host "--- Required Files ---"
$allFilesPresent = $true
foreach ($file in $requiredFiles) {
    $fullPath = Join-Path $projectRoot $file
    if (Test-Path $fullPath) {
        Write-Host "[OK] $file"
    } else {
        Write-Host "[MISSING] $file"
        $allFilesPresent = $false
    }
}

# ---- Summary ----
Write-Host ""
Write-Host "=== Summary ==="
Write-Host "Codex Windows native: $codexWindows"
Write-Host "Codex WSL: $codexWsl"
if ($codexWindows) {
    Write-Host "Recommended launcher: Start-Codex.ps1"
} elseif ($codexWsl) {
    Write-Host "Recommended launcher: Start-Codex-WSL.ps1"
} else {
    Write-Host "Recommended launcher: NONE AVAILABLE — install Codex first"
}
Write-Host "DeepSeek configured: $deepseekConfigured"
Write-Host "All required files: $allFilesPresent"

if (-not $allFilesPresent) {
    exit 1
}
exit 0
