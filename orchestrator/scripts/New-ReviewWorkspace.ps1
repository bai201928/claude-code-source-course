# New-ReviewWorkspace.ps1
# Creates an isolated review workspace for a DeepSeek fact/teaching review session.
#
# Usage:
#   .\New-ReviewWorkspace.ps1 -UnitId M03 -ReviewType fact -Attempt 1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^M\d{2}$')]
    [string]$UnitId,

    [Parameter(Mandatory=$true)]
    [ValidateSet('fact', 'teaching')]
    [string]$ReviewType,

    [Parameter(Mandatory=$true)]
    [ValidateRange(1, 3)]
    [int]$Attempt
)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")

# ---- Create workspace directory ----
$wsName = "$UnitId-$ReviewType-attempt-$Attempt"
$wsPath = Join-Path $projectRoot "review-workspaces" $wsName

if (Test-Path $wsPath) {
    Write-Host "[WARNING] Workspace already exists: $wsName"
    Write-Host "Removing old workspace..."
    Remove-Item -Recurse -Force $wsPath
}

Write-Host "Creating review workspace: $wsName"

# Subdirectories
$subDirs = @(
    "prompts",
    "evidence",
    "source-copy",
    "tests-copy",
    "codex-claims",
    "experiments",
    "results"
)

foreach ($sd in $subDirs) {
    New-Item -ItemType Directory -Force (Join-Path $wsPath $sd) | Out-Null
}

# ---- Copy CLAUDE.md from review-template ----
$templateClaude = Join-Path $projectRoot "review-template" "CLAUDE.md"
if (Test-Path $templateClaude) {
    Copy-Item $templateClaude (Join-Path $wsPath "CLAUDE.md")
    Write-Host "[OK] Copied CLAUDE.md"
} else {
    Write-Host "[WARNING] review-template/CLAUDE.md not found — workspace will lack isolation rules"
}

# ---- Write workspace metadata ----
$metaJson = @{
    workspace_name = $wsName
    unit_id = $UnitId
    review_type = $ReviewType
    attempt = $Attempt
    created_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
    project_root = $projectRoot.ToString()
} | ConvertTo-Json

$metaJson | Out-File (Join-Path $wsPath "workspace-meta.json") -Encoding utf8NoBOM

Write-Host ""
Write-Host "=== Workspace created ==="
Write-Host "Path: $wsPath"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Copy evidence (source snippets, tests) into evidence/"
if ($ReviewType -eq "fact") {
    Write-Host "  2. Copy prompts/fact-review-a.md for Stage A"
    Write-Host "  3. Do NOT copy Codex claims for Stage A"
    Write-Host "  4. Run Start-DeepSeekClaude.ps1 -WorkingDir '$wsPath'"
} else {
    Write-Host "  2. Copy the teaching draft into evidence/"
    Write-Host "  3. Copy teaching-review.md prompt"
    Write-Host "  4. Run Start-DeepSeekClaude.ps1 -WorkingDir '$wsPath'"
}

# Return the workspace path as output
return $wsPath
