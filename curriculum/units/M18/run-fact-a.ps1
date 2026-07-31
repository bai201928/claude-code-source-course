$ErrorActionPreference = 'Continue'
$unitRoot = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $unitRoot '..\..\..')).Path
$sessionId = [guid]::NewGuid().ToString()
$sessionId | Set-Content -LiteralPath (Join-Path $unitRoot 'fact-session-id.txt') -Encoding ascii
$prompt = Get-Content -Raw -LiteralPath (Join-Path $unitRoot 'fact-gate-a-prompt.md')
Set-Location -LiteralPath $projectRoot
& claude -p --effort max --tools Read --permission-mode dontAsk --session-id $sessionId $prompt
exit $LASTEXITCODE
