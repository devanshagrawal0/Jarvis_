param([string]$Url, [string]$Udd)
# Launch the takeover cinematic as a borderless fullscreen Edge app window (own profile so we can
# close it precisely), then FORCE it to the foreground + topmost so it covers the Claude window and
# everything else until the game is ready. The page's <title> is "Engaging" — we grab it by title.
$ErrorActionPreference = "SilentlyContinue"

Start-Process "msedge.exe" -ArgumentList @(
  "--app=$Url",
  "--start-fullscreen",
  "--user-data-dir=$Udd",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=Translate,msEdgeSplitScreen",
  "--disable-sync"
)

$code = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  static IntPtr found = IntPtr.Zero;
  static string want;
  static bool Scan(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
    if (sb.ToString().IndexOf(want, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
    return true;
  }
  public static bool Focus(string title) {
    want = title; found = IntPtr.Zero;
    for (int i = 0; i < 40 && found == IntPtr.Zero; i++) { EnumWindows(Scan, IntPtr.Zero); if (found == IntPtr.Zero) System.Threading.Thread.Sleep(150); }
    if (found == IntPtr.Zero) return false;
    // topmost so nothing sits over it
    SetWindowPos(found, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002); // SWP_NOSIZE|SWP_NOMOVE
    ShowWindow(found, 3); // SW_MAXIMIZE
    BringWindowToTop(found);
    // AttachThreadInput trick to bypass foreground lock
    uint fg; var fgWin = GetForegroundWindow(); uint fgTid = GetWindowThreadProcessId(fgWin, out fg);
    uint me = GetCurrentThreadId();
    AttachThreadInput(fgTid, me, true);
    SetForegroundWindow(found);
    AttachThreadInput(fgTid, me, false);
    return true;
  }
}
"@
Add-Type -TypeDefinition $code
$ok = [Fg]::Focus("Engaging")
Write-Output ("takeover-launched focus=" + $ok)