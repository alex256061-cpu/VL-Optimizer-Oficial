import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ═══════════ main.js: cfg no launch + status ═══════════
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("H('ls-launch', () => ex.lsLaunch());", "H('ls-launch', (cfg) => ex.lsLaunch(cfg));\nH('ls-status', () => ex.lsStatus());")
io.open(p, "w", encoding="utf-8").write(s)
print("main ok")

# ═══════════ extras: gargalo, jogos com exe, slots de RAM ═══════════
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# --- 1) gargalo: shape que a tela lê ---
start = s.find("ex.measureBottleneck = async ({ seconds, pid }) => {")
end = s.find("// ────────────────────────────── OPTISCALER", start)
if start < 0 or end < 0:
    raise SystemExit("measureBottleneck nÃ£o encontrado")
new_bn = r"""ex.measureBottleneck = async ({ seconds, pid }) => {
  const secs = Math.max(5, Math.min(60, seconds || 15));
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    const s = await core.ps(`
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $core = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -ne '_Total' } | Measure-Object -Property PercentProcessorTime -Maximum).Maximum
      $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'engtype_3D' } | Measure-Object -Property UtilizationPercentage -Sum).Sum
      $os = Get-CimInstance Win32_OperatingSystem
      $ramPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100)
      $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB)
      Write-Output (Json @{ cpu=[int]$cpu; core=[int]$core; gpu=[int][math]::Min(100, $g); ram=[int]$ramPct; ramGb=$ramTotal })`, 12000);
    try { samples.push(JSON.parse(s.out)); } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!samples.length) return { success: false, error: 'não foi possível medir' };
  const avg = (k) => Math.round(samples.reduce((a, b) => a + (b[k] || 0), 0) / samples.length);
  const max = (k) => Math.max(...samples.map((b) => b[k] || 0));
  const cpu = avg('cpu');
  const coreMax = max('core');
  const gpu = avg('gpu');
  const ram = max('ram');
  const ramGb = samples[0].ramGb || null;
  const gpuBound = gpu >= 90;
  const cpuBound = !gpuBound && (coreMax >= 90 || cpu >= 75);
  const ramBound = !gpuBound && !cpuBound && ram >= 90;
  const verdict = gpuBound ? 'gpu' : cpuBound ? 'cpu' : ramBound ? 'ram' : 'balanced';
  let game = null;
  if (pid) { try { const g = await core.ps(`$p = Get-Process -Id ${parseInt(pid, 10)} -ErrorAction SilentlyContinue; if ($p) { Write-Output $p.ProcessName }`); game = g.out.split('\n')[0].trim() || null; } catch (e) {} }
  const dicas = {
    gpu: 'Para mais FPS: ative DLSS, FSR ou XeSS, baixe a resolução ou as sombras e reflexos.',
    cpu: 'No jogo: limite o FPS e reduza o que pesa no processador (distância de visão, multidões, física).',
    ram: 'Feche navegador e apps pesados antes de jogar; confira se a memória virtual está no automático.',
    balanced: 'PC equilibrado: nenhuma peça está no limite. Se quiser mais FPS, o caminho é reduzir gráficos.',
  };
  return {
    success: true, game, seconds: secs, samples: samples.length,
    cpu, coreMax, gpu, ram, ramGb, verdict, dica: dicas[verdict],
    meters: { cpu, core: coreMax, gpu },
  };
};

"""
s = s[:start] + new_bn + s[end:]
print("gargalo ok")

# --- 2) jogos: resolver o .exe de cada jogo ---
old_scan_head = "ex.gamesScan = async () => {\n  const games = [];"
new_scan_head = """const findGameExe = (dir) => {
  if (!dir || !fs.existsSync(dir)) return '';
  const cands = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\\.exe$/i.test(e.name)) {
        try { const st = fs.statSync(p); if (st.size > 200 * 1024) cands.push({ p, size: st.size, name: e.name }); } catch (err) {}
      }
    }
  };
  walk(dir, 0);
  if (!cands.length) return '';
  // prioriza nomes que parecem jogo, depois o maior exe
  const scored = cands.map((c) => {
    const n = c.name.toLowerCase();
    let s = c.size;
    if (/launcher|unins|setup|crash|report|updater|service|tool/.test(n)) s /= 10;
    if (/(gta|fivem|cs2|valorant|fortnite|game|shipping)/.test(n)) s *= 2;
    return { p: c.p, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].p;
};

ex.gamesScan = async () => {
  const games = [];"""
if old_scan_head not in s:
    raise SystemExit("gamesScan head nÃ£o encontrado")
s = s.replace(old_scan_head, new_scan_head)

# steam: preencher exe
s = s.replace("games.push({ id: 'steam:' + appid, name, dir: dir ? path.join(appsDir, 'common', dir) : '', exe: '', gpu: true, canClean: true, appid, store: 'steam' });",
              "games.push({ id: 'steam:' + appid, name, dir: dir ? path.join(appsDir, 'common', dir) : '', exe: dir ? findGameExe(path.join(appsDir, 'common', dir)) : '', gpu: true, canClean: true, appid, store: 'steam' });")
# epic
s = s.replace("games.push({ id: 'epic:' + j.AppName, name: j.DisplayName, dir: j.InstallLocation, exe: '', gpu: true, canClean: true, store: 'epic' });",
              "games.push({ id: 'epic:' + j.AppName, name: j.DisplayName, dir: j.InstallLocation, exe: findGameExe(j.InstallLocation), gpu: true, canClean: true, store: 'epic' });")
# fivem
s = s.replace("games.push({ id: 'fivem', name: 'FiveM (GTA RP)', dir: path.join(fivem, 'FiveM.app'), exe: '', gpu: true, canClean: true, store: 'fivem' });",
              "games.push({ id: 'fivem', name: 'FiveM (GTA RP)', dir: path.join(fivem, 'FiveM.app'), exe: path.join(fivem, 'FiveM.app', 'FiveM.exe'), gpu: true, canClean: true, store: 'fivem' });")

# GPU dedicada: usar o exe do jogo
s = s.replace("""ex.gpuDedicated = async (gameId, on) => {
  const g = (gamesCache || []).find((x) => x.id === gameId);
  if (!g || !g.dir) return { success: false, error: 'jogo sem pasta' };
  return ex.gpuDedicatedForExe(g.dir, on);
};""", """ex.gpuDedicated = async (gameId, on) => {
  const g = (gamesCache || []).find((x) => x.id === gameId);
  if (!g) return { success: false, error: 'jogo não encontrado' };
  const exe = g.exe || (g.dir ? findGameExe(g.dir) : '');
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'não achei o executável deste jogo para marcar a GPU dedicada.' };
  g.exe = exe;
  return ex.gpuDedicatedForExe(exe, on);
};""")

# --- 3) PC Info: slots reais ---
s = s.replace("mem = @{ modules = $mem; slots = [int]$sys.NumberOfLogicalProcessors }",
              "mem = @{ modules = $mem; slots = [int]((Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1).MemoryDevices) }")
print("jogos + slots definidos")
io.open(p, "w", encoding="utf-8").write(s)
