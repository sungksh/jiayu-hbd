$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host '找不到 Node.js。請先安裝 Node.js，再重新執行。'; Read-Host '按 Enter 結束'; exit 1 }
$pidFile = Join-Path $scriptDir 'echo-server.pid'
try { $health = Invoke-RestMethod 'http://localhost:4173/api/health' -TimeoutSec 1 }
catch { $proc = Start-Process -FilePath $node -ArgumentList 'echo-server.js' -WorkingDirectory $scriptDir -WindowStyle Hidden -PassThru; Start-Sleep -Seconds 2; $health = Invoke-RestMethod 'http://localhost:4173/api/health' -TimeoutSec 3 }
Set-Content -Path $pidFile -Value $health.pid -Encoding ascii
Write-Host 'Threads 即時同步測試站已啟動。'
Write-Host '本機網址：http://localhost:4173'
$ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and -not $_.ToString().StartsWith('127.') }
foreach ($ip in $ips) { Write-Host "同一 Wi-Fi 連線網址：http://$($ip):4173" }
Write-Host '只有同一網路中的人可連線；若 Windows 防火牆詢問，允許私人網路。'
Start-Process 'http://localhost:4173'
