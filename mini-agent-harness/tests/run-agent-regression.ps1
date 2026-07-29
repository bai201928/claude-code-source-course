$ErrorActionPreference = 'Stop'

$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRoot = (Resolve-Path (Join-Path $harnessRoot '..')).Path
$passed = 0

function Invoke-AgentCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "[Agent] $Name"
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

Invoke-AgentCheck 'H2-in-progress cumulative regression' $projectRoot {
  powershell -NoProfile -ExecutionPolicy Bypass -File .\mini-agent-harness\tests\run-h2-regression.ps1
}
Invoke-AgentCheck 'Integrated TypeScript agent tests' $harnessRoot {
  npm test
}
Invoke-AgentCheck 'Integrated TypeScript demo' $harnessRoot {
  npm run demo
}
Invoke-AgentCheck 'Integrated Python agent tests' "$harnessRoot\python" {
  python -m unittest -v test_agent_runtime.py
}

Write-Host "Integrated Agent regression: $passed/4 checks passed (including H2/H1/S0)"

