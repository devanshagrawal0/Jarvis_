param(
  [int]$Port = 8799
)

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
  Write-Host "JARVIS is already stopped."
  exit 0
}

foreach ($processId in ($listeners.OwningProcess | Sort-Object -Unique)) {
  Stop-Process -Id $processId -Force
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "JARVIS stopped." -ForegroundColor Yellow
