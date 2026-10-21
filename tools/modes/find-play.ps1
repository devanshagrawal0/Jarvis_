param(
  [switch]$Click,          # actually click; default is detect-only (prints coords)
  [int]$MinPixels = 400    # minimum matched samples in the densest cluster to accept
)
# Robustly locate VALORANT's Riot-Client "Play" button by its coral-red colour signature and
# (optionally) click its centre. No hardcoded pixel — survives the window moving/resizing.
# Detection: sample the screen, keep pixels matching the coral red, bin into a coarse grid, take
# the densest cell + its neighbours, and use that cluster's centroid. Scattered red UI can't win.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class P {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  public const uint LDOWN=0x0002, LUP=0x0004;
}
"@
[P]::SetProcessDPIAware() | Out-Null

# bring the Riot Client window forward so Play is actually visible/clickable
$riot = Get-Process -Name 'Riot Client' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($riot) { [P]::ShowWindow($riot.MainWindowHandle,9)|Out-Null; [P]::SetForegroundWindow($riot.MainWindowHandle)|Out-Null; Start-Sleep -Milliseconds 500 }

$W = [P]::GetSystemMetrics(0); $H = [P]::GetSystemMetrics(1)
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0,0,0,0,(New-Object System.Drawing.Size($W,$H)))

$rect = New-Object System.Drawing.Rectangle(0,0,$W,$H)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Scan0
$bytes = New-Object byte[] ($data.Stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
$strideLen = $data.Stride

# coarse grid accumulation
$cell = 40
$cols = [int][math]::Ceiling($W / $cell)
$rows = [int][math]::Ceiling($H / $cell)
$cnt = New-Object 'int[]' ($cols * $rows)
$sx  = New-Object 'double[]' ($cols * $rows)
$sy  = New-Object 'double[]' ($cols * $rows)

$step = 3
for ($y = 0; $y -lt $H; $y += $step) {
  $rowoff = $y * $strideLen
  for ($x = 0; $x -lt $W; $x += $step) {
    $o = $rowoff + ($x * 4)
    $b = $bytes[$o]; $gr = $bytes[$o+1]; $r = $bytes[$o+2]
    # coral-red Play button: strong red, moderate green≈blue, clearly reddish
    if ($r -ge 200 -and $gr -ge 50 -and $gr -le 150 -and $b -ge 50 -and $b -le 150 -and ($r - $gr) -ge 90 -and ($r - $b) -ge 90 -and [math]::Abs($gr - $b) -le 45) {
      $ci = [int]($x / $cell); $ri = [int]($y / $cell); $idx = $ri * $cols + $ci
      $cnt[$idx]++; $sx[$idx] += $x; $sy[$idx] += $y
    }
  }
}
$g.Dispose(); $bmp.Dispose()

# densest cell
$best = -1; $bestIdx = -1
for ($i = 0; $i -lt $cnt.Length; $i++) { if ($cnt[$i] -gt $best) { $best = $cnt[$i]; $bestIdx = $i } }
if ($bestIdx -lt 0 -or $best -eq 0) { "NOTFOUND (no coral pixels)"; exit 2 }

# aggregate densest cell + 8 neighbours for a stable centroid
$bc = $bestIdx % $cols; $br = [int]($bestIdx / $cols)
$tc = 0; $tx = 0.0; $ty = 0.0
for ($dr = -1; $dr -le 1; $dr++) { for ($dc = -1; $dc -le 1; $dc++) {
  $rr = $br + $dr; $cc = $bc + $dc
  if ($rr -ge 0 -and $rr -lt $rows -and $cc -ge 0 -and $cc -lt $cols) {
    $j = $rr * $cols + $cc; $tc += $cnt[$j]; $tx += $sx[$j]; $ty += $sy[$j]
  }
}}
if ($tc -lt $MinPixels) { "NOTFOUND (cluster too small: $tc < $MinPixels)"; exit 2 }
$cx = [int]($tx / $tc); $cy = [int]($ty / $tc)

if ($Click) {
  [P]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 200
  [P]::mouse_event([P]::LDOWN,0,0,0,[IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [P]::mouse_event([P]::LUP,0,0,0,[IntPtr]::Zero)
  "CLICKED ($cx,$cy) cluster=$tc"
} else {
  "FOUND ($cx,$cy) cluster=$tc"
}