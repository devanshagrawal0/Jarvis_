# JARVIS Face-ID unlock — password vault (step 2a).
# You run this ONCE on the PC. It takes your Windows password, encrypts it with Windows' own DPAPI
# (LOCAL MACHINE scope, so only code on THIS PC can decrypt it — that's the lock-screen Credential
# Provider), and writes it to C:\ProgramData\JARVIS\unlock.bin. The password is never stored in
# plain text, never sent anywhere, and never seen by JARVIS or by Claude. Delete that file to undo.
#
#   Usage:  powershell -ExecutionPolicy Bypass -File set-unlock-password.ps1
#           (add  -Password 'x'  only for a NON-real test value; normally omit it and type at the prompt)

param([string]$Password)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$dir = "C:\ProgramData\JARVIS"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$out = Join-Path $dir "unlock.bin"

if ($Password) {
  $plain = $Password
} else {
  $sec = Read-Host -AsSecureString "Enter the Windows password to store for phone-unlock"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Prefix the current user so the Credential Provider unlocks the right account: "DOMAIN\user\0password"
$who = "$env:USERDOMAIN\$env:USERNAME"
$payload = "$who`n$plain"
$bytes = [Text.Encoding]::Unicode.GetBytes($payload)
$enc = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
[IO.File]::WriteAllBytes($out, $enc)

# lock the file down to SYSTEM + Administrators only
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($id in @("SYSTEM","Administrators")) {
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id, "FullControl", "Allow")))
}
Set-Acl -Path $out -AclObject $acl

# wipe the plaintext from memory
$plain = $null; [GC]::Collect()
Write-Output "STORED for $who -> $out ($($enc.Length) bytes, DPAPI LocalMachine)"
