$ErrorActionPreference = 'Stop'

$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path (Join-Path $harnessRoot '..')).Path
$passed = 0

function Invoke-H1Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "[H1] $Name"
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

Invoke-H1Check 'S0 full regression' $projectRoot {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\mini-agent-harness\tests\run-s0-regression.ps1
}
Invoke-H1Check 'TypeScript behavior' "$harnessRoot\typescript" { node h1.test.ts }
Invoke-H1Check 'TypeScript configuration behavior' "$harnessRoot\typescript" {
  node configuration.test.ts
}
Invoke-H1Check 'TypeScript runtime context behavior' "$harnessRoot\typescript" {
  node runtimeContext.test.ts
}
Invoke-H1Check 'TypeScript capability projection behavior' "$harnessRoot\typescript" {
  node capabilityProjection.test.ts
}
Invoke-H1Check 'TypeScript lifecycle behavior' "$harnessRoot\typescript" {
  node lifecycleCoordinator.test.ts
}
Invoke-H1Check 'TypeScript strict' "$harnessRoot\typescript" {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1
}
Invoke-H1Check 'Python behavior' "$harnessRoot\python" {
  python -m unittest -v test_h1.py
}
Invoke-H1Check 'Python configuration behavior' "$harnessRoot\python" {
  python -m unittest -v test_configuration.py
}
Invoke-H1Check 'Python runtime context behavior' "$harnessRoot\python" {
  python -m unittest -v test_runtime_context.py
}
Invoke-H1Check 'Python capability projection behavior' "$harnessRoot\python" {
  python -m unittest -v test_capability_projection.py
}
Invoke-H1Check 'Python lifecycle behavior' "$harnessRoot\python" {
  python -m unittest -v test_lifecycle_coordinator.py
}

Write-Host "H1 regression: $passed/12 checks passed (including S0 15/15)"
