$ErrorActionPreference = 'Stop'

$harnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$promptPath = Join-Path $PSScriptRoot 'real-smoke-prompt.md'

$previousLocation = Get-Location
Set-Location $harnessRoot
try {
  & node --env-file-if-exists=.env.local -e 'process.exit(process.env.MINI_AGENT_API_KEY ? 0 : 2)'
  $credentialExitCode = $LASTEXITCODE
}
finally {
  Set-Location $previousLocation
}
if ($credentialExitCode -eq 2) {
  Write-Host 'SKIP: MINI_AGENT_API_KEY is not present in the process environment or .env.local'
  exit 0
}
if ($credentialExitCode -ne 0) {
  throw "Credential presence check failed with exit code $credentialExitCode"
}

$prompt = Get-Content -LiteralPath $promptPath -Raw
Push-Location $harnessRoot
try {
  node --env-file-if-exists=.env.local .\typescript\agent\cli.ts `
    --prompt $prompt `
    --output json `
    --max-turns 4
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
