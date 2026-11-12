import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# ── 1) PresentMon: sessões próprias + parar sessão antiga + capturar erro ──
old = """    const p = spawn(PM, ['--process_id', String(pid), '--output_stdout', '--no_console_stats', '--terminate_on_proc_exit'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    fps.proc = p;
    fps.denied = false;
    try { p.stderr.on('data', (d) => { if (/access denied|elevated privilege|administrative/i.test(String(d))) fps.denied = true; }); } catch (e) {}"""
new = """    const p = spawn(PM, ['--process_id', String(pid), '--output_stdout', '--no_console_stats', '--terminate_on_proc_exit', '--stop_existing_session', '--session_name', 'LOPT_TARGET'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    fps.proc = p;
    fps.denied = false;
    fps.pmError = null;
    try {
      p.stderr.on('data', (d) => {
        const t = String(d);
        if (/access denied|elevated privilege|administrative/i.test(t)) fps.denied = true;
        const m = /error:\\s*([^\\r\\n]+)/i.exec(t);
        if (m) fps.pmError = m[1].trim();
      });
    } catch (e) {}"""
if old not in s:
    raise SystemExit("startPM args nÃ£o encontrados")
s = s.replace(old, new, 1)

# lista: nome próprio + stop existing + erro
old2 = """    const p = spawn(PM, ['--output_stdout', '--no_console_stats', '--session_name', 'LOPT_LIST'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    listCap.proc = p;
    listCap.denied = false;"""
new2 = """    const p = spawn(PM, ['--output_stdout', '--no_console_stats', '--session_name', 'LOPT_LIST', '--stop_existing_session'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    listCap.proc = p;
    listCap.denied = false;
    try { p.stderr.on('data', (d) => { if (/access denied|elevated privilege|administrative/i.test(String(d))) listCap.denied = true; }); } catch (e) {}"""
if old2 not in s:
    raise SystemExit("list args nÃ£o encontrados")
s = s.replace(old2, new2, 1)

# status: expõe erro do PresentMon
old3 = """    needsAdmin: !!(fps.denied || listCap.denied) && !fps.fps,
  };"""
new3 = """    needsAdmin: !!(fps.denied || listCap.denied) && !fps.fps,
    success: !(fps.pmError && !fps.fps),
    error: fps.pmError && !fps.fps ? 'Medidor: ' + fps.pmError : undefined,
  };"""
if old3 not in s:
    raise SystemExit("status return nÃ£o encontrado")
s = s.replace(old3, new3, 1)

# ── 2) measureBottleneck: uma chamada de PowerShell amostrando 1x por segundo ──
start = s.find("ex.measureBottleneck = async ({ seconds, pid }) => {")
end = s.find("// ────────────────────────────── OPTISCALER", start)
if start < 0 or end < 0:
    raise SystemExit("measureBottleneck nÃ£o encontrado")
new_bn = r"""ex.measureBottleneck = async ({ seconds, pid }) => {
  const secs = Math.max(5, Math.min(60, seconds || 15));
  const r = await core.ps(`
    $samples = @()
    for ($i = 0; $i -lt ${secs}; $i++) {
      $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $core = @(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -ne '_Total' } | Measure-Object -Property PercentProcessorTime -Maximum).Maximum
      $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'engtype_3D' } | Measure-Object -Property UtilizationPercentage -Sum).Sum
      $os = Get-CimInstance Win32_OperatingSystem
      $ramPct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100)
      $ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB)
      $samples += @{ cpu=[int]$cpu; core=[int]$core; gpu=[int][math]::Min(100, $g); ram=[int]$ramPct; ramGb=$ramTotal }
      Start-Sleep -Seconds 1
    }
    Write-Output (Json $samples)`, (${secs} + 40) * 1000);
  let samples = [];
  try { const j = JSON.parse(r.out); samples = Array.isArray(j) ? j : [j]; } catch (e) {}
  if (!samples.length) return { success: false, error: 'não foi possível medir' };
  const avg = (k) => Math.round(samples.reduce((a, b) => a + (b[k] || 0), 0) / samples.length);
  const max = (k) => Math.max(...samples.map((b) => b[k] || 0));
  const cpu = avg('cpu'), coreMax = max('core'), gpu = avg('gpu'), ram = max('ram');
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
  return { success: true, game, seconds: secs, samples: samples.length, cpu, coreMax, gpu, ram, ramGb, verdict, dica: dicas[verdict], meters: { cpu, core: coreMax, gpu } };
};

"""
s = s[:start] + new_bn + s[end:]

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
