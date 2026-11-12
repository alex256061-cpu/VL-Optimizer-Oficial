$root = "C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
$log = Join-Path $root "swap.log"
"== inicio $(Get-Date -Format o) ==" | Out-File $log -Encoding utf8

Get-Process -Name "VL Optimizer" -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; "matou $($_.Id)" | Add-Content $log } catch { "falhou matar $($_.Id): $($_.Exception.Message)" | Add-Content $log }
}
Start-Sleep -Seconds 3
"restantes: " + @(Get-Process -Name "VL Optimizer" -ErrorAction SilentlyContinue).Count | Add-Content $log

if (Test-Path "$root\dist") {
  try { Remove-Item -Recurse -Force "$root\dist" -ErrorAction Stop; "removeu dist" | Add-Content $log } catch { "erro remover dist: $($_.Exception.Message)" | Add-Content $log }
}
if (Test-Path "$root\dist2") {
  try { Move-Item "$root\dist2" "$root\dist" -ErrorAction Stop; "moveu dist2->dist" | Add-Content $log } catch { "erro mover: $($_.Exception.Message)" | Add-Content $log }
}
"exe novo: " + (Test-Path "$root\dist\VL Optimizer-win32-x64\VL Optimizer.exe") | Add-Content $log
"app: " + (Test-Path "$root\dist\VL Optimizer-win32-x64\resources\app\engine-extras.js") | Add-Content $log
"== fim ==" | Add-Content $log
