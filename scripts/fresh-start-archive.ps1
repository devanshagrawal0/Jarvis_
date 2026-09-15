# Fresh start (owner decision 2026-09-13): move everything JARVIS knows about the owner out of the live
# runtime into a dated archive folder. NOTHING is deleted - every item is a rename into
# runtime\_archive-<date>\ and can be moved back. What stays is only keys, connections and app plumbing.
#
# Run with the backend STOPPED (the SQLite files cannot be moved while it holds them).
#   powershell -ExecutionPolicy Bypass -File scripts\fresh-start-archive.ps1            # dry run (lists)
#   powershell -ExecutionPolicy Bypass -File scripts\fresh-start-archive.ps1 -Apply
param([switch]$Apply)
$ErrorActionPreference = "Stop"
$runtime = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "runtime"
if (-not (Test-Path (Join-Path $runtime "settings.json"))) { throw "runtime not found at $runtime" }
if (Get-NetTCPConnection -LocalPort 8799 -State Listen -ErrorAction SilentlyContinue) { throw "JARVIS is still listening on :8799 - stop it first." }

$stamp = Get-Date -Format "yyyy-MM-dd"
$archive = Join-Path $runtime "_archive-$stamp"

# KEEP - keys, logins, connections, and plumbing that is not about the owner.
$keep = @(
  "settings.json", "secrets.dpapi", "secrets.dpapi.bak-before-reimport", "oauth-states.json", "vapid-keys.json",
  "contacts.json", "browser-profile", "config", "hud-template", "docs", "tool-vectors.sqlite", "tool-vectors.sqlite-wal",
  "tool-vectors.sqlite-shm", "mode.json", "cost-meter.json", "settings.json.backup-before-semantic-routing",
  "_archive-$stamp"
)
$keepSet = @{}; foreach ($k in $keep) { $keepSet[$k.ToLowerInvariant()] = $true }

$items = Get-ChildItem $runtime -Force | Where-Object { -not $keepSet.ContainsKey($_.Name.ToLowerInvariant()) -and $_.Name -notlike "_archive-*" }
$totalMB = [math]::Round((($items | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ("{0} items to archive (top-level files {1} MB) -> {2}" -f $items.Count, $totalMB, $archive)
foreach ($i in $items) { Write-Host ("  {0}{1}" -f $i.Name, $(if ($i.PSIsContainer) { "\" } else { "" })) }
Write-Host ""
Write-Host "KEEP (untouched): " + (($keep | Where-Object { Test-Path (Join-Path $runtime $_) }) -join ", ")
if (-not $Apply) { Write-Host ""; Write-Host "Dry run. Re-run with -Apply to move them."; exit 0 }

New-Item -ItemType Directory -Force $archive | Out-Null
$moved = 0
foreach ($i in $items) {
  $dest = Join-Path $archive $i.Name
  Move-Item -LiteralPath $i.FullName -Destination $dest -Force
  $moved++
}
$left = (Get-ChildItem $runtime -Force | Where-Object { $_.Name -notlike "_archive-*" }).Name -join ", "
Write-Host ""
Write-Host "Moved $moved items into $archive"
Write-Host "runtime now holds: $left"
