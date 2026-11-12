# Abre o Lossless (UAC), espera a janela, traz para frente e tira print só da janela.
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

$exe = 'C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.exe'
$out = Join-Path $env:TEMP 'lossless-window.png'
Start-Process -FilePath $exe -Verb RunAs -ErrorAction Stop
$p = $null
for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 500
  $p = Get-Process -Name LosslessScaling -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p -and $p.MainWindowHandle -ne 0) { break }
}
if (-not $p -or $p.MainWindowHandle -eq 0) { Write-Output 'SEM_JANELA'; exit 2 }
if ([Win32]::IsIconic($p.MainWindowHandle)) { [Win32]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
[Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 3
$r = New-Object RECT
[Win32]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Output 'RECT_ZERO'; exit 3 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("OK " + $w + "x" + $h + " -> " + $out)
