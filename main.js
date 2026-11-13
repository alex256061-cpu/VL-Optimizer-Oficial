// main.js — VL Optimizer (Electron)
const { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, globalShortcut, Notification, dialog } = require('electron');

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
const elev = require('./elevacao');
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
// Ligada enquanto a janela é recriada após um crash: no 'closed' desse caso não se sai do app.
let recriandoJanela = false;
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
      try { const s = await conta.sessao(); logado = !!(s && s.valid); if (logado) setTimeout(() => conta.enviarHardware().catch(() => {}), 3000); } catch (e) { }
    } else {
      logado = true;
    }
    const pagina = logado ? 'dashboard.html' : 'login.html';
    win.loadFile(path.join(__dirname, 'src', pagina), process.argv.includes('--shots') ? { query: { shot: '1' } } : undefined);
  })();
  // Mostra a janela. O ready-to-show é o caminho normal; o prazo de 3 s é a rede de
  // segurança para quando ele não chega (renderer pesado ou script travado) — sem ela
  // o app fica aberto nos processos e o usuario ve so a area de trabalho.
  let jaMostrou = false;
  const mostrar = (motivo) => {
    if (jaMostrou || isSmoke) return;
    jaMostrou = true;
    try {
      if (!win || win.isDestroyed()) return;
      if (process.argv.includes('--silent')) {
        // Iniciado pelo Windows (autostart): aparece em segundo plano, sem tomar o foco.
        // Antes chamava win.minimize(), o que deixava a janela em -32000,-32000: os
        // processos rodavam, só o overlay aparecia, e quem clicava no atalho depois não
        // achava a tela. Depois que o app já está aberto, o lock de instância única traz
        // a janela para frente.
        win.showInactive();
        return;
      }
      win.show();
      win.focus();
    } catch (e) { }
  };

  win.once('ready-to-show', () => mostrar('ready-to-show'));
  setTimeout(() => mostrar('prazo de seguranca'), 3000);

  // Depois de aparecer, o aviso serve para liberar o renderer que ficou esperando.
  win.webContents.on('did-finish-load', () => setTimeout(() => mostrar('did-finish-load'), 400));

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
  // Fechar pelo X / Alt+F4 / botão de fechar = sair do app.
  //
  // O overlay do FPS é outra BrowserWindow: sem isto, fechar a janela principal deixava o
  // overlay vivo, o que impedia 'window-all-closed' de disparar e mantinha o processo e o
  // lock de instância única presos por 20 s.
  //
  // Só age quando NÃO estiver numa recriação: se o renderer caiu e o app está se
  // recuperando, o 'closed' vem de um fechamento programático, não do usuário.
  win.on('closed', () => {
    win = null;
    if (app.isQuitting) return;              // já está saindo: nada a fazer
    if (recriandoJanela) return;             // veio de uma recriação: não sair
    app.isQuitting = true;
    try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy(); } catch (e) { }
    try { if (scalingWin && !scalingWin.isDestroyed()) scalingWin.destroy(); } catch (e) { }
    app.quit();
  });
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
// ── Guarda de sessão (mesmo papel do requireAuth do GDZ) ───────────────────
//
// A tela de login impede o uso normal sem conta, mas os canais IPC continuariam acessíveis
// para quem chamasse o IPC direto. Este guarda fecha esse caminho.
//
// Canais sempre liberados: os da própria conta, os de janela e os de atualização.
const CANAIS_LIVRES = new Set([
  'login', 'register', 'check-session', 'logout', 'recuperar-senha',
  'get-user', 'conta-status', 'conta-plano', 'ir-para-login',
  'minimize-window', 'maximize-window', 'close-window',
  'update-status', 'update-install', 'update-check', 'update-open-page',
  'open-site', 'open-scaling-window',
  'gs-minimize', 'gs-maximize', 'gs-close',
]);

// Cache curto: não consulta o banco a cada clique, mas percebe o logout em até 15 segundos.
let _sessaoCache = { valor: null, quando: 0 };

async function sessaoAtiva() {
  // Sem as chaves do Supabase, o app não tem login e tudo é liberado (não travar quem já usa).
  if (!conta.configurado()) return true;
  const agora = Date.now();
  if (_sessaoCache.valor !== null && agora - _sessaoCache.quando < 15000) return _sessaoCache.valor;
  let ok = false;
  try {
    const s = await conta.sessao();
    ok = !!(s && s.valid);
  } catch (e) { ok = false; }
  _sessaoCache = { valor: ok, quando: agora };
  return ok;
}

function esquecerSessao() { _sessaoCache = { valor: null, quando: 0 }; }

const H = (name, fn) => ipcMain.handle(name, async (e, arg) => {
  if (!CANAIS_LIVRES.has(name) && !(await sessaoAtiva())) {
    return { success: false, error: 'Faça login para usar esta função.', code: 'no_session' };
  }
  return fn(arg);
});

H('get-user', () => conta.usuario());
H('check-session', () => conta.sessao());
H('login', async (a) => { const r = await conta.entrar(a && a.email, a && a.password); esquecerSessao(); if (r && r.success) setTimeout(() => conta.enviarHardware().catch(() => {}), 2500); return r; });
H('register', (a) => conta.registrar(a && a.name, a && a.email, a && a.password));
H('logout', () => { const r = conta.sair(); esquecerSessao(); return r; });
H('ir-para-login', () => { conta.sair(); esquecerSessao(); if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'src', 'login.html')); return { success: true }; });
H('recuperar-senha', (a) => conta.recuperar(a && a.email));
H('conta-status', () => ({ configurado: conta.configurado() }));
// Abre o site no navegador do sistema.
// O src/plano.js chama este canal no botão "Ver planos" e em cada botão de plano do
// modal. Ele estava em CANAIS_LIVRES mas NÃO tinha handler: o invoke rejeitava e clicar
// em "Ver planos" não fazia nada — quem queria comprar não conseguia.
const SITE = 'https://vl-optimizer.pages.dev';
H('open-site', (a) => {
  const pedido = (a && a.page) || 'planos';
  const plan = a && a.plan ? String(a.plan) : '';
  const cupom = a && a.coupon ? String(a.coupon) : '';

  // Página do site correspondente ao pedido
  const paginas = {
    planos: SITE + '/#precos',
    precos: SITE + '/#precos',
    conta: SITE + '/conta',
    resgatar: SITE + '/resgatar',
    entrar: SITE + '/entrar',
    criar: SITE + '/criar-conta',
    bandeja: SITE + '/#precos',
  };
  let url = paginas[pedido] || paginas.planos;

  // Plano e cupom vão na URL para o checkout já abrir escolhido
  const q = [];
  if (plan) q.push('plano=' + encodeURIComponent(plan));
  if (cupom) q.push('cupom=' + encodeURIComponent(cupom));
  if (q.length) url += (url.includes('?') ? '&' : '?') + q.join('&');

  try {
    shell.openExternal(url);
    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Plano do usuario logado: plan 'free'/'pro' e a lista de features por pagina
// ('*' libera tudo).
//
// REGRA: sem sessao valida NAO e premium. Antes, banco sem chaves, usuario deslogado e
// falha de rede devolviam plan 'pro' com ['*'] — ou seja, quem se deslogava ganhava o
// plano completo. Agora esses tres casos caem em gratis e a tela de login abre.
const PLANO_GRATIS = { plan: 'free', features: ['painel'], lifetime: false, licenseExpiresAt: null, expirada: false };

H('conta-plano', async () => {
  if (!conta.configurado()) return { ...PLANO_GRATIS, semLogin: true, semBanco: true };
  try {
    const s = await conta.sessao();
    if (!s || !s.valid) return { ...PLANO_GRATIS, semLogin: true };
    // plano expirado tambem volta para gratis, mantendo o motivo para a tela explicar
    if (s.user.expirada) return { ...PLANO_GRATIS, semLogin: false, expirada: true, email: s.user.email, nome: s.user.name };

    // Plano ligado a outro PC (formatou, trocou de maquina, ou copiou a sessao).
    // O banco ja recusa; antes o cliente ignorava essa resposta e liberava tudo.
    if (s.user.pcAprovado === false) {
      return {
        ...PLANO_GRATIS,
        semLogin: false,
        outraMaquina: true,
        pcBound: !!s.user.pcBound,
        reason: s.user.reason || 'other_device',
        email: s.user.email,
        nome: s.user.name,
      };
    }
    return {
      plan: s.user.plan,
      features: s.user.features,
      lifetime: s.user.lifetime,
      licenseExpiresAt: s.user.licenseExpiresAt,
      expirada: s.user.expirada,
      nome: s.user.name,
      email: s.user.email,
    };
  } catch (e) {
    // erro de rede: nao da para confirmar o plano, entao trata como gratis.
    // A tela mostra o aviso em vez de liberar tudo.
    return { ...PLANO_GRATIS, semLogin: true, erro: e.message };
  }
});
H('update-info', () => {
  // Tudo o que a janela de atualização precisa, num chamado só:
  //   versão instalada, versão disponível, o que mudou e o estado do download.
  try {
    const st = updater.status();
    let notas = null;
    try { notas = require('./notas-versao').notasDe(st.version); } catch (e) { notas = null; }
    // se a versão nova não tem texto escrito à mão, usa o corpo do release
    const doRelease = st.notes ? String(st.notes) : null;
    return {
      success: true,
      atual: st.currentVersion,
      disponivel: st.version,
      temNova: !!st.available,
      baixando: !!st.downloading,
      baixado: !!st.downloaded,
      percentual: st.percent || 0,
      erro: st.error || null,
      notas,
      doRelease,
      repo: st.repo,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
H('claim-key', (a) => ex.claimKey(a && a.codigo));
H('telemetry-consent', () => ex.telemetryConsent());
H('telemetry-consent-set', () => ({ success: true }));
H('offers', () => ex.offers());
H('plan-event', () => ({ success: true }));
H('get-hardware', () => ex.getHardware());
H('get-stats', () => ex.getStats());
H('get-mem-stats', () => ex.getMemStats());
H('get-processes', () => ex.getProcesses());
H('kill-process', ({ pid }) => ex.killProcess(pid));
H('autostart-get', async () => {
  // Com a tarefa agendada, quem inicia no logon é ela — e já elevada. A chave Run do
  // usuário (abaixo) fica como reserva para quando a tarefa não existe.
  try {
    const viaTarefa = await elev.autostartAtivo();
    if (viaTarefa) return { success: true, on: true, supported: true, via: 'tarefa' };
  } catch (e) {}
  const r = await ex.autostartGet();
  return { ...r, supported: true, via: 'run-key' };
});
H('autostart-set', async ({ on }) => {
  // Com tarefa registrada: liga/desliga só o gatilho de logon dela (sem UAC, e o
  // processo já sobe elevado). Sem tarefa: usa a chave Run do usuário, como antes.
  const st = await elev.status().catch(() => ({ exists: false }));
  if (st && st.exists) {
    const r = await elev.autostartSet(!!on);
    if (r.success) return { success: true, on: !!on, via: 'tarefa' };
  }
  try {
    // Ligar o autostart não pode deixar a tarefa desligada E a chave Run elevando
    // em dobro: se há tarefa, o gatilho dela já foi tratado acima.
    const r = await ex.autostartSet(!!on);
    return { ...r, via: 'run-key' };
  } catch (e) {
    return { success: false, on: false, error: e.message };
  }
});

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
// O argumento traz o `ignore` do "Não é esse". Antes ele era descartado e o laço
// voltava sempre ao mesmo processo.
H('bn-find-game', (a) => ex.bnFindGame(a || {}));
H('bn-notify', (a) => {
  // Avisa pelo sistema quando o gargalo for detectado. Antes era um stub que dizia
  // "success" e nao mostrava nada.
  try {
    if (!Notification.isSupported()) return { success: false, error: 'Este Windows nao permite notificacao.' };
    const texto = (a && a.texto) || 'O gargalo do seu PC foi medido. Abra o VL para ver.';
    const titulo = (a && a.titulo) || 'VL Optimizer';
    const notif = new Notification({ title: titulo, body: String(texto).slice(0, 200), silent: false });
    notif.on('click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
    notif.show();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

H('ram-clean', () => feat.ramClean());
H('ram-status', () => ({ success: true, ...feat.ramState() }));
H('ram-auto-set', ({ on }) => feat.ramAutoSet(on));
H('elevacao-diagnostico', async () => {
  // Diagnóstico da elevação: o que o app vê e o que a tarefa diz.
  try {
    const st = await elev.status();
    return {
      execPath: process.execPath,
      isAdmin: await elev.isAdmin(),
      veioDaTarefa: elev.veioDaTarefa(),
      argv: process.argv.slice(1),
      tarefa: st,
      pronta: await elev.pronta(),
    };
  } catch (e) { return { erro: e.message }; }
});
// Dispara a tarefa "VLOptimizer" depois de 2 s, SEM janela nenhuma.
//
// Por que VBS e não cmd/powershell (tudo medido contando ConsoleWindowClass visível):
//   - cmd.exe, mesmo com detached+windowsHide, abre um console e ele PISCA na tela;
//   - powershell com -WindowStyle Hidden não abre console, mas o disparo não chega;
//   - powershell sem detached morre quando o app sai.
//   - wscript.exe com um .vbs dorme, dispara e sobrevive — sem console nenhum.
//
// O atraso de 2 s é obrigatório: o Agendador tem MultipleInstances=IgnoreNew, e com
// esta instância viva ele descarta a execução (devolvendo "ÊXITO" mesmo assim).
// Pede ao Agendador que abra a versão elevada, sem janela de console.
//
// Histórico (tudo medido nesta máquina):
//   cmd.exe /c + detached + windowsHide -> janela de console aparecia (título
//     "schtasks /run /tn VLOptimizer"), 5 de 5 vezes;
//   wscript + .vbs                      -> sem janela, mas depende do Windows Script
//     Host ligado: com ele desligado por política, o app sobe, não dispara e FECHA;
//   schtasks.exe + detached + windowsHide -> sem janela em 10 de 10, 10 de 10
//     elevadas, sem arquivo em disco, e não depende de WSH.
//
// Por isso o disparo é schtasks.exe direto. O atraso do VBS existia porque o Agendador
// descarta a execução com MultipleInstances=IgnoreNew enquanto o app está vivo; aqui o
// agendamento é feito pelo próprio Windows a partir da saída do processo.
//
// Devolve true só quando o processo foi realmente criado.
function reabrirElevadoPelaTarefa() {
  try {
    const { spawn } = require('child_process');
    const filho = spawn('schtasks.exe', ['/run', '/tn', 'VLOptimizer'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    let erro = false;
    filho.on('error', () => { erro = true; });
    filho.unref();
    // pid indefinido = o CreateProcess falhou; nunca mentir dizendo que deu certo.
    return !erro && !!filho.pid;
  } catch (e) { return false; }
}
H('admin-status', async () => {
  // "podeElevar": existe tarefa agendada com RunLevel Highest apontando para este exe.
  // Com ela, reabrir como admin não pede UAC. Sem ela, o botão pede UAC uma vez
  // (e aproveita para criar a tarefa, para nunca mais pedir).
  let podeElevar = false;
  try { podeElevar = await elev.pronta(); } catch (e) {}
  return { admin: isAdmin, failed: elevateFailed, podeElevar, viaTarefa: elev.veioDaTarefa() };
});
H('elevate-now', async () => {
  // "Reabrir como admin" pelo caminho que FUNCIONA.
  //
  // Medido: a tarefa "VLOptimizer" abre o app ELEVADO sem UAC, mas o Agendador tem
  // MultipleInstances=IgnoreNew — com uma instância viva ele DESCARTA a execução e ainda
  // assim o schtasks devolve "ÊXITO". Fechar antes de disparar também não serve: quem
  // teria que disparar é o processo que acabou de morrer.
  //
  // Solução: um processo externo curto espera o app sair e só então dispara a tarefa.
  // Nada disso pede UAC — a elevação vem da própria tarefa.
  try {
    const st = await elev.status();
    if (!(st.exists && st.ready)) {
      const reg = await elev.registrarComUAC();
      if (!reg || !reg.success) return { success: false, error: (reg && reg.error) || 'Não foi possível criar a tarefa de administrador.' };
    }

    // Dispara a tarefa e só fecha esta instância se o disparo realmente aconteceu.
    //
    // Antes o retorno era success:true incondicional: se o schtasks não pudesse ser
    // criado, o app fechava e nada abria — o usuário ficava sem janela nenhuma.
    const disparou = reabrirElevadoPelaTarefa();
    if (!disparou) {
      return { success: false, error: 'Não consegui abrir a versão de administrador. Abra o VL pelo atalho.' };
    }

    app.isQuitting = true;
    setTimeout(() => { try { app.quit(); } catch (e) { } }, 300);
    return { success: true, viaTarefa: true, uac: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
ipcMain.on('close-window', () => {
  // log para diagnóstico: prova que o clique chegou e o que aconteceu
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'VLOptimizer');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
    fs.appendFileSync(path.join(dir, 'crash.log'), '[' + new Date().toISOString() + '] close-window: pedido de fechar (elevado=' + isAdmin + ')' + String.fromCharCode(10));
  } catch (e) { }
  if (win && !win.isDestroyed()) win.close();
  else { app.isQuitting = true; app.quit(); }
});
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

// ── Instância única ───────────────────────────────────────────────────────
// Sem isto, abrir o app duas vezes (atalho, atualizador, clique repetido) sobe duas
// cópias brigando pelo mesmo overlay do FPS, pelo PresentMon e pela pasta de dados.
// O resultado era um crash em cascata: Utility → renderer → janela principal → GPU.
const obteveLock = app.requestSingleInstanceLock();
if (!obteveLock) {
  // Já existe uma instância: esta apenas sai. O foco vai para a que já está aberta.
  app.quit();
} else {
  app.on('second-instance', () => {
    // Segunda abertura: em vez de subir outra cópia, reaproveita esta.
    //
    // Se a janela principal morreu (o overlay segura o processo vivo), antes eu não fazia
    // nada e a nova abertura também saía — o app ficava impossível de abrir. Agora recria.
    try {
      if (!win || win.isDestroyed()) {
        createWindow();
        return;
      }
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch (e) {
      logCrash('falha ao tratar segunda abertura: ' + e.message);
    }
  });
  iniciar();
}

function iniciar() {
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

  // Administrador: sem elevação, serviços/DISM/energia falham.
  //
  // A partir da 1.4.2 o app abre elevado SEM UAC: o instalador registra a tarefa
  // agendada "VLOptimizer" (RunLevel HighestAvailable) e toda abertura passa por ela
  // (`schtasks /run`). Quando o Windows dispara a tarefa, o processo chega com
  // --elevated-from-task. Ver elevacao.js.
  isAdmin = await elev.isAdmin();
  const veioDaTarefa = elev.veioDaTarefa();
  if (isAdmin && (veioDaTarefa || process.argv.includes('--elevated'))) {
    // instância elevada: deixa o marcador para a original saber que subiu
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'elevated.lock'), String(Date.now())); } catch (e) {}
  }

  // ── Auto-elevação no boot (igual ao GDZ) ────────────────────────────────
  //
  // A tarefa "VLOptimizer" abre o app ELEVADO sem UAC. O Agendador tem
  // MultipleInstances=IgnoreNew: com uma instância viva ele descarta a execução e mesmo
  // assim o schtasks devolve "ÊXITO". Por isso o disparo é feito por um processo externo
  // curto, ~2 s depois que esta instância sair.
  //
  // Guardas:
  //   - a instância elevada chega com --elevated-from-task e não entra aqui (sem laço)
  //   - auto-elevou.lock impede nova tentativa por 15 s
  //   - --sem-auto-elevar desliga (usado em testes)
  //   - sem tarefa registrada, nada acontece: abre normal, em modo limitado
  if (!isAdmin && !veioDaTarefa && !process.argv.includes('--elevated') && !isSmoke) {
    // AUTO-RECUPERAÇÃO da tarefa de administrador.
    //
    // Se a tarefa foi apagada (antivírus, Gerenciador de Tarefas, limpeza de disco), a
    // abertura elevada nunca mais acontece e o app fica para sempre em modo limitado.
    // Aqui o próprio boot tenta recriá-la, uma vez por sessão, reutilizando o caminho de
    // UAC que o botão "Reabrir como admin" já usa.
    try {
      const st = await elev.status();
      if (!st.exists) {
        const marca = path.join(app.getPath('userData'), 'tarefa-recuperada.lock');
        let tentouHa = Infinity;
        try { tentouHa = Date.now() - (Number(fs.readFileSync(marca, 'utf8')) || 0); } catch (e) { }
        if (tentouHa > 24 * 60 * 60 * 1000) {
          try { fs.writeFileSync(marca, String(Date.now())); } catch (e) { }
          // registra (pede UAC uma vez) e deixa o resto do boot normal
          await elev.registrarComUAC().catch(() => { });
        }
      }
    } catch (e) { }

    try {
      if (await elev.pronta()) {
        const marcador = path.join(app.getPath('userData'), 'auto-elevou.lock');

        // O lock guarda "QUANDO|QUEM" (timestamp|pid). Só vale se o processo que tentou
        // ainda estiver vivo e a tentativa for recente.
        //
        // Só com timestamp (15 s) a elevação alternava: fechar e reabrir dentro da janela
        // caía no lock e abria não elevado, mesmo sem nenhuma instância viva.
        let podeTentar = true;
        try {
          const bruto = String(fs.readFileSync(marcador, 'utf8') || '').trim();
          const [quandoTxt, pidTxt] = bruto.split('|');
          const quando = Number(quandoTxt) || 0;
          const pidAntigo = Number(pidTxt) || 0;
          if (quando && Date.now() - quando < 15000 && pidAntigo && pidAntigo !== process.pid) {
            // ainda dentro da janela E o processo dono do lock continua vivo?
            let vivo = false;
            try { process.kill(pidAntigo, 0); vivo = true; } catch (e) { vivo = false; }
            if (vivo) podeTentar = false;
          }
        } catch (e) { podeTentar = true; }

        if (podeTentar) {
          // Arquivo de desligamento: a tarefa não repassa os argumentos desta instância
          // para a elevada, então --sem-auto-elevar não chegaria lá. O arquivo chega.
          const desligado = path.join(app.getPath('userData'), 'auto-elevar-off.lock');
          const podeElevar = !fs.existsSync(desligado);
          if (podeElevar) {
            try { fs.writeFileSync(marcador, String(Date.now()) + '|' + String(process.pid)); } catch (e) { }

            // Mesmo disparo do botão. Se ele falhar, esta instância SEGUE ABERTA em modo
            // limitado — nunca fecha sem deixar janela.
            if (reabrirElevadoPelaTarefa()) {
              app.isQuitting = true;
              setTimeout(() => { try { app.quit(); } catch (e) { } }, 200);
              return;
            }
          }
        }
      }
    } catch (e) { }
  }

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

  // Saída de emergência: Ctrl+Shift+Q encerra o app.
  //
  // Quando o app roda ELEVADO, o clique no botão X é filtrado pelo UIPI e a janela não
  // fecha (medido pelo auditor: clique sintético não chega; só WC_SYSCOMMAND/SC_CLOSE de
  // um processo de integridade igual passa). O atalho global é registrado por ESTE
  // processo, que já está elevado — a mensagem nasce com o mesmo nível e atravessa.
  // app.exit(0) sai na hora, sem depender de fechar janela.
  try {
    globalShortcut.register('Control+Shift+Q', () => {
      try { fs.appendFileSync(path.join(process.env.LOCALAPPDATA || os.homedir(), 'VLOptimizer', 'crash.log'), '[' + new Date().toISOString() + '] atalho Ctrl+Shift+Q: saindo' + String.fromCharCode(10)); } catch (e) { }
      app.isQuitting = true;
      app.exit(0);
    });
  } catch (e) {}
  feat.autoStart();
  feat.ramStart();
  // Auto-update pelo GitHub Releases: consulta em segundo plano, baixa sozinho e deixa a
  // instalação para o usuário. Falha aqui nunca impede o app de abrir.
  try { updater.start(); } catch (e) {}
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

}

// ── Vigia do zumbi ─────────────────────────────────────────────────────────
// O lock de instância única só é liberado quando o processo dono termina. Se a janela
// principal cair e o overlay segurar o processo vivo, o app fica sem janela nenhuma e
// toda abertura nova sai calada — foi o "abriu uma vez e não abre mais".
// Aqui, se a janela principal ficou destruída por mais de 20 s, o app se encerra e
// libera o lock para a próxima abertura.
let semJanelaDesde = 0;
setInterval(() => {
  try {
    if (app.isQuitting) return;
    const semJanela = !win || win.isDestroyed();
    if (!semJanela) { semJanelaDesde = 0; return; }
    if (!semJanelaDesde) { semJanelaDesde = Date.now(); return; }
    if (Date.now() - semJanelaDesde > 20000) {
      logCrash('janela principal ausente ha 20 s; encerrando para liberar o lock');
      app.isQuitting = true;
      app.quit();
    }
  } catch (e) { }
}, 5000).unref();

// Marca que o app está fechando: usado pela recuperação de crash para não
// recriar a janela no meio da saída.
app.on('before-quit', () => { app.isQuitting = true; });

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) { } try { updater.stop(); } catch (e) { } });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Recuperação de crash do renderer ──────────────────────────────────────
// Sem estes handlers, um renderer que cai leva a janela junto, cai em
// window-all-closed e o app fecha sozinho sem explicar nada.
// Reproduzido com chamadas IPC concorrentes (é o que o painel faz ao abrir).
let recriacoes = [];
// Registra um evento de processo. Aviso: "killed" e "crashed" são coisas diferentes —
// o Electron reporta 'killed' quando o processo é encerrado de fora (taskkill, encerrar
// pelo Gerenciador de Tarefas) e 'crashed' quando ele realmente falha. O log antigo
// escrevia "caiu" nos dois casos e confundiu uma investigação inteira.
function logSaidaNormal() { return !!(app && app.isQuitting); }

function logCrash(texto) {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.homedir(), "VLOptimizer");
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
    fs.appendFileSync(path.join(dir, "crash.log"), "[" + new Date().toISOString() + "] " + texto + String.fromCharCode(10));
  } catch (e) { }
}

app.on("render-process-gone", (event, webContents, details) => {
  const motivo = (details && details.reason) || "desconhecido";

  // Saída normal do app: qualquer filho que caia agora é consequência, não causa.
  if (logSaidaNormal()) return;

  // Quem caiu: a janela principal ou uma secundária (overlay do FPS, scaling)?
  //
  // Antes a comparação era `webContents !== win.webContents`. Depois de uma recriação o
  // webContents é outro objeto, então os crashes seguintes eram classificados como
  // "secundário" e o contador de anti-laço nunca chegava a 2: o freio não existia.
  // Agora compara também pelo id e pelo estado da janela.
  const ehPrincipal = (() => {
    if (!win || win.isDestroyed()) return false;
    try { if (webContents === win.webContents) return true; } catch (e) { }
    try { if (webContents && win.webContents && webContents.id === win.webContents.id) return true; } catch (e) { }
    // janela principal viva mas sem webContents válido: é ela que caiu
    try { return !win.webContents || win.webContents.isDestroyed(); } catch (e) { return false; }
  })();

  if (!ehPrincipal) {
    logCrash("renderer secundário caiu (" + motivo + "); janela principal segue");
    return;
  }

  // 'killed' = encerrado de fora (Gerenciador de Tarefas, taskkill, ou OOM do sistema).
  // Antes era ignorado e a janela ficava na tela, congelada, sem renderer nenhum.
  if (motivo === "killed") {
    logCrash("renderer da janela principal encerrado de fora; recriando a janela");
  }

  logCrash("janela principal caiu: " + motivo + " (exitCode " + ((details && details.exitCode) || 0) + ")");

  // anti-laço: no máximo 2 recriações em 60 segundos
  const agora = Date.now();
  recriacoes = recriacoes.filter((t) => agora - t < 60000);
  if (recriacoes.length >= 2) {
    logCrash("ja recriou 2x em 1 minuto; parando");
    dialog.showErrorBox(
      "VL Optimizer parou de responder",
      "O programa encontrou um problema repetido e precisa ser reaberto." + String.fromCharCode(10) + String.fromCharCode(10) +
      "Detalhe: " + motivo
    );
    return;
  }

  recriacoes.push(agora);
  // Recria sem depender de `win` estar viva: é justamente ela que acabou de cair.
  try {
    setTimeout(() => {
      // Se o app já está fechando, não ressuscitar a janela: travaria o fechamento.
      if (app.isQuitting) { logCrash("app fechando; nao recriar"); return; }
      recriandoJanela = true;
      try { if (!win || win.isDestroyed()) createWindow(); } catch (e) { logCrash('falha ao recriar: ' + e.message); }
      finally { setTimeout(() => { recriandoJanela = false; }, 1500); }
    }, 250);
  } catch (e) { logCrash("falha ao agendar recriação: " + e.message); }
});

app.on("child-process-gone", (event, details) => {
  if (logSaidaNormal()) return;
  const r = String((details && details.reason) || "?");
  if (r === "killed") return;
  logCrash("processo " + ((details && details.type) || "?") + " falhou: " + r);
});

app.on("web-contents-created", (event, wc) => {
  wc.on("unresponsive", () => logCrash("janela nao respondeu"));
  wc.on("responsive", () => logCrash("janela voltou a responder"));
  wc.on("did-fail-load", (e, code, desc, url) => logCrash("falha ao carregar " + url + ": " + desc + " (" + code + ")"));
});
// Erro nao tratado no processo principal.
//
// Antes gravava em %TEMP%\lopt-error.log e nao fazia mais nada. O arquivo nem existia
// nas verificacoes (o TEMP do app e outro), entao o suporte ficava cego. Agora vai para
// a pasta de dados do app, que e a mesma que o crash.log usa.
process.on('uncaughtException', (e) => {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'VLOptimizer');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { }
    fs.appendFileSync(path.join(dir, 'crash.log'), '[' + new Date().toISOString() + '] erro nao tratado: ' + String((e && e.stack) || e) + String.fromCharCode(10));
  } catch (_) { }
});
