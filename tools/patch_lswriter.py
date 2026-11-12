import io, re

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

start = s.find("const LS_CFG_TO_XML = {")
end = s.find("function lsRecommended()")
if start < 0 or end < 0:
    raise SystemExit("bloco de escrita do Lossless não encontrado")

block = r"""// Literais EXATOS dos enums do Lossless 3.2.2 (extraídos do binário).
const LS_FG = { lsfg31: 'LSFG3', lsfg23: 'LSFG2', lsfg11: 'LSFG1', off: 'Off' };
const LS_SCALING = { off: 'Off', ls1: 'LS1', fsr: 'FSR', nis: 'NIS', integer: 'Integer', nearest: 'Nearest', xbr: 'XBR', anime4k: 'Anime4K' };
const LS_FSR = { fsr1: 'ORIGINAL', fsr2: 'ORIGINAL', fsr3: 'ORIGINAL', original: 'ORIGINAL', optimized: 'OPTIMIZED' };
const LS_FIT = { fullscreen: 'Fullscreen', stretch: 'AspectRatio', fit: 'AspectRatio' };
const LS_SYNC = { standard: 'DEFAULT', vsync: 'VSYNC1', gsync: 'VSYNC2', adaptive: 'VSYNC3' };
const LS_MODE = { auto: 'Auto', custom: 'Custom' };

function xmlGet(xml, name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i').exec(xml);
  return m ? m[1].trim() : null;
}
// grava SÓ o literal exato (sem inferir maiúsculas): os enums são case-sensitive.
function xmlSet(xml, name, value) {
  const re = new RegExp('(<' + name + '>)([^<]*)(</' + name + '>)');
  if (re.test(xml)) return xml.replace(re, '$1' + String(value) + '$3');
  const idx = xml.lastIndexOf('</');
  if (idx < 0) return xml;
  return xml.slice(0, idx) + '<' + name + '>' + String(value) + '</' + name + '>\n' + xml.slice(idx);
}
function setInBlock(block, name, value) {
  const wrapped = '<r>' + block + '</r>';
  const out = xmlSet(wrapped, name, value);
  return out.slice(3, -4);
}

function lsParse(xml) {
  const g = (n) => xmlGet(xml, n);
  const b = (n) => /true/i.test(g(n) || '');
  const num = (n) => { const v = g(n); return v == null || v === '' ? null : Number(v); };
  const fg = g('FrameGeneration');
  const st = g('ScalingType');
  const sync = g('SyncMode');
  const ST_NORM = { Off: 'OFF', LS1: 'LS1', FSR: 'FSR', NIS: 'NIS', Integer: 'INTEGER', Nearest: 'NN', XBR: 'XBR', Anime4K: 'ANIME4K', SGSR: 'SGSR', BicubicCAS: 'BICUBICCAS', SharpBilinear: 'SHARPBILINEAR' };
  const SYNC_NORM = { DEFAULT: 'STANDARD', VSYNC1: 'VSYNC', VSYNC2: 'GSYNC', VSYNC3: 'ADAPTIVE', VSYNC4: 'ADAPTIVE', OFF: 'OFF' };
  return {
    FrameGeneration: fg ? String(fg).toUpperCase() : null,
    LSFG3Mode1: g('LSFG3Mode1'),
    LSFG3Multiplier: num('LSFG3Multiplier'),
    LSFG3Target: num('LSFG3Target'),
    LSFGFlowScale: num('LSFGFlowScale'),
    LSFGSize: g('LSFGSize'),
    LSFG2Mode: g('LSFG2Mode'),
    CaptureApi: g('CaptureApi'),
    QueueTarget: num('QueueTarget'),
    MaxFrameLatency: num('MaxFrameLatency'),
    ScalingType: st ? (ST_NORM[st] || String(st).toUpperCase()) : null,
    FSRType: g('FSRType') === 'OPTIMIZED' ? 'OPTIMIZED' : 'ORIGINAL',
    Sharpness: num('Sharpness'),
    ScalingMode: g('ScalingMode'),
    ScaleFactor: num('ScaleFactor'),
    ScalingFitMode: g('ScalingFitMode'),
    SyncMode: sync ? (SYNC_NORM[sync] || 'STANDARD') : null,
    GsyncSupport: b('GsyncSupport'),
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

function lsProfileParts(xml) {
  const gp = /<GameProfiles>([\s\S]*?)<\/GameProfiles>/.exec(xml);
  if (!gp) return null;
  const inner = gp[1];
  const blocks = [...inner.matchAll(/<Profile>([\s\S]*?)<\/Profile>/g)];
  for (const m of blocks) {
    const path = xmlGet(m[1], 'Path');
    if (path == null || path === '') return { inner, block: m[1], has: true };
  }
  return { inner, block: null, has: false };
}

function lsDefaultXml() {
  const isPt = (() => { try { return require('electron').app.getLocale().toLowerCase().startsWith('pt'); } catch (e) { return false; } })();
  const title = isPt ? 'Padrão' : 'Default';
  return '<Profile>\n      <Title>' + title + '</Title>\n      <AutoScale>false</AutoScale>\n      <AutoScaleDelay>0</AutoScaleDelay>\n      <ScalingMode>Auto</ScalingMode>\n      <ScalingFitMode>AspectRatio</ScalingFitMode>\n      <ScaleFactor>1.5</ScaleFactor>\n      <ResizeBeforeScaling>false</ResizeBeforeScaling>\n      <WindowedMode>false</WindowedMode>\n      <ScalingType>Off</ScalingType>\n      <FSRType>ORIGINAL</FSRType>\n      <LS1Type>BALANCED</LS1Type>\n      <LSFG2Mode>X2</LSFG2Mode>\n      <LSFG3Mode1>FIXED</LSFG3Mode1>\n      <LSFG3Multiplier>2</LSFG3Multiplier>\n      <LSFG3Target>165</LSFG3Target>\n      <LSFGFlowScale>100</LSFGFlowScale>\n      <LSFGSize>BALANCED</LSFGSize>\n      <Anime4kType>S</Anime4kType>\n      <Sharpness>5</Sharpness>\n      <LS1Sharpness>1</LS1Sharpness>\n      <VRS>false</VRS>\n      <FrameGeneration>Off</FrameGeneration>\n      <ClipCursor>true</ClipCursor>\n      <AdjustCursorSpeed>false</AdjustCursorSpeed>\n      <HideCursor>false</HideCursor>\n      <ScaleCursor>false</ScaleCursor>\n      <SyncMode>DEFAULT</SyncMode>\n      <MaxFrameLatency>3</MaxFrameLatency>\n      <GsyncSupport>true</GsyncSupport>\n      <HdrSupport>false</HdrSupport>\n      <DrawFps>true</DrawFps>\n      <CaptureApi>DXGI</CaptureApi>\n      <QueueTarget>1</QueueTarget>\n      <PreferredGpuId>0</PreferredGpuId>\n      <OutputDisplayId>0</OutputDisplayId>\n      <CropInput>false</CropInput>\n      <CropInputLeft>0</CropInputLeft>\n      <CropInputTop>0</CropInputTop>\n      <CropInputRight>0</CropInputRight>\n      <CropInputBottom>0</CropInputBottom>\n      <MultiDisplayMode>false</MultiDisplayMode>\n    </Profile>';
}

function lsWrite(cfg) {
  const file = lsSettingsPath();
  let xml = null;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) {}
  if (!xml) return { success: false, needsFirstRun: true, error: 'Abra o Lossless Scaling uma vez (ele cria o Settings.xml) e tente de novo.', applied: 0, skipped: [] };
  try { fs.copyFileSync(file, lsBackupPath()); } catch (e) {}

  const parts = lsProfileParts(xml);
  if (!parts) return { success: false, error: 'Settings.xml sem <GameProfiles> — abra o Lossless uma vez.', applied: 0, skipped: [] };
  let block = parts.block || lsDefaultXml();
  const applied = [];
  const skipped = [];
  const put = (name, val) => {
    if (val === undefined || val === null || val === '') { skipped.push(name); return; }
    block = setInBlock(block, name, val);
    applied.push(name);
  };

  if (cfg.fgType != null) put('FrameGeneration', LS_FG[cfg.fgType]);
  if (cfg.lsfg3Mode != null) put('LSFG3Mode1', cfg.lsfg3Mode === 'adaptive' ? 'ADAPTIVE' : 'FIXED');
  if (cfg.lsfg3Multiplier != null) put('LSFG3Multiplier', Math.round(cfg.lsfg3Multiplier));
  if (cfg.lsfg3Target != null) put('LSFG3Target', Math.round(cfg.lsfg3Target));
  if (cfg.flowScale != null) put('LSFGFlowScale', Math.round(Number(cfg.flowScale) * 100));
  if (cfg.perfMode != null) put('LSFGSize', cfg.perfMode ? 'PERFORMANCE' : 'BALANCED');
  if (cfg.captureApi != null) put('CaptureApi', cfg.captureApi === 'wgc' ? 'WGC' : 'DXGI');
  if (cfg.queueTarget != null) { put('QueueTarget', Math.round(cfg.queueTarget)); put('MaxFrameLatency', Math.min(16, Math.max(1, Math.round(cfg.queueTarget)))); }
  if (cfg.scaleType != null) put('ScalingType', LS_SCALING[cfg.scaleType]);
  if (cfg.fsrType != null) put('FSRType', LS_FSR[cfg.fsrType] || 'ORIGINAL');
  if (cfg.sharpness != null) put('Sharpness', Math.round(Number(cfg.sharpness) / 10));
  if (cfg.scaleMode != null) put('ScalingMode', LS_MODE[cfg.scaleMode] || 'Auto');
  if (cfg.scaleFactor != null) put('ScaleFactor', Number(cfg.scaleFactor).toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  if (cfg.fitMode != null) put('ScalingFitMode', LS_FIT[cfg.fitMode] || 'AspectRatio');
  if (cfg.syncMode != null) { put('SyncMode', LS_SYNC[cfg.syncMode] || 'DEFAULT'); put('GsyncSupport', cfg.syncMode === 'gsync' ? 'true' : 'false'); }
  if (cfg.hdrCompat != null) put('HdrSupport', cfg.hdrCompat ? 'true' : 'false');
  if (cfg.resizeBefore != null) put('ResizeBeforeScaling', cfg.resizeBefore ? 'true' : 'false');
  if (cfg.scaleCursor != null) put('ScaleCursor', cfg.scaleCursor ? 'true' : 'false');
  if (cfg.vrs != null) put('VRS', cfg.vrs ? 'true' : 'false');
  if (cfg.autoScale != null) put('AutoScale', cfg.autoScale ? 'true' : 'false');
  if (cfg.autoDelay != null) put('AutoScaleDelay', Math.round(cfg.autoDelay));
  if (cfg.windowedMode != null) put('WindowedMode', cfg.windowedMode ? 'true' : 'false');

  let inner;
  if (parts.has) {
    inner = parts.inner.replace(parts.block, block);
  } else {
    inner = parts.inner.trim() === '' ? '\n    ' + block + '\n  ' : parts.inner + '\n    ' + block + '\n  ';
  }
  let out = xml.replace(parts.inner, inner);
  if (cfg.startAsAdmin != null) out = xmlSet(out, 'StartAsAdmin', cfg.startAsAdmin ? 'true' : 'false');

  try {
    fs.writeFileSync(file, out, 'utf8');
    const cur = lsParse((lsProfileParts(out) || {}).block || out);
    return { success: true, applied: applied.length, skipped, firstRun: false, file, settings: cur };
  } catch (e) {
    return { success: false, error: 'Não foi possível gravar o Settings.xml: ' + e.message, applied: 0, skipped };
  }
}

"""
s = s[:start] + block + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("writer reescrito")
