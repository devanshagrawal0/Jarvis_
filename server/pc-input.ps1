# JARVIS phone takeover — persistent input agent.
# One process for the whole session: reads one JSON event per line on stdin, injects it with
# SendInput, answers one JSON line on stdout. Started by server/pc-input.js; never run by hand.
#
#   {"id":1,"t":"move","x":0.5,"y":0.5}         pointer to (nx,ny) of the primary monitor
#   {"id":2,"t":"click","x":..,"y":..,"b":"left","n":1}   move + click (b: left|right|middle, n: 1|2)
#   {"id":3,"t":"down","b":"left"} / {"t":"up","b":"left"} button hold (drag = down, moves, up)
#   {"id":4,"t":"wheel","x":..,"y":..,"dy":-240,"dx":0}   wheel notches ×120 at a point
#   {"id":5,"t":"key","k":"ctrl+c"}                     combo: modifiers + one key, pressed once
#   {"id":6,"t":"key","k":"shift","d":"down"}           hold / release one key
#   {"id":7,"t":"text","s":"hello"}                     unicode text, "\n" = Enter
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
public static class JInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  const uint MOVE = 0x0001, LD = 0x0002, LU = 0x0004, RD = 0x0008, RU = 0x0010, MD = 0x0020, MU = 0x0040, WHEEL = 0x0800, HWHEEL = 0x1000, ABS = 0x8000, VDESK = 0x4000;
  const uint KUP = 0x0002, KUNI = 0x0004, KEXT = 0x0001;
  static INPUT M(int dx, int dy, uint data, uint flags) { var i = new INPUT(); i.type = 0; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags; return i; }
  static INPUT K(ushort vk, ushort sc, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = sc; i.u.ki.dwFlags = flags; return i; }
  static void Send(params INPUT[] a) { if (SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))) != a.Length) throw new Exception("SendInput rejected (" + Marshal.GetLastWin32Error() + ")"); }
  // nx, ny are 0..1 over the PRIMARY monitor (what ddagrab streams); SendInput wants 0..65535 over
  // the whole virtual desktop. Both come from GetSystemMetrics in the same units, so DPI cancels.
  public static void Move(double nx, double ny) {
    int vl = GetSystemMetrics(76), vt = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int pw = GetSystemMetrics(0), ph = GetSystemMetrics(1);
    double ax = (nx * pw - vl) / vw * 65535.0, ay = (ny * ph - vt) / vh * 65535.0;
    Send(M((int)Math.Round(ax), (int)Math.Round(ay), 0, MOVE | ABS | VDESK));
  }
  public static void Button(string b, bool down) { uint f = b == "right" ? (down ? RD : RU) : b == "middle" ? (down ? MD : MU) : (down ? LD : LU); Send(M(0, 0, 0, f)); }
  public static void Click(string b, int count) { for (int i = 0; i < count; i++) { Button(b, true); Button(b, false); } }
  public static void Wheel(int dy, int dx) { if (dy != 0) Send(M(0, 0, unchecked((uint)dy), WHEEL)); if (dx != 0) Send(M(0, 0, unchecked((uint)dx), HWHEEL)); }
  public static void Key(ushort vk, bool down) {
    ushort sc = (ushort)MapVirtualKey(vk, 0);
    uint f = down ? 0u : KUP;
    bool ext = (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C || vk == 0x6F || vk == 0xA3 || vk == 0xA5;
    if (ext) f |= KEXT;
    Send(K(vk, sc, f));
  }
  public static void Text(string s) {
    foreach (char c in s) {
      if (c == '\n') { Key(0x0D, true); Key(0x0D, false); continue; }
      if (c == '\r') continue;
      Send(K(0, (ushort)c, KUNI)); Send(K(0, (ushort)c, KUNI | KUP));
    }
  }
  public static int Vk(char c) { short r = VkKeyScan(c); return r == -1 ? 0 : (r & 0xFF); }
}
'@
Add-Type -TypeDefinition $src
[JInput]::SetProcessDPIAware() | Out-Null

$VK = @{
  enter = 0x0D; return = 0x0D; escape = 0x1B; esc = 0x1B; tab = 0x09; backspace = 0x08; delete = 0x2E; del = 0x2E
  up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22
  space = 0x20; win = 0x5B; meta = 0x5B; ctrl = 0x11; control = 0x11; shift = 0x10; alt = 0x12; insert = 0x2D; capslock = 0x14
  printscreen = 0x2C; volumeup = 0xAF; volumedown = 0xAE; mute = 0xAD; playpause = 0xB3; nexttrack = 0xB0; prevtrack = 0xB1; stopmedia = 0xB2
}
1..12 | ForEach-Object { $VK["f$_"] = 0x6F + $_ }

function Resolve-Vk([string]$name) {
  $n = $name.Trim().ToLowerInvariant()
  if ($VK.ContainsKey($n)) { return [int]$VK[$n] }
  if ($n.Length -eq 1) { $v = [JInput]::Vk($n[0]); if ($v -ne 0) { return $v } }
  throw "unknown key '$name'"
}

function Press-Combo([string]$combo) {
  $parts = @($combo -split '\+' | Where-Object { $_ -ne '' })
  if ($parts.Count -eq 0) { throw 'empty key' }
  $mods = @(); if ($parts.Count -gt 1) { $mods = $parts[0..($parts.Count - 2)] }
  $last = $parts[$parts.Count - 1]
  $held = @()
  try {
    foreach ($m in $mods) { $vk = Resolve-Vk $m; [JInput]::Key([uint16]$vk, $true); $held += $vk }
    $k = Resolve-Vk $last
    [JInput]::Key([uint16]$k, $true); [JInput]::Key([uint16]$k, $false)
  } finally {
    [array]::Reverse($held); foreach ($vk in $held) { [JInput]::Key([uint16]$vk, $false) }
  }
}

$in = [Console]::In
$out = [Console]::Out
$out.WriteLine('{"ready":true}'); $out.Flush()
while ($true) {
  $line = $in.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  $id = 0
  try {
    $e = $line | ConvertFrom-Json
    $id = [int]$e.id
    switch ([string]$e.t) {
      'move'  { [JInput]::Move([double]$e.x, [double]$e.y) }
      'down'  { [JInput]::Button([string]$e.b, $true) }
      'up'    { [JInput]::Button([string]$e.b, $false) }
      'click' { if ($null -ne $e.x) { [JInput]::Move([double]$e.x, [double]$e.y) }; $n = if ($e.n) { [int]$e.n } else { 1 }; [JInput]::Click([string]$e.b, $n) }
      'wheel' { if ($null -ne $e.x) { [JInput]::Move([double]$e.x, [double]$e.y) }; [JInput]::Wheel([int]$e.dy, [int]$e.dx) }
      'text'  { [JInput]::Text([string]$e.s) }
      'key'   {
        if ($e.d -eq 'down') { [JInput]::Key([uint16](Resolve-Vk ([string]$e.k)), $true) }
        elseif ($e.d -eq 'up') { [JInput]::Key([uint16](Resolve-Vk ([string]$e.k)), $false) }
        else { Press-Combo ([string]$e.k) }
      }
      default { throw "unknown event '$($e.t)'" }
    }
    $out.WriteLine('{"ok":true,"id":' + $id + '}')
  } catch {
    $msg = ($_.Exception.Message -replace '[\\"\r\n]', ' ')
    $out.WriteLine('{"ok":false,"id":' + $id + ',"error":"' + $msg + '"}')
  }
  $out.Flush()
}
