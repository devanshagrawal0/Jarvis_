# Master volume of the default playback device, via CoreAudio (IAudioEndpointVolume). One line
# per request on stdin: "get" | "set <0..1>" | "mute <0|1>"; one JSON line per answer. Kept alive
# by server/pc-audio.js. Volume changes the owner makes on the PC are read back the same way.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr n); int UnregisterControlChangeNotify(IntPtr n);
  int GetChannelCount(out int c);
  int SetMasterVolumeLevel(float dB, ref Guid ctx); int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int GetMasterVolumeLevel(out float dB); int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float dB, ref Guid ctx); int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float dB); int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  int GetVolumeStepInfo(out uint step, out uint count); int VolumeStepUp(ref Guid ctx); int VolumeStepDown(ref Guid ctx);
  int QueryHardwareSupport(out uint mask); int GetVolumeRange(out float min, out float max, out float inc);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  int OpenPropertyStore(int access, out IntPtr props); int GetId(out IntPtr id); int GetState(out int state);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class Vol {
  static IAudioEndpointVolume Ep() {
    var e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d);
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    d.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static float Get() { float v; Ep().GetMasterVolumeLevelScalar(out v); return v; }
  public static void Set(float v) { Guid g = Guid.Empty; Ep().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g); }
  public static bool Muted() { bool m; Ep().GetMute(out m); return m; }
  public static void Mute(bool m) { Guid g = Guid.Empty; Ep().SetMute(m, ref g); }
}
'@
$in = [Console]::In; $out = [Console]::Out
$out.WriteLine('{"ready":true}'); $out.Flush()
while ($true) {
  $line = $in.ReadLine(); if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ')
  try {
    switch ($parts[0]) {
      'set'  { [Vol]::Set([float]$parts[1]) }
      'mute' { [Vol]::Mute($parts[1] -eq '1') }
    }
    $v = [Math]::Round([Vol]::Get() * 100); $m = if ([Vol]::Muted()) { 'true' } else { 'false' }
    $out.WriteLine('{"ok":true,"volume":' + $v + ',"muted":' + $m + '}')
  } catch { $out.WriteLine('{"ok":false,"error":"' + ($_.Exception.Message -replace '[\\"\r\n]', ' ') + '"}') }
  $out.Flush()
}
