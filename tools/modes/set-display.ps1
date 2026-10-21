param([int]$W = 1920, [int]$H = 1080, [int]$R = 320)
# Switch the primary display mode (KTC "dual mode" is just a Windows resolution/refresh change).
$ErrorActionPreference = "Stop"
$code = @"
using System;
using System.Runtime.InteropServices;
public class DispMode {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency;
    public int dmICMMethod; public int dmICMIntent; public int dmMediaType; public int dmDitherType;
    public int dmReserved1; public int dmReserved2; public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  public static int Set(int w, int h, int r) {
    DEVMODE dm = new DEVMODE();
    dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, -1, ref dm) == 0) return -99;
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = r; dm.dmBitsPerPel = 32;
    dm.dmFields = 0x40000 | 0x80000 | 0x100000 | 0x400000; // BITSPERPEL | PELSWIDTH | PELSHEIGHT | DISPLAYFREQUENCY
    return ChangeDisplaySettings(ref dm, 0x00000001); // CDS_UPDATEREGISTRY
  }
}
"@
Add-Type -TypeDefinition $code
$res = [DispMode]::Set($W, $H, $R)
if ($res -eq 0) { Write-Output "$W x $H @ ${R}Hz" } else { Write-Error "ChangeDisplaySettings returned $res"; exit 1 }
