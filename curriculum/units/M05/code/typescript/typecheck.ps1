$ErrorActionPreference = 'Stop'

$tsc = npm exec --yes --package=typescript --package=@types/node -- powershell.exe -NoProfile -Command '(Get-Command tsc).Source'
if ($LASTEXITCODE -ne 0 -or -not $tsc) {
  throw 'Unable to resolve the temporary TypeScript compiler'
}

$nodeModules = Split-Path (Split-Path $tsc.Trim() -Parent) -Parent
$typeRoots = Join-Path $nodeModules '@types'
& $tsc.Trim() -p (Join-Path $PSScriptRoot 'tsconfig.json') --typeRoots $typeRoots
exit $LASTEXITCODE

