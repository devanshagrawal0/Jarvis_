param([string]$Udd)
# Close only the takeover Edge window (matched by its unique user-data-dir).
$ErrorActionPreference = "SilentlyContinue"
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Udd*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Output "takeover-closed"
