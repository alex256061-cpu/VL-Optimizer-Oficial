import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ═══════════ 1. engine-extras: bloco SCALING -> Lossless Scaling ═══════════
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

start = s.find("// ────────────────────────────── SCALING ──────────────────────────────")
end = s.find("// ────────────────────────────── MISC ──────────────────────────────")
if start < 0 or end < 0:
    raise SystemExit("bloco scaling não encontrado")

block = r"""// ────────────────────────────── SCALING (Lossless Scaling) ──────────────────────────────
// O motor é o Lossless Scaling instalado pelo usuário (Steam). A janela VL Scaling lê e grava
// as opções no Settings.xml dele e abre o executável minimizado.
const LS_EXE = 'LosslessScaling.exe';
const LS_DIR = 'Lossless Scaling';
const lsSettingsPath = () => path.join(os.homedir(), 'AppData', 'Local', LS_DIR, 'Settings.xml');
const lsBackupPath = () => path.join(APP_DATA(), 'lossless-settings.backup.xml');
const scalingCfg = () => readJson('scaling.json', { engine: '', config: {} });
const saveScaling = (v) => writeJson('scaling.json', v);

function steamLibs() {
  const out = [];
  try {
    if (steamRoot) {
      out.push(steamRoot);
      const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
    }
  } catch (e) {}
  return out;
}

async function lsDetect(force) {
  const c = scalingCfg();
  if (!force && c.engine && fs.existsSync(c.engine)) return c.engine;
  if (!steamRoot) { try { await ex.initSteam(); } catch (e) {} }
  const cands = [];
  if (c.engine) cands.push(c.engine);
  cands.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  cands.push('C:\\Program Files\\Steam\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  for (const lib of steamLibs()) cands.push(path.join(lib, 'steamapps', 'common', LS_DIR, LS_EXE));
  for (const d of ['D', 'E', 'F', 'G']) cands.push(d + ':\\SteamLibrary\\steamapps\\common\\' + LS_DIR + '\\' + LS_EXE);
  for (const p of cands) {
    if (p && fs.existsSync(p)) { if (c.engine !== p) { c.engine = p; saveScaling(c); } return p; }
  }
  return null;
}

const LS_CFG_TO_XML = {
  fgType: { lsfg31: 'LSFG3', lsfg23: 'LSFG2', lsfg11: 'LSFG1', off: 'OFF' },
  lsfg3Mode: { adaptive: 'ADAPTIVE', fixed: 'FIXED' },
  lsfg2Mode: { fusion: 'FUSION', normal: 'NORMAL' },
  captureApi: { dxgi: 'DXGI', wgc: 'WGC' },
  scaleType: { off: 'OFF', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'INTEGER', nearest: 'NN', xbr: 'XBR', anime4k: 'ANIME4K' },
  fsrType: { fsr1: 'FSR1', fsr2: 'FSR2', fsr3: 'FSR3' },
  scaleMode: { auto: 'Auto', custom: 'Custom' },
  fitMode: { fullscreen: 'FULLSCREEN', stretch: 'STRETCH', fit: 'FIT' },
  syncMode: { standard: 'DEFAULT', vsync: 'VSYNC1', gsync: 'VSYNC2', adaptive: 'VSYNC3' },
};

function xmlGet(xml, name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i').exec(xml);
  return m ? m[1].trim() : null;
}
function styleOf(v) {
  if (v == null || v === '') return 'upper';
  if (v === v.toUpperCase()) return 'upper';
  if (v === v.toLowerCase()) return 'lower';
  if (v[0] === v[0].toUpperCase() && v.slice(1) === v.slice(1).toLowerCase()) return 'capital';
  return 'upper';
}
function applyStyle(v, style) {
  if (style === 'lower') return String(v).toLowerCase();
  if (style === 'capital') { const t = String(v).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); }
  return String(v).toUpperCase();
}
function xmlSet(xml, name, value) {
  const cur = xmlGet(xml, name);
  let v = String(value);
  if (typeof value === 'string' && /^[A-Za-z]+$/.test(value) && cur != null) v = applyStyle(value, styleOf(cur));
  const re = new RegExp('(<' + name + '>)([^<]*)(</' + name + '>)', 'i');
  if (re.test(xml)) return xml.replace(re, '$1' + v + '$3');
  const idx = xml.lastIndexOf('</');
  if (idx < 0) return xml;
  return xml.slice(0, idx) + '<' + name + '>' + v + '</' + name + '>\n' + xml.slice(idx);
}

function lsParse(xml) {
  const g = (n) => xmlGet(xml, n);
  const b = (n) => /true/i.test(g(n) || '');
  const num = (n) => { const v = g(n); return v == null || v === '' ? null : Number(v); };
  return {
    FrameGeneration: g('FrameGeneration'),
    LSFG3Mode1: g('LSFG3Mode1'),
    LSFG3Multiplier: num('LSFG3Multiplier'),
    LSFG3Target: num('LSFG3Target'),
    LSFGFlowScale: num('LSFGFlowScale'),
    LSFGSize: g('LSFGSize'),
    LSFG2Mode: g('LSFG2Mode'),
    CaptureApi: g('CaptureApi'),
    QueueTarget: num('QueueTarget'),
    ScalingType: g('ScalingType'),
    FSRType: g('FSRType'),
    Sharpness: num('Sharpness'),
    ScalingMode: g('ScalingMode'),
    ScaleFactor: num('ScaleFactor'),
    ScalingFitMode: g('ScalingFitMode'),
    SyncMode: g('SyncMode'),
    HdrSupport: b('HdrSupport'),
    AutoScale: b('AutoScale'),
    AutoScaleDelay: num('AutoScaleDelay'),
    ScaleCursor: b('ScaleCursor'),
    VRS: b('VRS'),
    WindowedMode: b('WindowedMode'),
    ResizeBeforeScaling: b('ResizeBeforeScaling'),
    StartAsAdmin: b('StartAsAdmin'),
    MinimizeToTray: b('MinimizeToTray'),
  };
}

function lsRoot(xml) { const m = /<([A-Za-z_][\w.-]*)[\s>]/.exec(xml); return m ? m[1] : 'Settings'; }

function lsWrite(cfg) {
  const file = lsSettingsPath();
  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  const firstRun = !xml;
  if (!xml) {
    xml = '<?xml version="1.0" encoding="utf-8"?>\n<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n</Settings>\n';
  } else {
    try { if (!fs.existsSync(lsBackupPath())) fs.writeFileSync(lsBackupPath(), xml, 'utf8'); } catch (e) {}
  }
  const applied = [];
  const skipped = [];
  const put = (name, val) => {
    if (val === undefined || val === null || val === '') { skipped.push(name); return; }
    xml = xmlSet(xml, name, val);
    applied.push(name);
  };

  if (cfg.fgType != null) put('FrameGeneration', LS_CFG_TO_XML.fgType[cfg.fgType] || null);
  if (cfg.lsfg3Mode != null) put('LSFG3Mode1', LS_CFG_TO_XML.lsfg3Mode[cfg.lsfg3Mode] || null);
  if (cfg.lsfg3Multiplier != null) put('LSFG3Multiplier', Math.round(cfg.lsfg3Multiplier));
  if (cfg.lsfg3Target != null) put('LSFG3Target', Math.round(cfg.lsfg3Target));
  if (cfg.lsfg2Mode != null) put('LSFG2Mode', LS_CFG_TO_XML.lsfg2Mode[cfg.lsfg2Mode] || null);
  if (cfg.flowScale != null) put('LSFGFlowScale', Math.round(Number(cfg.flowScale) * 100));
  if (cfg.perfMode != null) put('LSFGSize', cfg.perfMode ? 'PERFORMANCE' : 'DEFAULT');
  if (cfg.captureApi != null) put('CaptureApi', LS_CFG_TO_XML.captureApi[cfg.captureApi] || null);
  if (cfg.queueTarget != null) put('QueueTarget', Math.round(cfg.queueTarget));
  if (cfg.scaleType != null) put('ScalingType', LS_CFG_TO_XML.scaleType[cfg.scaleType] || null);
  if (cfg.fsrType != null) put('FSRType', LS_CFG_TO_XML.fsrType[cfg.fsrType] || null);
  if (cfg.sharpness != null) put('Sharpness', Math.round(Number(cfg.sharpness) / 10));
  if (cfg.scaleMode != null) put('ScalingMode', LS_CFG_TO_XML.scaleMode[cfg.scaleMode] || null);
  if (cfg.scaleFactor != null) put('ScaleFactor', Number(cfg.scaleFactor).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  if (cfg.fitMode != null) put('ScalingFitMode', LS_CFG_TO_XML.fitMode[cfg.fitMode] || null);
  if (cfg.syncMode != null) put('SyncMode', LS_CFG_TO_XML.syncMode[cfg.syncMode] || null);
  if (cfg.hdrCompat != null) put('HdrSupport', cfg.hdrCompat ? 'true' : 'false');
  if (cfg.resizeBefore != null) put('ResizeBeforeScaling', cfg.resizeBefore ? 'true' : 'false');
  if (cfg.scaleCursor != null) put('ScaleCursor', cfg.scaleCursor ? 'true' : 'false');
  if (cfg.vrs != null) put('VRS', cfg.vrs ? 'true' : 'false');
  if (cfg.autoScale != null) put('AutoScale', cfg.autoScale ? 'true' : 'false');
  if (cfg.autoDelay != null) put('AutoScaleDelay', Math.round(cfg.autoDelay));
  if (cfg.windowedMode != null) put('WindowedMode', cfg.windowedMode ? 'true' : 'false');
  if (cfg.startAsAdmin != null) put('StartAsAdmin', cfg.startAsAdmin ? 'true' : 'false');

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, xml, 'utf8');
    return { success: true, applied: applied.length, skipped, firstRun, file, settings: lsParse(xml) };
  } catch (e) {
    return { success: false, error: 'Não foi possível gravar o Settings.xml do Lossless: ' + e.message, applied: 0, skipped };
  }
}

function lsRecommended() {
  return {
    FrameGeneration: 'LSFG3', LSFG3Mode1: 'ADAPTIVE', LSFG3Multiplier: 2, LSFG3Target: 100, LSFGFlowScale: 100,
    LSFGSize: 'DEFAULT', CaptureApi: 'DXGI', QueueTarget: 1, ScalingType: 'NIS', FSRType: 'ORIGINAL',
    Sharpness: 50, ScalingMode: 'Auto', ScaleFactor: 1.5, ScalingFitMode: 'FULLSCREEN', SyncMode: 'DEFAULT',
    HdrSupport: false, AutoScale: true, ScaleCursor: true, VRS: false, WindowedMode: false, ResizeBeforeScaling: false,
  };
}

ex.lsSettingsPath = lsSettingsPath;
ex.lsRead = () => {
  const file = lsSettingsPath();
  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  return { file, exists: !!xml, settings: xml ? lsParse(xml) : null };
};
ex.lsConfig = (cfg) => {
  if (cfg && typeof cfg === 'object') {
    const r = lsWrite(cfg);
    if (r.success) {
      const c = scalingCfg();
      c.config = cfg;
      saveScaling(c);
    }
    return r;
  }
  const cur = ex.lsRead();
  return {
    success: true,
    configured: cur.exists,
    needsFirstRun: !cur.exists,
    current: cur.exists ? cur.settings : lsRecommended(),
    recommended: lsRecommended(),
    file: cur.file,
    engine: scalingCfg().engine || null,
  };
};

ex.lsFind = async () => {
  const p = await lsDetect(false);
  return p ? { path: p } : null;
};
ex.lsBrowse = async () => {
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog({ title: 'Escolha o LosslessScaling.exe', filters: [{ name: 'Executáveis', extensions: ['exe'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const c = scalingCfg(); c.engine = res.filePaths[0]; saveScaling(c);
  return { path: res.filePaths[0] };
};
ex.lsRunning = async () => {
  const r = await core.ps(`$p = @(Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue); Write-Output $p.Count`);
  return (parseInt(r.out, 10) || 0) > 0;
};
ex.lsLaunch = async (cfg) => {
  const exePath = await lsDetect(true);
  if (!exePath) return { success: false, error: 'Lossless Scaling não encontrado. Instale pela Steam (ou escolha o .exe na engrenagem).' };
  let applied = null;
  if (cfg && typeof cfg === 'object') applied = lsWrite(cfg);
  // fecha uma instância antiga para pegar as opções novas
  await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`, 20000);
  try {
    const args = ['-StartMinimized'];
    const child = spawn(exePath, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) });
    child.unref();
    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);
    let message;
    if (applied && applied.firstRun) message = 'Primeira vez: o Lossless criou o perfil. Se as opções não pegarem, clique Iniciar de novo.';
    else if (applied && applied.applied) message = 'Opções aplicadas no Lossless.';
    return { success: true, message, engine: exePath, applied: applied ? applied.applied : 0 };
  } catch (e) {
    return { success: false, error: 'Falha ao abrir o Lossless: ' + e.message };
  }
};
ex.lsStop = async () => {
  const r = await core.ps(`Get-Process -Name 'LosslessScaling' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Output 'ok'`, 20000);
  return { success: r.ok };
};
ex.lsStatus = async () => ({ running: await ex.lsRunning(), engine: scalingCfg().engine || null, needsFirstRun: !ex.lsRead().exists });

"""
s = s[:start] + block + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("scaling block ok")

# ═══════════ 2. hibernação: probe correto ═══════════
p = ROOT + r"\engine.js"
s = io.open(p, encoding="utf-8").read()
old_probe = "probe: `$h = Get-Val '${HKLM}\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\Session Manager\\\\Power' 'HiberbootEnabled'; Write-Output (if ($h -eq 0) { '1' } else { '0' })`,"
new_probe = "probe: `$h = Get-Val '${HKLM}\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\Power' 'HibernateEnabled'; Write-Output (if ($null -eq $h -or $h -eq 0) { '1' } else { '0' })`,"
if old_probe in s:
    s = s.replace(old_probe, new_probe)
    print("hibernação ok")
else:
    print("AVISO: probe de hibernação não encontrado")
io.open(p, "w", encoding="utf-8").write(s)
