$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $root 'start-echo.ps1')
$work = Join-Path (Split-Path -Parent $root) 'work'
$pidFile = Join-Path $root 'echo-tunnel.pid'
$urlFile = Join-Path $root 'echo-public.url'
$ssh = (Get-Command ssh.exe -ErrorAction SilentlyContinue).Source
if (-not $ssh) { Write-Host '找不到 Windows OpenSSH 用戶端。'; exit 1 }
if (Test-Path -LiteralPath $pidFile) {
  $oldId = 0; [void][int]::TryParse((Get-Content -Raw $pidFile), [ref]$oldId)
  if ($oldId -gt 0 -and (Get-Process -Id $oldId -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $urlFile)) {
    $url = (Get-Content -Raw $urlFile).Trim()
    try { $null = Invoke-RestMethod ($url+'/api/health') -TimeoutSec 4; Write-Host "公開網址可用：$url"; Start-Process ($url+'/?launch=1'); exit 0 } catch { Stop-Process -Id $oldId -Force -ErrorAction SilentlyContinue }
  }
}
$out = Join-Path $work 'localhostrun-out.log'; $err = Join-Path $work 'localhostrun-err.log'
Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
$knownHosts = Join-Path $work 'localhostrun_hosts'
$args = @('-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=accept-new','-o',"UserKnownHostsFile=$knownHosts",'-o','IdentityFile=none','-R','80:127.0.0.1:4173','nokey@localhost.run')
$proc = Start-Process -FilePath $ssh -ArgumentList $args -WorkingDirectory $work -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii
$url = $null
for ($i=0; $i -lt 25 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  $log = Get-Content -Raw $out -ErrorAction SilentlyContinue
  if ($log -match 'https://[a-f0-9]+\.app\.lhr\.life') { $url = $Matches[0] }
  if ($proc.HasExited) { break }
}
if (-not $url) { Write-Host '公開隧道沒有成功啟動，請查看 work/localhostrun-err.log'; exit 1 }
Set-Content -Path $urlFile -Value $url -Encoding ascii
$env:ECHO_QR_URL = $url+'/?launch=1'
$node = (Get-Command node).Source
$qrScript = Join-Path $work 'make-qr.js'
if ($node -and (Test-Path -LiteralPath $qrScript)) { & $node $qrScript }
Remove-Item Env:ECHO_QR_URL -ErrorAction SilentlyContinue
Write-Host "公開網址：$url"
Write-Host '免費網址可能輪替；電腦需保持開機，網站伺服器與隧道都必須持續執行。'
Start-Process ($url+'/?launch=1')
