# Real app icons, from Windows itself. For every AppID on stdin (one per line, "AppID<TAB>outfile")
# this asks the shell for the exact image the Start menu draws for shell:AppsFolder\<AppID> —
# Store apps and desktop programs alike — and writes it as a PNG with alpha. No lookups, no guesses.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class AppIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { void GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; public SIZE(int x, int y) { cx = x; cy = y; } }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType; public int bmWidth; public int bmHeight; public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel; public IntPtr bmBits; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int c, out BITMAP pv);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static void Save(string parsingName, int size, string outPath) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref iid, out f);
    IntPtr hbm;
    f.GetImage(new SIZE(size, size), 0x1 /* BIGGERSIZEOK */, out hbm);
    try {
      BITMAP bm; GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), out bm);
      // the shell hands back a 32bpp top-down DIB with premultiplied alpha — wrap it, then copy
      using (var wrapped = new Bitmap(bm.bmWidth, bm.bmHeight, bm.bmWidthBytes, PixelFormat.Format32bppPArgb, bm.bmBits))
      using (var copy = new Bitmap(bm.bmWidth, bm.bmHeight, PixelFormat.Format32bppArgb))
      using (var g = Graphics.FromImage(copy)) {
        g.DrawImage(wrapped, 0, 0, bm.bmWidth, bm.bmHeight);
        copy.Save(outPath, ImageFormat.Png);
      }
    } finally { DeleteObject(hbm); }
  }
}
'@
$in = [Console]::In
$out = [Console]::Out
while ($true) {
  $line = $in.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Length -eq 0) { continue }
  $parts = $line.Split("`t")
  try { [AppIcon]::Save("shell:AppsFolder\" + $parts[0], 128, $parts[1]); $out.WriteLine("ok`t" + $parts[0]) }
  catch { $out.WriteLine("err`t" + $parts[0] + "`t" + ($_.Exception.Message -replace '[\r\n\t]', ' ')) }
  $out.Flush()
}
