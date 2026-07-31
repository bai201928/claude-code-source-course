$ErrorActionPreference = 'Continue'
$unitRoot = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $unitRoot '..\..\..')).Path
$sessionId = (Get-Content -Raw -LiteralPath (Join-Path $unitRoot 'fact-session-id.txt')).Trim()
$prompt = Get-Content -Raw -LiteralPath (Join-Path $unitRoot 'fact-gate-b-prompt.md')
Set-Location -LiteralPath $projectRoot
& claude -p --effort max --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --resume $sessionId $prompt
exit $LASTEXITCODE
