# Lock-Snapshot.ps1
# Sets all files in the specified snapshot directory to read-only.
# Does NOT change file ownership or apply non-recoverable ACL rules.
# Uses Windows file attributes (ReadOnly) for safety.
#
# Usage:
#   .\Lock-Snapshot.ps1 [-SnapshotPath <path>]
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

# Also check claude-code-CLI if it exists (the actual source location)
$claudeCliPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot ".." "..")) "claude-code-CLI"

Write-Host "=== Lock-Snapshot ==="
Write-Host ""

$totalFiles = 0
$totalDirs = 0
$errors = @()

# Lock a directory tree
function Lock-DirectoryTree {
    param([string]$Path, [string]$Label)

    if (-not (Test-Path $Path)) {
        Write-Host "[SKIP] $Label: path does not exist"
        return
    }

    Write-Host "[LOCK] $Label: $Path"

    # Get all files
    $files = Get-ChildItem -Path $Path -File -Recurse -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        try {
            # Set ReadOnly attribute (reversible via Unlock-Snapshot.ps1)
            $file.Attributes = $file.Attributes -bor [System.IO.FileAttributes]::ReadOnly
            $script:totalFiles++
        } catch {
            $script:errors += "Failed to lock: $($file.FullName): $_"
        }
    }

    # Count directories
    $dirs = Get-ChildItem -Path $Path -Directory -Recurse -ErrorAction SilentlyContinue
    $script:totalDirs += $dirs.Count
}

# Lock source-snapshot/
Lock-DirectoryTree -Path $SnapshotPath -Label "source-snapshot"

# Lock claude-code-CLI/ if present
Lock-DirectoryTree -Path $claudeCliPath -Label "claude-code-CLI"

Write-Host ""
Write-Host "=== Lock Summary ==="
Write-Host "Files set to read-only: $totalFiles"
Write-Host "Directories scanned: $totalDirs"
if ($errors.Count -gt 0) {
    Write-Host "Errors: $($errors.Count)"
    foreach ($e in $errors) {
        Write-Host "  [ERROR] $e"
    }
    exit 1
} else {
    Write-Host "[OK] Snapshot locked successfully."
}

Write-Host ""
Write-Host "To unlock, run: .\orchestrator\scripts\Unlock-Snapshot.ps1"

exit 0
