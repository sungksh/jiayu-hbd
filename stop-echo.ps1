$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir 'echo-server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host '找不到同步伺服器 PID 記錄。'; exit 1 }
$serverPid = [int](Get-Content -Raw $pidFile)
$proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $serverPid; Remove-Item -LiteralPath $pidFile; Write-Host '同步伺服器已停止。' } else { Remove-Item -LiteralPath $pidFile; Write-Host '同步伺服器目前沒有執行。' }
