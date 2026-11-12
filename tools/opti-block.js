// ────────────────────────────── OPTISCALER ──────────────────────────────
// Instalação real: baixa o release (.7z), extrai com 7zr, copia TUDO para a pasta do jogo,
// renomeia OptiScaler.dll para o proxy escolhido (dxgi.dll por padrão) e guarda backup de tudo.
const OPTI_DIR = () => path.join(APP_DATA(), 'optiscaler');
const OPTI_JSON = () => path.join(APP_DATA(), 'opti.json');
function optiStore() { try { return JSON.parse(fs.readFileSync(OPTI_JSON(), 'utf8')); } catch (e) { return { installs: [], pkg: null }; } }
function optiSave(s) { try { fs.mkdirSync(APP_DATA(), { recursive: true }); fs.writeFileSync(OPTI_JSON(), JSON.stringify(s, null, 1)); } catch (e) {} }

const OPTI_PROXIES = ['dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'];
const ANTI_CHEAT = ['valorant', 'cs2', 'fortnite', 'warzone', 'cod', 'call of duty', 'fivem', 'r5apex', 'apex', 'destiny2', 'rainbowsix', 'deadbydaylight', 'rust', 'pubg', 'tarkov', 'overwatch', 'thefinals', 'xdefiant', 'bf2042'];

function httpsGet(url, cb, redirects = 0) {
  const https = require('https');
  if (redirects > 6) return cb(new Error('redirect loop'), null);
  https.get(url, { headers: { 'User-Agent': 'VL-Optimizer', Accept: '*/*' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      return httpsGet(new URL(res.headers.location, url).toString(), cb, redirects + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode), null); }
    cb(null, res);
  }).on('error', (e) => cb(e, null));
}

function downloadTo(url, dest) {
  return new Promise((resolve) => {
    httpsGet(url, (err, res) => {
      if (err) return resolve({ success: false, error: err.message });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve({ success: true, size: fs.statSync(dest).size }); });
      out.on('error', (e) => resolve({ success: false, error: e.message }));
    });
  });
}

async function ensure7zr() {
  const bin = path.join(APP_DATA(), 'bin');
  const f = path.join(bin, '7zr.exe');
  if (fs.existsSync(f) && fs.statSync(f).size > 100000) return f;
  fs.mkdirSync(bin, { recursive: true });
  const r = await downloadTo('https://www.7-zip.org/a/7zr.exe', f);
  return r.success ? f : null;
}

async function extractPkg(pkgFile, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (/\.7z$/i.test(pkgFile)) {
    const z = await ensure7zr();
    if (!z) return { success: false, error: 'não foi possível baixar o extrator 7zr' };
    const r = await core.ps(`& '${z.replace(/'/g, "''")}' x -y '-o${dest.replace(/'/g, "''")}' '${pkgFile.replace(/'/g, "''")}' | Out-Null; Write-Output 'ok'`, 300000);
    if (!r.ok || !fs.existsSync(path.join(dest, 'OptiScaler.dll'))) return { success: false, error: 'falha ao extrair o .7z' };
    return { success: true };
  }
  const r = await core.ps(`Expand-Archive -LiteralPath '${pkgFile.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force; Write-Output 'ok'`, 300000);
  if (!r.ok) return { success: false, error: 'falha ao extrair o .zip' };
  return { success: true };
}

ex.optiStatus = async () => {
  const st = optiStore();
  const caps = await core.getCaps();
  return { success: true, nvidia: !!caps.nvidia, pkg: st.pkg ? { tag: st.pkg.tag } : null, dl: { running: false, pct: 0 }, installs: st.installs || [] };
};

ex.optiDownload = async () => {
  const st = optiStore();
  const dir = OPTI_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const api = await new Promise((resolve) => {
    httpsGet('https://api.github.com/repos/optiscaler/OptiScaler/releases/latest', (err, res) => {
      if (err) return resolve({ success: false, error: err.message });
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => { try { resolve({ success: true, json: JSON.parse(body) }); } catch (e) { resolve({ success: false, error: 'resposta inválida' }); } });
    });
  });
  if (!api.success) return { success: false, error: api.error };
  const asset = (api.json.assets || []).find((a) => /\.(7z|zip)$/i.test(a.name));
  if (!asset) return { success: false, error: 'release sem pacote .7z/.zip' };
  const ext = /\.7z$/i.test(asset.name) ? '.7z' : '.zip';
  const file = path.join(dir, 'OptiScaler' + ext);
  const dl = await downloadTo(asset.browser_download_url, file);
  if (!dl.success) return { success: false, error: 'download: ' + dl.error };
  st.pkg = { tag: api.json.tag_name || 'latest', file, name: asset.name, at: Date.now() };
  optiSave(st);
  return { success: true, tag: st.pkg.tag, size: dl.size, name: asset.name };
};

function scanUpscalers(dir) {
  const out = { dlss: false, fsr: false, xess: false };
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
      else {
        const n = e.name.toLowerCase();
        if (/nvngx_dlss|dlss/.test(n)) out.dlss = true;
        if (/ffx|fsr|amd_fidelityfx/.test(n)) out.fsr = true;
        if (/xess/.test(n)) out.xess = true;
      }
    }
  };
  walk(dir, 0);
  return out;
}

ex.optiAnalyze = async ({ exe }) => {
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'executável inválido' };
  const dir = path.dirname(exe);
  const name = (path.basename(exe) + ' ' + path.basename(dir)).toLowerCase();
  const antiCheat = ANTI_CHEAT.filter((a) => name.includes(a));
  const upscalers = scanUpscalers(dir);
  const st = optiStore();
  const installed = (st.installs || []).find((i) => i.dir === dir);
  const existing = OPTI_PROXIES.find((d) => fs.existsSync(path.join(dir, d)));
  return { success: true, exe, dir, installed: !!installed, block: antiCheat.length > 0, antiCheat, upscalers, existingProxy: existing || null, notes: [] };
};

ex.optiDetect = async () => {
  const r = await core.ps(`$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 1; if ($p) { Write-Output $p.Path }`);
  const exe = r.out.split('\n')[0].trim();
  if (!exe) return { success: false, error: 'Nenhum jogo aberto agora.' };
  return ex.optiAnalyze({ exe });
};

ex.optiBrowse = async () => {
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog({ title: 'Escolha o .exe do jogo', filters: [{ name: 'Executáveis', extensions: ['exe'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  return ex.optiAnalyze({ exe: res.filePaths[0] });
};

function copyTree(srcRoot, dstRoot, skip, created) {
  const walk = (rel) => {
    const src = path.join(srcRoot, rel);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      if (skip(dirName(rel))) return;
      fs.mkdirSync(path.join(dstRoot, rel), { recursive: true });
      for (const e of fs.readdirSync(src)) walk(path.join(rel, e));
    } else {
      if (skip(path.basename(rel))) return;
      const dst = path.join(dstRoot, rel);
      if (fs.existsSync(dst)) {
        const bak = dst + '.lopt-backup';
        if (!fs.existsSync(bak)) { fs.renameSync(dst, bak); created.backups.push({ orig: dst, bak }); }
        else fs.rmSync(dst, { force: true });
      }
      fs.copyFileSync(src, dst);
      created.files.push(dst);
    }
  };
  const dirName = (r) => path.basename(r || '').toLowerCase();
  for (const e of fs.readdirSync(srcRoot)) walk(e);
}

ex.optiInstall = async ({ exe, dll, opts }) => {
  const st = optiStore();
  if (!st.pkg || !fs.existsSync(st.pkg.file)) return { success: false, error: 'Baixe o OptiScaler primeiro.' };
  const dir = path.dirname(exe);
  const proxy = OPTI_PROXIES.includes(String(dll)) ? String(dll) : 'dxgi.dll';
  const tmp = path.join(OPTI_DIR(), 'unz');
  try {
    const ext = await extractPkg(st.pkg.file, tmp);
    if (!ext.success) return ext;
    const created = { files: [], backups: [] };
    copyTree(tmp, dir, (n) => /^(setup_windows\.bat|setup_linux\.sh|readme.*\.txt)$/i.test(n) || /^!!/.test(n), created);
    // renomeia OptiScaler.dll para o proxy escolhido
    const optiDll = path.join(dir, 'OptiScaler.dll');
    const target = path.join(dir, proxy);
    if (!fs.existsSync(optiDll)) return { success: false, error: 'OptiScaler.dll não veio no pacote' };
    if (fs.existsSync(target)) {
      const bak = target + '.lopt-backup';
      if (!fs.existsSync(bak)) { fs.renameSync(target, bak); created.backups.push({ orig: target, bak }); }
      else fs.rmSync(target, { force: true });
    }
    fs.renameSync(optiDll, target);
    created.files.push(target);
    created.files = created.files.filter((f) => f !== optiDll);

    // ini: usa o do pacote e só mexe em chaves documentadas
    const ini = path.join(dir, 'OptiScaler.ini');
    if (fs.existsSync(ini)) {
      let txt = fs.readFileSync(ini, 'utf8');
      const setKey = (k, v) => { txt = txt.replace(new RegExp('^' + k + '=.*$', 'm'), k + '=' + v); };
      if (opts && opts.upscaler && opts.upscaler !== 'auto') { setKey('Dx12Upscaler', opts.upscaler); }
      if (opts && opts.fg != null) { txt = txt.replace(/^Enabled=.*$/m, 'Enabled=' + (opts.fg ? 'true' : 'false')); }
      if (opts && opts.spoof === false) setKey('Dxgi', 'false');
      fs.writeFileSync(ini, txt, 'utf8');
    }
    st.installs = st.installs || [];
    st.installs.push({ dir, exe, tag: st.pkg.tag, dll: proxy, at: Date.now(), opts: opts || {}, files: created.files, backups: created.backups });
    optiSave(st);
    return { success: true, dir, dll: proxy, files: created.files.length, backups: created.backups.length };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiUninstall = async ({ dir }) => {
  const st = optiStore();
  const i = (st.installs || []).find((x) => x.dir === dir);
  if (!i) return { success: false, error: 'não instalado' };
  try {
    for (const f of i.files || []) { try { if (fs.existsSync(f)) fs.rmSync(f, { force: true }); } catch (e) {} }
    for (const b of i.backups || []) { try { if (fs.existsSync(b.bak)) { if (fs.existsSync(b.orig)) fs.rmSync(b.orig, { force: true }); fs.renameSync(b.bak, b.orig); } } catch (e) {} }
    for (const d of ['D3D12_Optiscaler', 'Licenses', 'DlssOverrides']) { try { fs.rmSync(path.join(dir, d), { recursive: true, force: true }); } catch (e) {} }
    st.installs = st.installs.filter((x) => x.dir !== dir);
    optiSave(st);
    return { success: true, restored: (i.backups || []).length };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiConfig = async ({ dir, opts }) => {
  const st = optiStore();
  const i = (st.installs || []).find((x) => x.dir === dir);
  if (!i) return { success: false, error: 'não instalado' };
  Object.assign(i.opts, opts || {});
  const ini = path.join(dir, 'OptiScaler.ini');
  try {
    if (fs.existsSync(ini)) {
      let txt = fs.readFileSync(ini, 'utf8');
      const setKey = (k, v) => { txt = txt.replace(new RegExp('^' + k + '=.*$', 'm'), k + '=' + v); };
      if (i.opts.upscaler && i.opts.upscaler !== 'auto') setKey('Dx12Upscaler', i.opts.upscaler);
      if (i.opts.fg != null) txt = txt.replace(/^Enabled=.*$/m, 'Enabled=' + (i.opts.fg ? 'true' : 'false'));
      if (i.opts.spoof === false) setKey('Dxgi', 'false');
      fs.writeFileSync(ini, txt, 'utf8');
    }
    optiSave(st);
    return { success: true, opts: i.opts, running: false };
  } catch (e) { return { success: false, error: e.message }; }
};

ex.optiOpenFolder = ({ dir }) => { try { require('electron').shell.openPath(dir); return { success: true }; } catch (e) { return { success: false }; } };

