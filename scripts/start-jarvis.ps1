param(
  [int]$Port = 8799,
  [switch]$StablePhoneLink
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project "runtime"
$stdout = Join-Path $runtime "server.stdout.log"
$stderr = Join-Path $runtime "server.stderr.log"
$tunnelLog = Join-Path $runtime "cloudflared-quick-tunnel.log"
$url = "http://127.0.0.1:$Port"
$stablePhoneUrl = "https://devansh-jarvis.devanshhagrawal.workers.dev"

New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  Start-Process `
    -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $project `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null

  $online = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
      if ($health.ok) {
        $online = $true
        break
      }
    }
    catch {
      # Server is still starting.
    }
  }
  if (-not $online) {
    Write-Host "JARVIS did not start. Check:" -ForegroundColor Red
    Write-Host $stderr
    exit 1
  }
}

if ($StablePhoneLink) {
  $cloudflared = Join-Path $project ".tools\cloudflared.exe"
  if (-not (Test-Path $cloudflared)) {
    Write-Host "cloudflared.exe was not found at $cloudflared" -ForegroundColor Red
    exit 1
  }

  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
  Start-Process `
    -FilePath $cloudflared `
    -ArgumentList @("tunnel", "--url", $url, "--no-autoupdate", "--logfile", $tunnelLog, "--loglevel", "info") `
    -WorkingDirectory $project `
    -WindowStyle Hidden | Out-Null

  $publicOrigin = ""
  for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $tunnelLog) {
      $content = Get-Content $tunnelLog -Raw
      $match = [regex]::Match($content, "https://[a-z0-9-]+\.trycloudflare\.com")
      if ($match.Success) {
        $publicOrigin = $match.Value
        break
      }
    }
  }
  if (-not $publicOrigin) {
    Write-Host "Cloudflare tunnel did not produce a public URL. Check:" -ForegroundColor Red
    Write-Host $tunnelLog
    exit 1
  }

  $settingsPath = Join-Path $runtime "settings.json"
  $settings = if (Test-Path $settingsPath) { Get-Content $settingsPath | ConvertFrom-Json } else { [pscustomobject]@{} }
  $settings | Add-Member -NotePropertyName webhookBaseUrl -NotePropertyValue $publicOrigin -Force
  $settings | Add-Member -NotePropertyName stablePhoneUrl -NotePropertyValue $stablePhoneUrl -Force
  $settings | Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString("o") -Force
  $settings | ConvertTo-Json -Depth 20 | Set-Content $settingsPath -Encoding UTF8

  & npx wrangler deploy --keep-vars --var "JARVIS_LOCAL_ORIGIN:$publicOrigin" | Out-Host
  Write-Host "Stable phone link: $stablePhoneUrl" -ForegroundColor Cyan
  Write-Host "Hidden tunnel origin: $publicOrigin" -ForegroundColor DarkGray
}

Start-Process $url
Write-Host "JARVIS is online at $url" -ForegroundColor Green
