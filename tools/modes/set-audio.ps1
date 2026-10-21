param([string]$Match = "A20 X")
# Set the default playback device whose *interface* name matches $Match (the A20 X game endpoint
# is "A20 X"; the chat one is "A20 X Chat" — we want game). Uses IPolicyConfig, self-contained.
$ErrorActionPreference = "Stop"

$base = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"
$ifaceKey = "{b3f8fa53-0004-438e-9003-51a46e139bfc},6"
$fnKey = "{a45c254e-df1c-4efd-8020-67d146a850e0},2"

function Find-Endpoint($pred) {
  foreach ($d in Get-ChildItem $base -ErrorAction SilentlyContinue) {
    if ((Get-ItemProperty -Path $d.PSPath -ErrorAction SilentlyContinue).DeviceState -ne 1) { continue }
    $p = Get-ItemProperty (Join-Path $d.PSPath "Properties") -ErrorAction SilentlyContinue
    $iface = [string]$p.$ifaceKey; $fn = [string]$p.$fnKey
    if (& $pred $iface $fn) { return @{ id = $d.PSChildName; name = "$fn ($iface)" } }
  }
  return $null
}

# 1) exact interface match (game); 2) contains but not Chat; 3) friendly-name contains
$hit = Find-Endpoint { param($i,$f) $i -eq $Match }
if (-not $hit) { $hit = Find-Endpoint { param($i,$f) $i -like "*$Match*" -and $i -notlike "*Chat*" } }
if (-not $hit) { $hit = Find-Endpoint { param($i,$f) $f -like "*$Match*" -and $i -notlike "*Chat*" } }
if (-not $hit) { Write-Error "No active playback device matches '$Match'"; exit 1 }

$deviceId = "{0.0.0.00000000}." + $hit.id

$code = @"
using System;
using System.Runtime.InteropServices;
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPolicyConfig {
  int GetMixFormat(string d, IntPtr f); int GetDeviceFormat(string d, bool b, IntPtr f); int ResetDeviceFormat(string d);
  int SetDeviceFormat(string d, IntPtr a, IntPtr b); int GetProcessingPeriod(string d, bool b, IntPtr a, IntPtr c);
  int SetProcessingPeriod(string d, IntPtr p); int GetShareMode(string d, IntPtr m); int SetShareMode(string d, IntPtr m);
  int GetPropertyValue(string d, bool b, IntPtr k, IntPtr v); int SetPropertyValue(string d, bool b, IntPtr k, IntPtr v);
  int SetDefaultEndpoint(string d, int role); int SetEndpointVisibility(string d, bool v);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] public class CPolicyConfigClient {}
public static class Audio {
  public static int SetDefault(string id) {
    IPolicyConfig pc = (IPolicyConfig)(new CPolicyConfigClient());
    int r = 0; r |= pc.SetDefaultEndpoint(id, 0); r |= pc.SetDefaultEndpoint(id, 1); r |= pc.SetDefaultEndpoint(id, 2); return r;
  }
}
"@
Add-Type -TypeDefinition $code
$res = [Audio]::SetDefault($deviceId)
if ($res -eq 0) { Write-Output $hit.name } else { Write-Error "SetDefaultEndpoint hr=$res"; exit 1 }
