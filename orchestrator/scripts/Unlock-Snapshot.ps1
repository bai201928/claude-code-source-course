# Unlock-Snapshot.ps1
# Removes the read-only attribute set by Lock-Snapshot.ps1.
# Only processes the specified snapshot directory.
#
# Usage:
#   .\Unlock-Snapshot.ps1 [-SnapshotPath <path>]
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
    [Parameter(Mandatory=$false)]
    [string]$SnapshotPath
)

# Default to project source-snapshot
if (-not $SnapshotPath) {
    $projectRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "..")
    $SnapshotPath = Join-Path $projectRoot "source-snapshot"
}

$claudeCliPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot ".." "..")) "claude-code-CLI"

Write-Host "=== Unlock-Snapshot ==="
Write-Host ""

$totalFiles = 0
$errors = @()

function Unlock-DirectoryTree {
    param([string]$Path, [string]$Label)

    if (-not (Test-Path $Path)) {
        Write-Host "[SKIP] $Label: path does not exist"
        return
    }

    Write-Host "[UNLOCK] $Label: $Path"

    $files = Get-ChildItem -Path $Path -File -Recurse -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        try {
            # Remove ReadOnly attribute
            if ($file.Attributes -band [System.IO.FileAttributes]::ReadOnly) {
                $file.Attributes = $file.Attributes -bxor [System.IO.FileAttributes]::ReadOnly
                $script:totalFiles++
            }
        } catch {
            $script:errors += "Failed to unlock: $($file.FullName): $_"
        }
    }
}

# Unlock source-snapshot/
Unlock-DirectoryTree -Path $SnapshotPath -Label "source-snapshot"

# Unlock claude-code-CLI/ if present
Unlock-DirectoryTree -Path $claudeCliPath -Label "claude-code-CLI"

Write-Host ""
Write-Host "=== Unlock Summary ==="
Write-Host "Files unlocked: $totalFiles"
if ($errors.Count -gt 0) {
    Write-Host "Errors: $($errors.Count)"
    foreach ($e in $errors) {
        Write-Host "  [ERROR] $e"
    }
    exit 1
} else {
    Write-Host "[OK] Snapshot unlocked successfully."
}

exit 0
