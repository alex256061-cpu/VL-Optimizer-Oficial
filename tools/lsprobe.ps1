# Testa se o Lossless abre com uma combinação de opções. Uso: lsprobe.ps1 "Name=Value;Name2=Value2"
param([string]$set = "")
$exe = 'C:\Program Files (x86)\Steam\steamapps\common\Lossless Scaling\LosslessScaling.exe'
$dir = Split-Path $exe
$target = Join-Path $env:LOCALAPPDATA 'Lossless Scaling\Settings.xml'
$base = Join-Path $PSScriptRoot 'ls-baseline.xml'
$xml = Get-Content $base -Raw

if ($set) {
  foreach ($pair in $set.Split(';')) {
    if (-not $pair.Trim()) { continue }
    $kv = $pair.Split('=', 2)
    $name = $kv[0].Trim(); $val = $kv[1].Trim()
    $xml = [regex]::Replace($xml, "<$name>[^<]*</$name>", "<$name>$val</$name>")
  }
}
# UTF-8 sem BOM
[System.IO.File]::WriteAllText($target, $xml, (New-Object System.Text.UTF8Encoding($false)))

Get-Process LosslessScaling -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$before = Get-Date
$p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru
Start-Sleep -Seconds 7
$q = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($q -and $q.MainWindowHandle -ne 0) {
  Write-Output ("OK|" + $set)
  $null = $q.CloseMainWindow()
  Start-Sleep -Seconds 2
  if (-not $q.HasExited) { Stop-Process -Id $q.Id -Force -ErrorAction SilentlyContinue }
} else {
  Write-Output ("CRASH|" + $set)
  Get-Process -Id $p.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
