import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── main.js ──
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()

s = s.replace(
    "const { app, BrowserWindow, ipcMain, shell, screen, nativeTheme } = require('electron');",
    "const { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, globalShortcut } = require('electron');",
)
s = s.replace(
    "const core = require('./engine');\nconst ex = require('./engine-extras');",
    "const core = require('./engine');\nconst ex = require('./engine-extras');\nconst feat = require('./features');",
)

# flags
s = s.replace(
    "const isSmoke = process.argv.includes('--smoke');",
    "const isSmoke = process.argv.includes('--smoke');\nconst isTest = ['--smoke', '--shots', '--uitest'].some((a) => process.argv.includes(a));\nlet isAdmin = false;\nlet elevateFailed = false;",
)

# ready-to-show com --silent
s = s.replace(
    "  win.once('ready-to-show', () => { if (!isSmoke) win.show(); });",
    "  win.once('ready-to-show', () => {\n    if (isSmoke) return;\n    win.show();\n    if (process.argv.includes('--silent')) win.minimize();\n  });",
)

# IPC: admin, auto, ram
s = s.replace(
    "H('set-auto-mode', ({ on }) => ex.setAutoMode(on));",
    "H('set-auto-mode', ({ on }) => feat.autoSet(on));",
)
s = s.replace(
    "H('ram-clean', () => ex.ramClean());\nH('ram-status', () => ({ success: true, auto: false, at: 0, freed: 0 }));\nH('ram-auto-set', ({ on }) => ({ success: true, on }));",
    "H('ram-clean', () => feat.ramClean());\nH('ram-status', () => ({ success: true, ...feat.ramState() }));\nH('ram-auto-set', ({ on }) => feat.ramAutoSet(on));\nH('admin-status', () => ({ admin: isAdmin, failed: elevateFailed }));\nH('elevate-now', async () => {\n  const ok = await feat.elevate(app.isPackaged ? null : app.getAppPath());\n  if (ok) { app.exit(0); return { success: true }; }\n  return { success: false, error: 'Elevação cancelada.' };\n});",
)

# whenReady: elevação, atalhos, auto/ram
old_ready = """app.whenReady().then(async () => {
  createWindow();
  startTicker();
  try {
    const st = await ex.fpsStatus();
    ex.setOverlayState({ on: st.overlay.on, pos: st.overlay.pos, show: st.overlay.show });
    if (st.overlay.on) applyOverlay({ on: true, pos: st.overlay.pos, show: st.overlay.show });
  } catch (e) {}
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});"""
new_ready = """app.whenReady().then(async () => {
  // Administrador: sem elevação, serviços/DISM/energia falham. Tenta uma vez e, se o UAC for
  // cancelado, segue em modo limitado com aviso na tela.
  isAdmin = await feat.isAdmin();
  if (!isAdmin && !isTest && !process.argv.includes('--elevated') && !process.argv.includes('--no-elevate')) {
    const ok = await feat.elevate(app.isPackaged ? null : app.getAppPath());
    if (ok) { app.exit(0); return; }
    elevateFailed = true;
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
  feat.autoStart();
  feat.ramStart();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });"""
if old_ready not in s:
    raise SystemExit("whenReady nÃ£o encontrado")
s = s.replace(old_ready, new_ready)

io.open(p, "w", encoding="utf-8").write(s)
print("main ok")

# ── preload.js: canais novos + evento do atalho ──
p = ROOT + r"\preload.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("'gdz-scaling-get-res', 'gdz-scaling-apply', 'gdz-scaling-revert',",
              "'gdz-scaling-get-res', 'gdz-scaling-apply', 'gdz-scaling-revert',\n  'admin-status', 'elevate-now',")
s = s.replace("const ON = ['fps-update', 'overlay-update', 'entitlement-update', 'update-status'];",
              "const ON = ['fps-update', 'overlay-update', 'entitlement-update', 'update-status', 'fps-hotkey'];")
io.open(p, "w", encoding="utf-8").write(s)
print("preload ok", "'admin-status'" in s)
