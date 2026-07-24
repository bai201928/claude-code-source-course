# Test-Bootstrap.ps1
# Runs comprehensive checks on the bootstrapped project.
# Warnings for missing source/course do NOT cause overall failure.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")
$warnings = @()
$errors = @()

Write-Host "=== Bootstrap Validation ==="
Write-Host "Project: $projectRoot"
Write-Host ""

# -----------------------------------------------------------
# 1. Directory structure
# -----------------------------------------------------------
$requiredDirs = @(
    "input",
    "source-snapshot",
    "orchestrator/config",
    "orchestrator/prompts",
    "orchestrator/schemas",
    "orchestrator/scripts",
    "review-template",
    "curriculum/design",
    "curriculum/global",
    "curriculum/units",
    "curriculum/stages",
    "mini-agent-harness/contracts",
    "mini-agent-harness/typescript",
    "mini-agent-harness/python",
    "mini-agent-harness/java-exercises",
    "mini-agent-harness/tests",
    "mini-agent-harness/architecture",
    "review-workspaces",
    "tmp"
)

Write-Host "--- Directories ---"
foreach ($d in $requiredDirs) {
    $p = Join-Path $projectRoot $d
    if (Test-Path $p) {
        Write-Host "[OK] $d/"
    } else {
        Write-Host "[ERROR] $d/ missing"
        $errors += "Directory missing: $d"
    }
}

# -----------------------------------------------------------
# 2. JSON syntax validation
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- JSON Syntax ---"
$jsonFiles = Get-ChildItem -Path (Join-Path $projectRoot "orchestrator/schemas") -Filter "*.json" -ErrorAction SilentlyContinue
foreach ($jf in $jsonFiles) {
    try {
        $content = Get-Content $jf.FullName -Raw -ErrorAction Stop
        $null = [System.Text.Json.JsonDocument]::Parse($content)
        Write-Host "[OK] $($jf.Name) — valid JSON"
    } catch {
        Write-Host "[ERROR] $($jf.Name) — invalid JSON: $_"
        $errors += "Invalid JSON: $($jf.Name)"
    }
}

# Also check SNAPSHOT.json if it exists
$snapshotJson = Join-Path $projectRoot "source-snapshot/SNAPSHOT.json"
if (Test-Path $snapshotJson) {
    try {
        $content = Get-Content $snapshotJson -Raw -ErrorAction Stop
        $null = [System.Text.Json.JsonDocument]::Parse($content)
        Write-Host "[OK] source-snapshot/SNAPSHOT.json — valid JSON"
    } catch {
        Write-Host "[ERROR] source-snapshot/SNAPSHOT.json — invalid JSON: $_"
        $errors += "Invalid JSON: SNAPSHOT.json"
    }
}

# -----------------------------------------------------------
# 3. YAML files non-empty check
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- YAML Files ---"
$yamlFiles = @(
    "input/required-topics.yaml",
    "orchestrator/config/course.yaml",
    "orchestrator/config/risk-rules.yaml",
    "orchestrator/config/release-rules.yaml"
)
foreach ($yf in $yamlFiles) {
    $p = Join-Path $projectRoot $yf
    if (Test-Path $p) {
        $size = (Get-Item $p).Length
        if ($size -gt 0) {
            Write-Host "[OK] $yf ($size bytes)"
        } else {
            Write-Host "[ERROR] $yf — empty file"
            $errors += "Empty YAML: $yf"
        }
    }
}

# -----------------------------------------------------------
# 4. PowerShell script syntax check
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- PowerShell Scripts ---"
$psFiles = Get-ChildItem -Path (Join-Path $projectRoot "orchestrator/scripts") -Filter "*.ps1" -ErrorAction SilentlyContinue
foreach ($psf in $psFiles) {
    try {
        $null = [System.Management.Automation.Language.Parser]::ParseFile(
            $psf.FullName, [ref]$null, [ref]$null
        )
        Write-Host "[OK] $($psf.Name) — parseable"
    } catch {
        Write-Host "[ERROR] $($psf.Name) — parse error: $_"
        $errors += "PS parse error: $($psf.Name)"
    }
}

# -----------------------------------------------------------
# 5. Markdown files non-empty check
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- Markdown Files ---"
$mdFiles = Get-ChildItem -Path $projectRoot -Filter "*.md" -ErrorAction SilentlyContinue
$mdFiles += Get-ChildItem -Path (Join-Path $projectRoot "input") -Filter "*.md" -ErrorAction SilentlyContinue
$mdFiles += Get-ChildItem -Path (Join-Path $projectRoot "orchestrator/prompts") -Filter "*.md" -ErrorAction SilentlyContinue
foreach ($mf in $mdFiles) {
    $size = $mf.Length
    if ($size -gt 0) {
        Write-Host "[OK] $($mf.Name) ($size bytes)"
    } else {
        Write-Host "[ERROR] $($mf.Name) — empty file"
        $errors += "Empty markdown: $($mf.Name)"
    }
}

# -----------------------------------------------------------
# 6. FIRST_CODEX_PROMPT.md
# -----------------------------------------------------------
$firstPromptPath = Join-Path $projectRoot "FIRST_CODEX_PROMPT.md"
if (Test-Path $firstPromptPath) {
    $content = Get-Content $firstPromptPath -Raw
    if ($content -match "禁止.*生成.*正式教材|forbid.*unit.*body|本次禁止" -or $content -match "不得.*编写.*教材") {
        Write-Host "[OK] FIRST_CODEX_PROMPT.md — forbids formal unit generation"
    } else {
        Write-Host "[WARNING] FIRST_CODEX_PROMPT.md — may not explicitly forbid unit body generation"
        $warnings += "FIRST_CODEX_PROMPT.md may not forbid unit generation"
    }
}

# -----------------------------------------------------------
# 7. AGENTS.md snapshot read-only rule
# -----------------------------------------------------------
$agentsPath = Join-Path $projectRoot "AGENTS.md"
if (Test-Path $agentsPath) {
    $content = Get-Content $agentsPath -Raw
    if ($content -match "只读|read.only|不得修改.*快照|不得修改.*snapshot") {
        Write-Host "[OK] AGENTS.md — enforces snapshot read-only"
    } else {
        Write-Host "[WARNING] AGENTS.md — may not explicitly forbid snapshot modification"
        $warnings += "AGENTS.md may not forbid snapshot modification"
    }
    if ($content -match "30.*45|30～45") {
        Write-Host "[OK] AGENTS.md — specifies 30-45 unit range"
    } else {
        Write-Host "[WARNING] AGENTS.md — 30-45 unit range not found"
        $warnings += "AGENTS.md missing 30-45 unit range"
    }
}

# -----------------------------------------------------------
# 8. Credential scan (basic)
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- Credential Scan ---"
$credPatterns = @(
    'sk-ant-[a-zA-Z0-9_-]+',
    'sk-[a-zA-Z0-9]{32,}',
    'ANTHROPIC_AUTH_TOKEN\s*=\s*[''"]?\S+[''"]?',
    'ANTHROPIC_API_KEY\s*=\s*[''"]?\S+[''"]?',
    'DEEPSEEK_API_KEY\s*=\s*[''"]?\S+[''"]?'
)
$filesToScan = Get-ChildItem -Path $projectRoot -Recurse -Include @("*.md","*.yaml","*.yml","*.json","*.ps1","*.txt") -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\\.git\\' -and
        $_.FullName -notmatch '\\node_modules\\' -and
        $_.FullName -notmatch '\\repos\\' -and
        $_.FullName -notmatch '\\claude-code-CLI\\'
    }

$credHits = @()
foreach ($file in $filesToScan) {
    $text = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    foreach ($pat in $credPatterns) {
        if ($text -match $pat) {
            $credHits += "$($file.Name): potential credential match"
        }
    }
}
if ($credHits.Count -eq 0) {
    Write-Host "[OK] No credential patterns detected in generated files"
} else {
    Write-Host "[WARNING] Potential credential references found:"
    foreach ($hit in $credHits) {
        Write-Host "  - $hit"
    }
    $warnings += "Credential patterns detected"
}

# -----------------------------------------------------------
# 9. Source snapshot / original course warnings
# -----------------------------------------------------------
Write-Host ""
Write-Host "--- Content Warnings ---"
$originalCoursePath = Join-Path $projectRoot "input/original-course.md"
$ocContent = Get-Content $originalCoursePath -Raw -ErrorAction SilentlyContinue
if ($ocContent -match "状态.*missing|status.*missing|待补充") {
    Write-Host "[WARNING] original-course.md: still in placeholder state"
    $warnings += "original-course.md is placeholder — needs real content before first Codex run"
} else {
    Write-Host "[OK] original-course.md: has real content"
}

$snapshotReadme = Join-Path $projectRoot "source-snapshot/README.md"
if (Test-Path $snapshotReadme) {
    Write-Host "[OK] source-snapshot/README.md: present"
} else {
    Write-Host "[WARNING] source-snapshot/README.md: missing"
    $warnings += "source-snapshot/README.md missing"
}

# -----------------------------------------------------------
# Summary
# -----------------------------------------------------------
Write-Host ""
Write-Host "=== Bootstrap Test Summary ==="
Write-Host "Errors: $($errors.Count)"
foreach ($e in $errors) { Write-Host "  [ERROR] $e" }
Write-Host "Warnings: $($warnings.Count)"
foreach ($w in $warnings) { Write-Host "  [WARNING] $w" }

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "RESULT: FAILED ($($errors.Count) errors, $($warnings.Count) warnings)"
    exit 1
} else {
    Write-Host ""
    Write-Host "RESULT: PASSED ($($warnings.Count) warnings)"
    exit 0
}
