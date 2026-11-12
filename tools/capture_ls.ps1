Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct RECT3 { public int Left; public int Top; public int Right; public int Bottom; }
public class W3 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT3 r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$p = Get-Process LosslessScaling -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'SEM_JANELA'; exit 2 }
[W3]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 1
$r = New-Object RECT3
[W3]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output ("JANELA " + $w + "x" + $h)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$out = Join-Path $env:TEMP 'lossless-window.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("OK -> " + $out)
