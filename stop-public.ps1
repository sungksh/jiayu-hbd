$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root 'echo-tunnel.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host '沒有公開隧道 PID 記錄。'; exit 0 }
$tunnelPid = 0; [void][int]::TryParse((Get-Content -Raw $pidFile), [ref]$tunnelPid)
if ($tunnelPid -gt 0 -and (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue)) { Stop-Process -Id $tunnelPid; Write-Host '公開隧道已停止；區域網路網站仍會運行。' } else { Write-Host '公開隧道目前沒有執行。' }
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
