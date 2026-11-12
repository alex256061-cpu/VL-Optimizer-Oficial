# Abre o Lossless e captura a janela assim que ela aparecer (UAC precisa ser aceito).
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public struct RECT2 { public int Left; public int Top; public int Right; public int Bottom; }
public class W2 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT2 r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  public static List<IntPtr> WindowsOf(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h) && GetWindowTextLength(h) > 0) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$exe = 'C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.exe'
$out = Join-Path $env:TEMP 'lossless-window.png'
$procId = $null
try { $sp = Start-Process -FilePath $exe -PassThru; $procId = $sp.Id } catch { Write-Output ('ERRO_LAUNCH ' + $_.Exception.Message); exit 4 }

$found = $null
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep -Milliseconds 500
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p) { Write-Output 'PROCESSO_SAIU'; break }
  $ws = [W2]::WindowsOf([uint32]$p.Id)
  if ($ws.Count -gt 0) { $found = $ws[0]; break }
}
if (-not $found) { Write-Output 'SEM_JANELA'; exit 2 }

[W2]::ShowWindow($found, 9) | Out-Null
[W2]::SetForegroundWindow($found) | Out-Null
Start-Sleep -Seconds 2
$r = New-Object RECT2
[W2]::GetWindowRect($found, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output ("JANELA " + $w + "x" + $h + " pid=" + $procId)
if ($w -le 0 -or $h -le 0) { exit 3 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("OK -> " + $out)
