// main.js — VL Optimizer (Electron)
const { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, globalShortcut } = require('electron');

// Rastreio de janelas (temporario): registra toda janela criada e toda pagina carregada.
try {
  const fsLog = require('fs');
  const LOGF = "C:\\VLTemp\\janela-log3.txt";
  const registrar = (linha) => {
    try { fsLog.appendFileSync(LOGF, linha + '\n'); } catch (e) { }
  };
  app.on('browser-window-created', (_e, w) => {
    const pilha = (new Error().stack || '').split('\n').slice(2, 7).map(s => s.trim().replace(/^at /, '')).join(' <- ');
    registrar('CRIADA :: ' + pilha);
  });
  const proto = BrowserWindow.prototype;
  const lf = proto.loadFile;
  proto.loadFile = function (f, ...rest) {
    const pilha = (new Error().stack || '').split('\n').slice(2, 8).map(s => s.trim().replace(/^at /, '')).join(' <- ');
    registrar('CARREGOU ' + String(f).split(/[\\/]/).pop() + ' :: ' + pilha);
    return lf.call(this, f, ...rest);
  };
} catch (e) { }

const path = require('path');
const fs = require('fs');
const os = require('os');

const core = require('./engine');
const ex = require('./engine-extras');
const feat = require('./features');
const updater = require('./updater');
const conta = require('./supabase');
require('./engine-scaler').mountScaler(ex);

// Em modos de teste, usa um perfil isolado: evita conflito com a instância elevada
// (cache do Chromium preso por admin faz o sandbox de rede falhar com acesso negado).
const TEST_FLAGS = ['--smoke', '--shots', '--siteshot', '--uitest', '--pcshot', '--optishot', '--animcheck', '--animstrip', '--ftest'];
if (TEST_FLAGS.some((f) => process.argv.includes(f))) {
  try { app.setPath('userData', path.join(os.tmpdir(), 'vl-dev-' + process.pid)); } catch (e) {}
}

const isSmoke = process.argv.includes('--smoke');
const isTest = ['--smoke', '--shots', '--uitest'].some((a) => process.argv.includes(a));
let isAdmin = false;
let elevateFailed = false;
let win = null;
let scalingWin = null;
let overlayWin = null;

app.setAppUserModelId('com.l.optimizer');

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
core.setDataDir(dataDir());
ex.fpsRestore();

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 1180, minHeight: 700,
    show: false, backgroundColor: '#050506', frame: false, roundedCorners: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'VL Optimizer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false,
    },
  });
  // Com o login configurado, quem nao tem sessao valida passa pela tela de entrada.
  // Sem as chaves do Supabase o app abre direto, para nao travar quem ja usa.
  (async () => {
    let logado = false;
    if (conta.configurado()) {
      try { const s = await conta.sessao(); logado = !!(s && s.valid); } catch (e) { }
    } else {
      logado = true;
    }
    const pagina = logado ? 'dashboard.html' : 'login.html';
    win.loadFile(path.join(__dirname, 'src', pagina), process.argv.includes('--shots') ? { query: { shot: '1' } } : undefined);
  })();
  win.once('ready-to-show', () => {
    if (isSmoke) return;
    win.show();
    if (process.argv.includes('--silent')) win.minimize();
  });

  if (isSmoke) {
    win.webContents.once('did-finish-load', async () => {
      setTimeout(async () => {
        try {
          await win.webContents.executeJavaScript(`
            (function(){
              try { localStorage.setItem('gdz-tour', 'v-smoke'); } catch(e) {}
              const b = document.querySelector('.tour-skip');
              if (b) b.click();
              document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask').forEach((e) => e.remove());
            })();`);
          await new Promise((r) => setTimeout(r, 1400));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
          console.log('SMOKE_OK');
        } catch (e) { console.error('SMOKE_ERR', e); }
        app.exit(0);
      }, 7000);
    });
  }

  if (process.argv.includes('--pcshot')) {
    win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.log('RENDER_ERR ' + message); });
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 700));
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(b=>b.click()); go('pcinfo'); })();`);
        await new Promise((r) => setTimeout(r, 700));
        try {
          const t = await win.webContents.executeJavaScript(`(async () => { try { const r = await ipcRenderer.invoke('pcinfo-get'); return { ok: !!r, success: r && r.success, hasInfo: !!(r && r.info), err: r && r.error }; } catch (e) { return { thrown: String(e) }; } })()`);
          console.log('PCTEST ' + JSON.stringify(t));
        } catch (e) { console.log('PCTEST_ERR ' + e.message); }
        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="${process.argv.includes('--pcsimple') ? 'simple' : 'advanced'}"]'); if (b) b.click(); })();`);
        await new Promise((r) => setTimeout(r, 15000));
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'shots', process.argv.includes('--pcsimple') ? 'pcinfo-simple.png' : 'pcinfo.png'), img.toPNG());
        console.log('PCSHOT_OK');
      } catch (e) { console.error('PCSHOT_ERR', e); }
      app.exit(0);
    });
  }

  if (process.argv.includes('--optishot')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 700));
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(b=>b.click()); go('opti'); })();`);
        await new Promise((r) => setTimeout(r, 1200));
        await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('[data-act="detect"]'); if (b) b.click(); })();`);
        await new Promise((r) => setTimeout(r, 5000));
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'shots', 'opti-block.png'), img.toPNG());
        console.log('OPTISHOT_OK');
      } catch (e) { console.error('OPTISHOT_ERR', e); }
      app.exit(0);
    });
  }

  if (process.argv.includes('--animcheck')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1600));
        const r = await win.webContents.executeJavaScript(`(function(){
          const gim = document.querySelector('.gy-gimbal');
          const rings = Array.prototype.slice.call(document.querySelectorAll('.gy-ring'));
          const img = document.querySelector('.gy-core img');
          return {
            gimbal: gim ? getComputedStyle(gim).animationName : null,
            rings: rings.map(function (x) { const c = getComputedStyle(x); return c.animationName + ' ' + c.animationDuration + ' ' + c.animationDirection; }),
            logo: img ? img.getAttribute('src') : null
          };
        })()`);
        console.log('ANIM ' + JSON.stringify(r));
      } catch (e) { console.log('ANIM_ERR ' + e.message); }
      app.exit(0);
    });
  }

  if (process.argv.includes('--animstrip')) {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 700));
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(function(b){b.click();}); document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask,.tour-bubble,.tour-highlight').forEach(function(e){e.remove();}); })();`);
        await new Promise((r) => setTimeout(r, 1500));
        const rect = await win.webContents.executeJavaScript(`(function(){ const r = document.querySelector('.gy').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
        fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
        for (let i = 0; i < 4; i++) {
          const img = await win.webContents.capturePage(rect);
          fs.writeFileSync(path.join(__dirname, 'shots', 'anim-' + i + '.png'), img.toPNG());
          await new Promise((r) => setTimeout(r, 750));
        }
        console.log('ANIMSTRIP_OK');
      } catch (e) { console.log('ANIMSTRIP_ERR ' + e.message); }
      app.exit(0);
    });
  }

  if (process.argv.includes('--uitest')) {
    win.webContents.once('did-finish-load', async () => {
      const out = [];
      try {
        await new Promise((r) => setTimeout(r, 2600));
        await win.webContents.executeJavaScript(`(function(){
          try { localStorage.setItem('gdz-tour','1'); } catch(e) {}
          document.querySelectorAll('.tour-skip').forEach((b)=>b.click());
          document.querySelectorAll('.tour-root,.tour-overlay').forEach((e)=>e.remove());
        })();`);
        await win.webContents.executeJavaScript("go('inputlag')");
        await new Promise((r) => setTimeout(r, 2200));
        const sel = '.tw-row[data-key="tweak:kbd-repeat"] .tw-switch';
        out.push('before: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + (document.querySelector('${sel}')||{}).getAttribute?.call(document.querySelector('${sel}'),'aria-checked')`));
        await win.webContents.executeJavaScript(`document.querySelector('${sel}').click()`);
        await new Promise((r) => setTimeout(r, 3200));
        out.push('after on: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + document.querySelector('${sel}').getAttribute('aria-checked')`));
        out.push('row on: ' + await win.webContents.executeJavaScript(`(document.querySelector('.tw-row[data-key="tweak:kbd-repeat"]')||{}).className`));
        await win.webContents.executeJavaScript(`document.querySelector('${sel}').click()`);
        await new Promise((r) => setTimeout(r, 3200));
        out.push('after off: ' + await win.webContents.executeJavaScript(`(document.querySelector('${sel}')||{}).className + ' | ' + document.querySelector('${sel}').getAttribute('aria-checked')`));
      } catch (e) { out.push('ERR ' + e.message); }
      fs.writeFileSync(path.join(__dirname, 'uitest.log'), out.join('\n'), 'utf8');
      console.log('UITEST_OK');
      app.exit(0);
    });
  }

  if (process.argv.includes('--ftest')) {
    // teste de campo: mede o jogo aberto, liga o overlay e roda o gargalo
    win.webContents.once('did-finish-load', async () => {
      const out = {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        await sleep(2500);
        await win.webContents.executeJavaScript(`(function(){ try{localStorage.setItem('gdz-tour','1');}catch(e){} document.querySelectorAll('.tour-skip').forEach(b=>b.click()); document.querySelectorAll('.tour-root,.tour-overlay').forEach(e=>e.remove()); })();`);
        const g = await core.ps(`$p = Get-Process -Name cod -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { Write-Output ($p.Id.ToString() + '|' + $p.ProcessName) }`);
        const [pidStr, pname] = g.out.split('|');
        out.pid = parseInt(pidStr, 10) || null;
        out.name = pname || null;
        if (!out.pid) throw new Error('jogo cod nao encontrado');
        out.target = await ex.fpsSetTarget(out.pid);
        await sleep(7000);
        const st = await ex.fpsStatus();
        out.live = st.live;
        out.processesWithFps = (st.processes || []).filter((p) => p.fps > 0).map((p) => p.name + ':' + p.fps);
        const ov = ex.fpsOverlaySet({ on: true, pos: 0, show: { frametime: true, low1: true, cpu: true, gpu: true, ram: true, name: true } });
        ex.setOverlayState({ on: true, pos: 0, show: ov.overlay.show });
        applyOverlay({ on: true, pos: 0, show: ov.overlay.show });
        await sleep(4500);
        const ow = BrowserWindow.getAllWindows().find((w) => w !== win);
        if (ow) {
          const img = await ow.webContents.capturePage();
          fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
          fs.writeFileSync(path.join(__dirname, 'shots', 'overlay-teste.png'), img.toPNG());
          out.overlayCaptured = true;
          out.overlayBounds = ow.getBounds();
        } else out.overlayCaptured = false;
        out.bottleneck = await ex.measureBottleneck({ seconds: 8, pid: out.pid });
        fs.writeFileSync(path.join(__dirname, 'ftest.json'), JSON.stringify(out, null, 1));
        console.log('FTEST_OK');
      } catch (e) {
        fs.writeFileSync(path.join(__dirname, 'ftest.json'), JSON.stringify({ error: String(e), out }, null, 1));
        console.log('FTEST_ERR ' + e.message);
      }
      app.exit(0);
    });
  }

  if (process.argv.includes('--shots')) {
    const logs = [];
    win.webContents.on('console-message', (e, level, message, line, src) => { logs.push(`[${level}] ${src}:${line} ${message}`); });
    win.webContents.once('did-finish-load', async () => {
      const dir = path.join(__dirname, 'shots');
      fs.mkdirSync(dir, { recursive: true });
      try {
        await win.webContents.executeJavaScript(`
          (function(){ try { localStorage.setItem('gdz-tour', 'v-shots'); } catch(e) {}
            const b = document.querySelector('.tour-skip'); if (b) b.click();
            document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask').forEach((e) => e.remove()); })();`);
        await new Promise((r) => setTimeout(r, 2600));
        const pages = ['dashboard', 'desempenho', 'inputlag', 'memoria', 'limpeza', 'programas', 'live', 'tweaks', 'inicializacao', 'jogos', 'opti', 'scaling', 'fps', 'gargalo', 'pcinfo', 'hardware', 'sobre'];
        for (const p of pages) {
          let active = '';
          try { await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`); } catch (e) { logs.push('go ERR ' + p + ' ' + e.message); }
          if (p === 'pcinfo') {
            try { await win.webContents.executeJavaScript(`(function(){ const b = document.querySelector('button[data-mode="advanced"]'); if (b) b.click(); })()`); } catch (e) {}
          }
          await new Promise((r) => setTimeout(r, p === 'limpeza' ? 15000 : p === 'pcinfo' ? 15000 : 1100));
          try { await win.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); } catch (e) {}
          await new Promise((r) => setTimeout(r, 350));
          try { active = await win.webContents.executeJavaScript("(document.querySelector('.page.active') || {}).id || ''"); } catch (e) {}
          logs.push('page ' + p + ' -> ' + active);
          try {
            await win.webContents.executeJavaScript(`(function(){ document.querySelectorAll('.tour-skip').forEach((b) => b.click()); document.querySelectorAll('.tour-root,.tour-card,.tour-overlay,.tour-mask,.tour-highlight,.tour-bubble').forEach((e) => e.remove()); })();`);
          } catch (e) {}
          try { win.webContents.invalidate(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 200));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(dir, p + '.png'), img.toPNG());
        }
        // janela do VL Scaling
        try {
          await win.webContents.executeJavaScript("openScalingWindow()");
          await new Promise((r) => setTimeout(r, 2200));
          const sw = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed());
          if (sw) {
            const img = await sw.webContents.capturePage();
            fs.writeFileSync(path.join(dir, 'scaling-window.png'), img.toPNG());
            logs.push('scaling window capturada');
          }
        } catch (e) { logs.push('scaling ERR ' + e.message); }
        fs.writeFileSync(path.join(dir, 'console.log'), logs.join('\n'), 'utf8');
        console.log('SHOTS_OK', logs.length);
      } catch (e) { console.error('SHOTS_ERR', e); }
      app.exit(0);
    });
  }
  win.on('closed', () => { win = null; });
}

// ── Overlay de FPS ──
function ensureOverlay() {
  if (overlayWin) return overlayWin;
  overlayWin = new BrowserWindow({
    width: 300, height: 150, x: 20, y: 20, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  // A pagina NAO e carregada aqui de proposito.
  //
  // Criar a janela via BrowserWindow ja cria um renderer, e um renderer carregado desenha mesmo
  // com a janela oculta: medido 166 quadros por segundo numa janela que ninguem ve. Era o segundo
  // renderer do app. Agora a pagina e carregada em applyOverlay(), na primeira vez que o usuario
  // liga o overlay; enquanto isso nao existe renderer nenhum para gastar CPU.
  overlayWin.hide();
  overlayWin.on('closed', () => { overlayWin = null; });
  return overlayWin;
}
function applyOverlay(payload) {
  const ov = ex.fpsOverlayPayload();
  if (!payload || !payload.on) { if (overlayWin) overlayWin.hide(); return; }
  const w = ensureOverlay();
  // Carrega a pagina na primeira exibicao. As seguintes ja estao carregadas.
  if (!w.webContents.getURL()) {
    w.loadFile(path.join(__dirname, 'src', 'fps-overlay.html'));
  }
  const pos = payload.pos || 0;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const bw = 300, bh = 150, pad = 16;
  const x = pos === 1 || pos === 3 ? width - bw - pad : pad;
  const y = pos === 2 || pos === 3 ? height - bh - pad : pad;
  w.setBounds({ x, y, width: bw, height: bh });
  w.showInactive();
  w.webContents.send('overlay-update', { ...ov, ...payload });
}

// tick do medidor
let tickTimer = null;
function startTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(async () => {
    try {
      const st = ex.getOverlayState();
      if (!st.on) return; // sem overlay, nada de PowerShell de segundo em segundo
      await ex.fpsTick();
      const ov = ex.fpsOverlayPayload();
      if (overlayWin && !overlayWin.isDestroyed() && ov.live) {
        overlayWin.webContents.send('overlay-update', { ...ov, on: true, pos: st.pos, show: st.show });
      }
    } catch (e) {}
  }, 1500);
}

// ── IPC ──
const H = (name, fn) => ipcMain.handle(name, (e, arg) => fn(arg));

H('get-user', () => conta.usuario());
H('check-session', () => conta.sessao());
H('login', (a) => conta.entrar(a && a.email, a && a.password));
H('register', (a) => conta.registrar(a && a.name, a && a.email, a && a.password));
H('logout', () => conta.sair());
H('ir-para-login', () => { conta.sair(); if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'src', 'login.html')); return { success: true }; });
H('recuperar-senha', (a) => conta.recuperar(a && a.email));
H('conta-status', () => ({ configurado: conta.configurado() }));
// Plano do usuario logado: 'premium' libera os itens trancados; 'free' mantem o cadeado.
// Sem as chaves do Supabase, devolve premium para nao bloquear quem ja usa o app.
H('conta-plano', async () => {
  if (!conta.configurado()) return { plano: 'premium', ilimitado: true };
  try {
    const s = await conta.sessao();
    if (!s || !s.valid) return { plano: 'free' };
    return { plano: s.user.plan, ate: s.user.premiumUntil, nome: s.user.name, email: s.user.email };
  } catch (e) { return { plano: 'free', erro: e.message }; }
});
H('update-status', () => {
  // Estado do auto-update (GitHub Releases). Sem rede ou sem release publicado, devolve o estado
  // atual com error preenchido: a tela mostra o aviso em vez de quebrar.
  try { return { success: true, ...updater.status() }; }
  catch (e) { return { success: false, error: e.message }; }
});
H('update-check', async () => {
  try { return { success: true, ...(await updater.check()) }; }
  catch (e) { return { success: false, error: e.message }; }
});
H('update-install', () => {
  // Só instala o que já foi baixado; nunca reinicia o app por conta própria.
  try { return updater.install(); }
  catch (e) { return { success: false, error: e.message }; }
});
H('update-open-page', () => {
  try { updater.openReleasePage(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});
H('claim-key', () => ex.claimKey());
H('telemetry-consent', () => ex.telemetryConsent());
H('telemetry-consent-set', () => ({ success: true }));
H('offers', () => ex.offers());
H('plan-event', () => ({ success: true }));
H('get-hardware', () => ex.getHardware());
H('get-stats', () => ex.getStats());
H('get-mem-stats', () => ex.getMemStats());
H('get-processes', () => ex.getProcesses());
H('kill-process', ({ pid }) => ex.killProcess(pid));
H('autostart-get', () => ex.autostartGet());
H('autostart-set', ({ on }) => ex.autostartSet(on));

H('tweaks-status', () => core.tweaksStatus());
H('actions-status', () => core.actionsStatus());
H('get-caps', () => core.getCaps());
H('tweak-set', ({ id, on }) => core.applyTweak(id, on));
H('run-action', ({ action }) => {
  if (action && action.startsWith('GPU Dedicada: ')) return ex.gpuDedicated(action.slice(14));
  return core.ONCES[action] ? core.runOnce(action) : core.runAction(action);
});
H('revert-action', ({ action }) => {
  if (action && action.startsWith('GPU Dedicada: ')) return ex.gpuDedicated(action.slice(14), false);
  return core.revertAction(action);
});
H('tweak-tool', ({ id }) => core.runTool(id));
H('tweak-dns', ({ provider }) => core.setDns(provider));
H('run-check', ({ name }) => core.runCheck(name));
H('restore-all', () => ex.restoreAll());
H('get-backups', () => ex.getBackups());

H('startup-list', () => ex.startupList());
H('startup-set', (a) => ex.startupSet(a));
// Cache de 30 s: cada chamada de ex.recommendations abre dois processos PowerShell (~110 ms
// cada). A tela inicial pede varias vezes seguidas e o processo principal ficava a 30% de um
// nucleo nos primeiros 20 s. O resultado muda pouco nesse intervalo, entao guardar evita trabalho
// repetido sem esconder mudanca real.
let recCache = { at: 0, valor: null };
H('get-recommendations', async () => {
  const agora = Date.now();
  if (recCache.valor && agora - recCache.at < 30000) return recCache.valor;
  try {
    const v = await ex.recommendations();
    recCache = { at: agora, valor: v };
    return v;
  } catch (e) {
    return recCache.valor || { startupOn: null, tempBytes: null };
  }
});

H('clean-scan', () => ex.cleanScan());
H('clean-run', ({ ids }) => ex.cleanRun(ids || []));
H('disk-drives', () => ex.diskDrives());
H('disk-scan', ({ drive }) => ex.diskStart(drive));
H('disk-scan-status', () => ex.diskStatus());
H('disk-scan-cancel', () => ex.diskCancel());
H('disk-open', ({ target }) => ex.diskOpen(target));

H('apps-list', () => ex.appsList());
H('apps-extra', () => ex.appsExtra());
H('apps-uninstall', (a) => ex.appsUninstall(a));
H('apps-exists', (a) => ex.appsExists(a.key));
H('apps-leftovers', (a) => ex.appsLeftovers(a));
H('apps-remove-leftovers', (a) => ex.appsRemoveLeftovers(a));

H('games-scan', async () => { const r = await ex.gamesScan(); const a = feat.autoState(); return { ...r, autoMode: a.on, autoGame: a.game }; });
H('games-status', async () => { const r = await ex.gamesStatus(); const a = feat.autoState(); return { ...r, autoMode: a.on, autoGame: a.game }; });
H('set-auto-mode', ({ on }) => feat.autoSet(on));
H('game-clean', (a) => ex.gameClean(a));
H('shader-clean', () => ex.shaderClean());
H('fivem-gfx-status', () => ex.fivemGfxStatus());
H('fivem-gfx-apply', (a) => ex.fivemGfxApply(a));
H('fivem-gfx-restore', () => ex.fivemGfxRestore());
H('open-gpu-panel', ({ vendor }) => {
  const url = vendor === 'nvidia' ? 'https://www.nvidia.com/pt-br/geforce/geforce-experience/' : 'https://www.amd.com/pt/support';
  shell.openExternal(url);
  return { success: true };
});

H('fps-status', () => ex.fpsStatus());
H('fps-set-target', (a) => ex.fpsSetTarget(a.pid));
H('fps-record', (a) => ex.fpsRecord(a));
H('fps-clear', (a) => ex.fpsClear(a.slot));
H('fps-overlay-set', (patch) => {
  const r = ex.fpsOverlaySet(patch);
  ex.setOverlayState({ on: r.overlay.on, pos: r.overlay.pos, show: r.overlay.show });
  if (r.overlay.on) applyOverlay({ on: true, pos: r.overlay.pos, show: r.overlay.show });
  else if (overlayWin) overlayWin.hide();
  return r;
});
H('fps-base-mark', () => ex.fpsBaseMark());
H('fps-base-clear', () => ex.fpsBaseClear());
H('measure-bottleneck', (a) => ex.measureBottleneck(a));
H('bn-find-game', () => ex.bnFindGame());
H('bn-notify', () => ({ success: true }));

H('ram-clean', () => feat.ramClean());
H('ram-status', () => ({ success: true, ...feat.ramState() }));
H('ram-auto-set', ({ on }) => feat.ramAutoSet(on));
H('admin-status', () => ({ admin: isAdmin, failed: elevateFailed }));
H('elevate-now', async () => {
  const marker = path.join(app.getPath('userData'), 'elevated.lock');
  try { fs.unlinkSync(marker); } catch (e) {}
  const ok = await feat.elevate(app.isPackaged ? null : app.getAppPath());
  if (ok) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (fs.existsSync(marker)) { app.exit(0); return { success: true }; }
    }
    return { success: false, error: 'A janela elevada não abriu. Feche o app e abra como administrador.' };
  }
  return { success: false, error: 'Elevação cancelada.' };
});

H('pcinfo-get', (e, opts) => ex.pcinfoGet(opts));
H('pcinfo-live', () => ex.pcinfoLive());

H('opti-status', () => ex.optiStatus());
H('opti-download', () => ex.optiDownload());
H('opti-browse', () => ex.optiBrowse());
H('opti-detect', () => ex.optiDetect());
H('opti-analyze', (a) => ex.optiAnalyze(a));
H('opti-install', (a) => ex.optiInstall(a));
H('opti-uninstall', (a) => ex.optiUninstall(a));
H('opti-config', (a) => ex.optiConfig(a));
H('opti-open-folder', (a) => ex.optiOpenFolder(a));

H('ls-browse-exe', () => ex.lsBrowse());
H('ls-find-exe', () => ex.lsFind());
H('ls-config', (a) => ex.lsConfig(a));
H('ls-launch', (cfg) => ex.lsLaunch(cfg));
H('ls-status', () => ex.lsStatus());
H('ls-stop', () => ex.lsStop());
H('gdz-scaling-get-res', () => ex.scalingGetRes());
H('gdz-scaling-apply', (a) => ex.scalingApply(a));
H('gdz-scaling-revert', () => ex.scalingRevert());
H('gdz-scaling-caps', () => ex.scalingGetCapabilities());
H('gdz-scaling-status', () => ex.scalingStatus());
H('gdz-scaling-artifacts', () => ex.scalingArtifacts());

ipcMain.on('minimize-window', () => win && win.minimize());
ipcMain.on('maximize-window', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
ipcMain.on('close-window', () => win && win.close());
ipcMain.on('logout', () => win && win.close());
ipcMain.on('open-scaling-window', () => createScaling());

function createScaling() {
  if (scalingWin) { scalingWin.focus(); return; }
  scalingWin = new BrowserWindow({
    width: 1080, height: 760, minWidth: 900, minHeight: 620, frame: false, show: false,
    backgroundColor: '#050506', icon: path.join(__dirname, 'assets', 'icon.png'), title: 'VL Scaling',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  scalingWin.loadFile(path.join(__dirname, 'src', 'gdz-scaling.html'));
  scalingWin.once('ready-to-show', () => scalingWin.show());
  scalingWin.on('closed', () => { scalingWin = null; });
}

ipcMain.on('gs-minimize', () => scalingWin && scalingWin.minimize());
ipcMain.on('gs-maximize', () => { if (scalingWin) scalingWin.isMaximized() ? scalingWin.unmaximize() : scalingWin.maximize(); });
ipcMain.on('gs-close', () => scalingWin && scalingWin.close());

app.whenReady().then(async () => {
  if (process.argv.includes('--siteshot')) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = process.env.VL_SITE_OUT || path.join(__dirname, 'site', 'preview');
    fs.mkdirSync(out, { recursive: true });
    const sw = new BrowserWindow({ width: 1440, height: 950, show: true, backgroundColor: '#07030a', autoHideMenuBar: true });
    await sw.loadFile(path.join(__dirname, 'site', 'index.html'));
    await sleep(2600);
    await sw.webContents.executeJavaScript(`window.scrollTo(0,0); (function(){ document.querySelectorAll('.reveal').forEach(function(e){e.classList.add('in');}); })();`);
    await sleep(900);
    const spots = [['01-hero', 0], ['02-recursos', 980], ['03-prints', 2050], ['04-precos', 3300], ['05-compromisso', 4150], ['06-resultados', 4800], ['07-depoimentos', 5400], ['08-suporte', 6000], ['09-faq', 6700]];
    for (const [name, y] of spots) {
      await sw.webContents.executeJavaScript(`window.scrollTo({top:${y},behavior:'instant'})`);
      await sleep(700);
      const img = await sw.webContents.capturePage();
      fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    }
    sw.setContentSize(430, 900);
    await sleep(700);
    await sw.webContents.executeJavaScript('window.scrollTo({top:0,behavior:"instant"})');
    await sleep(600);
    fs.writeFileSync(path.join(out, '06-mobile.png'), (await sw.webContents.capturePage()).toPNG());
    console.log('SITE_SHOTS_OK');
    app.exit(0);
    return;
  }

  // Administrador: sem elevação, serviços/DISM/energia falham. Tenta uma vez e, se o UAC for
  // cancelado, segue em modo limitado com aviso na tela.
  isAdmin = await feat.isAdmin();
  if (isAdmin && process.argv.includes('--elevated')) {
    // instância elevada: deixa o marcador para a original saber que subiu
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'elevated.lock'), String(Date.now())); } catch (e) {}
  }
  // A elevação é sob demanda: o app abre sempre; a faixa no topo oferece "Reabrir como admin".
  // (auto-elevação no start se mostrou frágil: se o UAC é cancelado a janela não abria)
  createWindow();
  startTicker();
  try {
    const st = await ex.fpsStatus();
    ex.setOverlayState({ on: st.overlay.on, pos: st.overlay.pos, show: st.overlay.show });
    if (st.overlay.on) applyOverlay({ on: true, pos: st.overlay.pos, show: st.overlay.show });
  } catch (e) {}
  // atalho global: marca a base de FPS dentro do jogo
  try {
    globalShortcut.register('Control+Alt+B', async () => {
      const r = await ex.fpsBaseMark();
      if (win && !win.isDestroyed()) win.webContents.send('fps-hotkey', r);
    });
  } catch (e) {}
  feat.autoStart();
  feat.ramStart();
  // Auto-update pelo GitHub Releases: consulta em segundo plano, baixa sozinho e deixa a
  // instalação para o usuário. Falha aqui nunca impede o app de abrir.
  try { updater.start(); } catch (e) {}
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { } try { updater.stop(); } catch (e) { } });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', (e) => { try { fs.appendFileSync(path.join(os.tmpdir(), 'lopt-error.log'), String(e && e.stack || e) + '\n'); } catch (_) {} });
