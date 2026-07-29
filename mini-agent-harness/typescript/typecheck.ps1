$ErrorActionPreference = 'Stop'

$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tsc = Join-Path $harnessRoot 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path -LiteralPath $tsc)) {
  throw 'Local TypeScript compiler is missing. Run npm ci in mini-agent-harness.'
}

& $tsc -p (Join-Path $PSScriptRoot 'tsconfig.json')
exit $LASTEXITCODE
