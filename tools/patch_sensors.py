import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# ─────────────── helpers de sensor (GPU NVIDIA + SMART dos discos) ───────────────
helpers = r"""// ── Sensores reais: nvidia-smi para GPU, contadores de confiabilidade para disco ──
const NVSM = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
const numOrNull = (v) => {
  if (v == null) return null;
  const t = String(v).trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
};
function nvQuery() {
  return new Promise((resolve) => {
    if (!fs.existsSync(NVSM)) return resolve([]);
    execFile(NVSM, ['--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,power.limit,fan.speed,clocks.gr,clocks.mem', '--format=csv,noheader,nounits'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const line of String(stdout).trim().split(/\r?\n/)) {
        const c = line.split(',').map((x) => x.trim());
        if (c.length < 11) continue;
        out.push({
          name: c[0],
          temp: numOrNull(c[1]), usage: numOrNull(c[2]), memUsage: numOrNull(c[3]),
          memUsed: numOrNull(c[4]), memTotal: numOrNull(c[5]),
          power: numOrNull(c[6]), powerLimit: numOrNull(c[7]), fan: numOrNull(c[8]),
          clock: numOrNull(c[9]), memClock: numOrNull(c[10]),
        });
      }
      resolve(out);
    });
  });
}

let diskSensorCache = { at: 0, list: [] };
async function diskSensors(force) {
  if (!force && Date.now() - diskSensorCache.at < 15000) return diskSensorCache.list;
  const r = await core.ps(`
    $o = @()
    foreach ($d in @(Get-PhysicalDisk -ErrorAction SilentlyContinue)) {
      $c = $null
      try { $c = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}
      $o += @{
        id = [string]$d.DeviceId; name = [string]$d.FriendlyName
        media = [string]$d.MediaType; bus = [string]$d.BusType; bytes = [int64]$d.Size
        health = [string]$d.HealthStatus; fw = [string]$d.FirmwareVersion
        temp = $(if ($c -and $null -ne $c.Temperature) { [int]$c.Temperature } else { $null })
        wear = $(if ($c -and $null -ne $c.Wear) { [int]$c.Wear } else { $null })
        hours = $(if ($c -and $null -ne $c.PowerOnHours) { [int64]$c.PowerOnHours } else { $null })
      }
    }
    Write-Output (Json $o)`, 60000);
  let list = [];
  if (r.ok && r.out) { try { const j = JSON.parse(r.out); list = Array.isArray(j) ? j : [j]; } catch (e) {} }
  diskSensorCache = { at: Date.now(), list };
  return list;
}

"""
anchor = "// ────────────────────────────── PC INFO ──────────────────────────────"
if anchor not in s:
    raise SystemExit("âncora PC INFO não encontrada")
s = s.replace(anchor, anchor + "\n" + helpers, 1)

# ─────────────── pcinfoLive: merge GPU/disk reais ───────────────
old_live_start = s.find("let lastLive = null;\nex.pcinfoLive = async () => {")
old_live_end = s.find("ex.getHardware = async () => {")
if old_live_start < 0 or old_live_end < 0:
    raise SystemExit("pcinfoLive não encontrado")
new_live = r"""let lastLive = null;
ex.pcinfoLive = async () => {
  const [base, gpus] = await Promise.all([
    core.ps(`
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $ram = Get-CimInstance Win32_OperatingSystem
      $per = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { [int]$_.PercentProcessorTime })
      $mhz = [int]((Get-CimInstance Win32_Processor).CurrentClockSpeed)
      $coreMhz = @()
      foreach ($p in @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '_Total' })) { $coreMhz += [int]$p.ProcessorFrequency }
      $o = @{ cpu = @{ usage=[int]$cpu; mhz=$mhz; coreMhz=$coreMhz; cores=$per; temp=$null }; ram = @{ used=([math]::Round(($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory) / 1MB, 1)); total=([math]::Round($ram.TotalVisibleMemorySize / 1MB, 1)); cache=$null }; gpus = @(); disks = @{} }
      Write-Output (Json $o)`, 30000),
    nvQuery(),
  ]);
  if (!base.ok) return { success: false, error: base.err || 'falha' };
  let live;
  try { live = JSON.parse(base.out); } catch (e) { return { success: false, error: 'resposta inválida' }; }
  live.gpus = gpus;
  const disks = await diskSensors(false);
  const map = {};
  for (const d of disks) if (d.temp != null) map[d.id] = d.temp;
  live.disks = map;
  lastLive = live;
  return { success: true, ...live };
};

"""
s = s[:old_live_start] + new_live + s[old_live_end:]

# ─────────────── getStats: usa nvidia-smi quando existir ───────────────
old_stats_start = s.find("ex.getStats = async () => {")
old_stats_end = s.find("ex.getMemStats = async () => {")
if old_stats_start < 0 or old_stats_end < 0:
    raise SystemExit("getStats não encontrado")
new_stats = r"""ex.getStats = async () => {
  const [r, gpus] = await Promise.all([
    core.ps(`
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $ram = Get-CimInstance Win32_OperatingSystem
      $ramPct = [math]::Round((($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory) / $ram.TotalVisibleMemorySize) * 100)
      Write-Output (Json @{ cpu=[int]$cpu; ram=[int]$ramPct })`, 20000),
    nvQuery(),
  ]);
  let cpu = 0, ram = 0, gpu = 0;
  try { const j = JSON.parse(r.out); cpu = j.cpu || 0; ram = j.ram || 0; } catch (e) {}
  if (gpus.length) gpu = Math.round(gpus[0].usage || 0);
  else {
    const g = await core.ps(`$g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'engtype_3D' } | Measure-Object -Property UtilizationPercentage -Sum).Sum; if (-not $g) { $g = 0 }; Write-Output ([int][math]::Min(100, $g))`, 15000);
    gpu = parseInt(g.out, 10) || 0;
  }
  return { cpu, ram, gpu };
};

"""
s = s[:old_stats_start] + new_stats + s[old_stats_end:]

# ─────────────── sysSample (overlay): GPU temp + uso via nvidia-smi ───────────────
old_sys_start = s.find("async function sysSample() {")
old_sys_end = s.find("ex.fpsStatus = async () => {")
if old_sys_start < 0 or old_sys_end < 0:
    raise SystemExit("sysSample não encontrado")
new_sys = r"""async function sysSample() {
  const [r, gpus] = await Promise.all([
    core.ps(`
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $ram = Get-CimInstance Win32_OperatingSystem
      Write-Output (Json @{ cpu=[int]$cpu; ramUsed=[math]::Round(($ram.TotalVisibleMemorySize - $ram.FreePhysicalMemory)/1MB,1); ramTotal=[math]::Round($ram.TotalVisibleMemorySize/1MB) })`, 15000),
    nvQuery(),
  ]);
  try {
    const j = JSON.parse(r.out);
    lastSys.cpu = j.cpu; lastSys.ramUsed = j.ramUsed; lastSys.ramTotal = j.ramTotal;
  } catch (e) {}
  if (gpus.length) {
    lastSys.gpu = gpus[0].usage != null ? Math.round(gpus[0].usage) : lastSys.gpu;
    lastSys.gpuTemp = gpus[0].temp != null ? Math.round(gpus[0].temp) : null;
    lastSys.gpuPower = gpus[0].power;
  }
}

"""
s = s[:old_sys_start] + new_sys + s[old_sys_end:]

io.open(p, "w", encoding="utf-8").write(s)
print("sensores ok")
