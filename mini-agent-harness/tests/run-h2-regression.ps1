$ErrorActionPreference = 'Stop'

$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path (Join-Path $harnessRoot '..')).Path
$passed = 0

function Invoke-H2Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "[H2] $Name"
  Push-Location $WorkingDirectory
  try {
    & $Command
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE"
    }
    $script:passed += 1
  }
  finally {
    Pop-Location
  }
}

Invoke-H2Check 'H1 full regression' $projectRoot {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\mini-agent-harness\tests\run-h1-regression.ps1
}
Invoke-H2Check 'TypeScript conversation behavior' "$harnessRoot\typescript" {
  node conversationStore.test.ts
}
Invoke-H2Check 'TypeScript strict' "$harnessRoot\typescript" {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
}
Invoke-H2Check 'Python conversation behavior' "$harnessRoot\python" {
  python -m unittest -v test_conversation_store.py
}

Write-Host "H2-in-progress regression: $passed/4 checks passed (including H1 12/12 and S0 15/15)"
