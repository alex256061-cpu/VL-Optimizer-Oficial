# ══════════════════════════════════════════════════════════════════════════
# painel-live.ps1 — o sensor de longa duração do painel de GPU/CPU ao vivo.
#
# Fonte: GDZ Optimizer, template PCLIVE_PS (C:\VLTemp\deob\gdz-SEM-MANGLE.js,
# posição 334401–335797; documentado em C:\VLTemp\TIME\t8-templates.md §PCLIVE_PS).
# Este arquivo é o PCLIVE_PS verbatim, com as MARCAS trocadas para não colidir
# com o GDZ caso o cliente use os dois apps ao mesmo tempo:
#
#   GDZPI:          -> VLLIVE:
#   GDZ_NEED_GPU    -> VL_NEED_GPU
#   GDZ_PARENT      -> VL_PARENT
#
# O que ele faz (nada além disso, e é o que o GDZ faz):
#   - se autolimita a prioridade BelowNormal (não rouba CPU do jogo);
#   - morre sozinho quando o processo pai (VL_PARENT) deixa de existir — um
#     PowerShell órfão não pode ficar girando depois que o app fecha;
#   - a cada 1500 ms emite UMA linha `VLLIVE:{json}` na saída padrão com
#     perf (por núcleo: Nome=%PercPerformance=ProcessorFrequency),
#     tz   (temperatura máxima das zonas térmicas, se o contador existir),
#     eng/vram (só quando VL_NEED_GPU=1 — o app já tem nvidia-smi nesse caso),
#     disks (a cada 5º ciclo: temperatura de cada disco).
#
# Fica em arquivo próprio de propósito, como o snapshot.ps1: o script tem
# cifrão e barra invertida que brigam com o template literal do JavaScript.
# Separado, o PowerShell é validado pelo parser do PowerShell e o JavaScript
# pelo node --check, e um não consegue quebrar o outro.
# ══════════════════════════════════════════════════════════════════════════
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}
$ErrorActionPreference = 'SilentlyContinue'

# VL_NEED_GPU = '1' quando NÃO há nvidia-smi: aí a GPU tem de sair dos
# contadores do Windows. Com nvidia-smi, o app lê a GPU por ele (mais preciso
# e mais barato) e este laço não coleta eng/vram.
$needGpu = $env:VL_NEED_GPU -eq '1'

# Nem todo PC expõe as zonas térmicas (desktop, VMs, alguns notebooks). Medido
# nesta máquina: 0 zonas. Sem a checagem, o CIM devolve vazio a cada ciclo.
$tz = @(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation).Count -gt 0
$n = 0
while ($true) {
  # Vigia do pai: se o app fechou, este processo termina sozinho.
  if (-not (Get-Process -Id $env:VL_PARENT)) { exit }
  $o = [ordered]@{}
  $o.perf = @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation | ForEach-Object { "$($_.Name)=$($_.PercentProcessorPerformance)=$($_.ProcessorFrequency)" })
  if ($tz) { $o.tz = (Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | Measure-Object -Property HighPrecisionTemperature -Maximum).Maximum }
  if ($needGpu) {
    $o.eng = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D*' -and $_.UtilizationPercentage -gt 0 } | ForEach-Object { "$($_.Name)=$($_.UtilizationPercentage)" })
    $o.vram = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | ForEach-Object { "$($_.Name)=$($_.DedicatedUsage)" })
  }
  if ($n % 5 -eq 0) { $o.disks = @(Get-PhysicalDisk | ForEach-Object { "$($_.DeviceId)=$(($_ | Get-StorageReliabilityCounter).Temperature)" }) }
  Write-Output ('VLLIVE:' + (ConvertTo-Json -InputObject $o -Compress -Depth 3))
  $n++
  Start-Sleep -Milliseconds 1500
}
