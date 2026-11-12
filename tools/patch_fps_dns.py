import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# ───────── 1) FPS: frames com timestamp + 1% low real de 10 s + captura por processo ─────────
old = """    let buf = '';
    let header = null, ftIdx = -1;
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\\r?\\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!header) {
          if (/Application|ProcessID/i.test(line)) {
            header = line.split(',');
            ftIdx = header.findIndex((h) => /MsBetweenPresents|MsBetweenDisplayChange/i.test(h));
            fps.targetName = header[0] === 'Application' ? '' : '';
            fps.cols = header;
          }
          continue;
        }
        const cols = line.split(',');
        if (cols.length < 3) continue;
        if (!fps.targetName && cols[0]) fps.targetName = cols[0].replace(/\\.exe$/i, '') + '.exe';
        const ft = parseFloat(cols[ftIdx >= 0 ? ftIdx : cols.length - 1]);
        if (!isFinite(ft) || ft <= 0) continue;
        fps.frames.push(ft);
        if (fps.frames.length > 900) fps.frames.shift();
        const cutoff = Date.now();
        fps.low.push(ft);
        if (fps.low.length > 2400) fps.low.shift();
        const recent = fps.frames.slice(-120);
        fps.ft = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
        fps.fps = Math.round(1000 / fps.ft);
        const sorted = [...fps.frames.slice(-600)].sort((a, b) => b - a);
        const k = Math.max(0, Math.ceil(sorted.length * 0.01) - 1);
        fps.low1 = sorted.length ? Math.round(1000 / sorted[k]) : 0;
      }
    });"""
new = """    let buf = '';
    let header = null, ftIdx = -1;
    const pushFrame = (ft) => {
      if (!isFinite(ft) || ft <= 0) return;
      const t = Date.now();
      fps.frames.push({ t, ft });
      // janela de 10 s para o 1% low (o resto serve só para a média curta)
      while (fps.frames.length && t - fps.frames[0].t > 10000) fps.frames.shift();
      if (fps.frames.length > 2400) fps.frames.shift();
      const recent = fps.frames.slice(-120);
      fps.ft = recent.reduce((a, b) => a + b.ft, 0) / (recent.length || 1);
      fps.fps = Math.round(1000 / fps.ft);
      const inWindow = fps.frames.map((f) => f.ft).sort((a, b) => b - a);
      const k = Math.max(0, Math.ceil(inWindow.length * 0.01) - 1);
      fps.low1 = inWindow.length ? Math.round(1000 / inWindow[k]) : 0;
    };
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\\r?\\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!header) {
          if (/Application|ProcessID/i.test(line)) {
            header = line.split(',');
            ftIdx = header.findIndex((h) => /MsBetweenPresents|MsBetweenDisplayChange/i.test(h));
            fps.cols = header;
          }
          continue;
        }
        const cols = line.split(',');
        if (cols.length < 3) continue;
        if (!fps.targetName && cols[0]) fps.targetName = cols[0].replace(/\\.exe$/i, '') + '.exe';
        pushFrame(parseFloat(cols[ftIdx >= 0 ? ftIdx : cols.length - 1]));
      }
    });"""
if old not in s:
    raise SystemExit("parser do fps nÃ£o encontrado")
s = s.replace(old, new)

# ───────── 2) sessão paralela: FPS por processo ─────────
anchor = "ex.fpsStatus = async () => {"
listcap = r"""// Captura paralela (sessão própria do PresentMon) só para montar a lista de FPS por processo.
const listCap = { proc: null, apps: new Map(), lastPoll: 0 };
function startListCapture() {
  if (listCap.proc) return;
  try {
    const p = spawn(PM, ['--output_stdout', '--no_console_stats', '--session_name', 'LOPT_LIST'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    listCap.proc = p;
    let buf = '', header = null, ftIdx = -1, appIdx = 0;
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (!header) {
          if (/Application|ProcessID/i.test(line)) {
            header = line.split(',');
            appIdx = header.findIndex((h) => /^Application$/i.test(h));
            if (appIdx < 0) appIdx = 0;
            ftIdx = header.findIndex((h) => /MsBetweenPresents|MsBetweenDisplayChange/i.test(h));
          }
          continue;
        }
        const cols = line.split(',');
        if (cols.length < 3) continue;
        const app = String(cols[appIdx] || '').trim();
        if (!app) continue;
        const ft = parseFloat(cols[ftIdx >= 0 ? ftIdx : cols.length - 1]);
        if (!isFinite(ft) || ft <= 0) continue;
        const now = Date.now();
        const rec = listCap.apps.get(app) || { frames: [] };
        rec.frames.push({ t: now, ft });
        while (rec.frames.length && now - rec.frames[0].t > 2500) rec.frames.shift();
        if (rec.frames.length > 400) rec.frames.shift();
        const avg = rec.frames.reduce((a, b) => a + b.ft, 0) / (rec.frames.length || 1);
        rec.fps = Math.round(1000 / avg);
        listCap.apps.set(app, rec);
      }
    });
    p.on('exit', () => { if (listCap.proc === p) listCap.proc = null; });
    p.on('error', () => { if (listCap.proc === p) listCap.proc = null; });
  } catch (e) { listCap.proc = null; }
}

"""
s = s.replace(anchor, listcap + anchor, 1)

# ───────── 3) fpsStatus: inicia a lista, devolve processos com FPS real ─────────
old_status = """  const procs = await ex.getProcesses();
  const base = fps.base ? { fps: fps.base.fps, name: fps.base.name } : null;
  return {
    success: true,
    live: fps.fps ? { fps: fps.fps, frametime: fps.ft, low1: fps.low1, name: fps.targetName, base: baseLive() } : null,
    processes: (procs.processes || []).map((p) => ({ pid: p.pid, name: p.name, fps: 0 })),
    pinned: fps.targetPid, overlay: fps.overlay, recording: fps.recording,
    sessions: { a: fps.sessions.a, b: fps.sessions.b }, base, hotkey: fps.hotkey,
  };"""
new_status = """  startListCapture();
  listCap.lastPoll = Date.now();
  const procs = await ex.getProcesses();
  const base = fps.base ? { fps: fps.base.fps, name: fps.base.name } : null;
  const byApp = {};
  for (const [app, rec] of listCap.apps) {
    // só o que teve quadros recentes
    if (rec.frames.length && Date.now() - rec.frames[rec.frames.length - 1].t < 3000 && rec.fps) {
      byApp[app.replace(/\\.exe$/i, '').toLowerCase()] = rec.fps;
    }
  }
  return {
    success: true,
    live: fps.fps ? { fps: fps.fps, frametime: fps.ft, low1: fps.low1, name: fps.targetName, base: baseLive() } : null,
    processes: (procs.processes || []).map((p) => {
      const key = String(p.name).replace(/\\.exe$/i, '').toLowerCase();
      return { pid: p.pid, name: p.name, fps: byApp[key] || 0 };
    }),
    pinned: fps.targetPid, overlay: fps.overlay, recording: fps.recording,
    sessions: { a: fps.sessions.a, b: fps.sessions.b }, base, hotkey: fps.hotkey,
  };"""
if old_status not in s:
    raise SystemExit("fpsStatus bloco nÃ£o encontrado")
s = s.replace(old_status, new_status)

# limpaz as referências antigas a fps.low
s = s.replace("fps.frames = []; fps.low = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;", "fps.frames = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;")

# ───────── 4) DNS só em adaptador físico ativo ─────────
old_set = """  const r = await ps(`Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceIndex } | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.InterfaceIndex -ServerAddresses ${list} -ErrorAction SilentlyContinue }; Write-Output 'ok'`);"""
new_set = """  const r = await ps(`
    $idx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
    foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ServerAddresses ${list} -ErrorAction SilentlyContinue }
    Write-Output 'ok'`);"""
if old_set in s:
    s = s.replace(old_set, new_set)
    print("dns set ok")
else:
    print("AVISO: dns set nÃ£o encontrado")

# detecção do DNS: lê o adaptador ativo primeiro
old_get = """    $ifs = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 })"""
new_get = """    $act = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    $ifs = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 -and ($act.Count -eq 0 -or $act -contains $_.InterfaceIndex) })"""
if old_get in s:
    s = s.replace(old_get, new_get)
    print("dns get ok")
else:
    print("AVISO: dns get nÃ£o encontrado")

io.open(p, "w", encoding="utf-8").write(s)
print("fps + dns ok")
