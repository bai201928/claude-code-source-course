$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tsc = Join-Path $harnessRoot 'node_modules\.bin\tsc.cmd'
$typeRoots = Join-Path $harnessRoot 'node_modules\@types'
if (-not (Test-Path -LiteralPath $tsc)) {
  throw 'Local TypeScript compiler is missing. Run npm ci in mini-agent-harness.'
}
$passed = 0

function Invoke-StageCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host "[S0] $Name"
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

Invoke-StageCheck 'M01 TypeScript behavior' "$projectRoot\curriculum\units\M01\code\typescript" { node contracts.test.ts }
Invoke-StageCheck 'M01 TypeScript strict' "$projectRoot\curriculum\units\M01\code\typescript" { & $tsc --project tsconfig.json }
Invoke-StageCheck 'M01 Python behavior' "$projectRoot\curriculum\units\M01\code\python" { python -m unittest -v test_contracts.py }

Invoke-StageCheck 'M02 TypeScript behavior' "$projectRoot\curriculum\units\M02\code\typescript" { node eventStream.test.ts }
Invoke-StageCheck 'M02 TypeScript strict' "$projectRoot\curriculum\units\M02\code\typescript" { & $tsc -p . }
Invoke-StageCheck 'M02 Python behavior' "$projectRoot\curriculum\units\M02\code\python" { python -m unittest -v test_event_stream.py }

Invoke-StageCheck 'M03 TypeScript behavior' "$projectRoot\curriculum\units\M03\code\typescript" { node runtimeHarness.test.ts }
Invoke-StageCheck 'M03 TypeScript strict' "$projectRoot\curriculum\units\M03\code\typescript" { & $tsc -p . --typeRoots $typeRoots }
Invoke-StageCheck 'M03 Python behavior' "$projectRoot\curriculum\units\M03\code\python" { python -m unittest -v test_runtime_harness.py }

Invoke-StageCheck 'M04 TypeScript behavior' "$projectRoot\curriculum\units\M04\code\typescript" { node traceHarness.test.ts }
Invoke-StageCheck 'M04 TypeScript strict' "$projectRoot\curriculum\units\M04\code\typescript" { & $tsc -p . --typeRoots $typeRoots }
Invoke-StageCheck 'M04 Python behavior' "$projectRoot\curriculum\units\M04\code\python" { python -m unittest -v test_trace_harness.py }

Invoke-StageCheck 'H0 TypeScript behavior' "$projectRoot\mini-agent-harness\typescript" { node h0.test.ts }
Invoke-StageCheck 'H0 TypeScript strict' "$projectRoot\mini-agent-harness\typescript" { powershell -NoProfile -ExecutionPolicy Bypass -File .\typecheck.ps1 }
Invoke-StageCheck 'H0 Python behavior' "$projectRoot\mini-agent-harness\python" { python -m unittest -v test_h0.py }

Write-Host "S0 regression: $passed/15 checks passed"
