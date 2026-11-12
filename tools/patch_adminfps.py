import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── engine-extras: detectar falta de admin no PresentMon ──
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# startPM: stderr + flag
old = """    fps.proc = p;
    let buf = '';"""
new = """    fps.proc = p;
    fps.denied = false;
    try { p.stderr.on('data', (d) => { if (/access denied|elevated privilege|administrative/i.test(String(d))) fps.denied = true; }); } catch (e) {}
    let buf = '';"""
if old not in s:
    raise SystemExit("startPM nÃ£o encontrado")
s = s.replace(old, new, 1)

# list capture: stderr + flag
old2 = """    listCap.proc = p;
    let buf = '', header = null, ftIdx = -1, appIdx = 0;"""
new2 = """    listCap.proc = p;
    listCap.denied = false;
    try { p.stderr.on('data', (d) => { if (/access denied|elevated privilege|administrative/i.test(String(d))) listCap.denied = true; }); } catch (e) {}
    let buf = '', header = null, ftIdx = -1, appIdx = 0;"""
if old2 not in s:
    raise SystemExit("listCapture nÃ£o encontrado")
s = s.replace(old2, new2, 1)

# fpsStatus: needsAdmin
old3 = """    sessions: { a: fps.sessions.a, b: fps.sessions.b }, base, hotkey: fps.hotkey,
  };"""
new3 = """    sessions: { a: fps.sessions.a, b: fps.sessions.b }, base, hotkey: fps.hotkey,
    needsAdmin: !!(fps.denied || listCap.denied) && !fps.fps,
  };"""
if old3 not in s:
    raise SystemExit("fpsStatus return nÃ£o encontrado")
s = s.replace(old3, new3, 1)

# stopPM reseta o flag
s = s.replace("fps.frames = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;", "fps.frames = []; fps.fps = 0; fps.ft = 0; fps.low1 = 0;")
io.open(p, "w", encoding="utf-8").write(s)
print("extras ok")

# ── fps.js: mensagem de admin ──
p = ROOT + r"\src\fps.js"
s = io.open(p, encoding="utf-8").read()
old = """    if (!d.success) { msg.className = 'fpm-msg err'; msg.textContent = d.error || 'O medidor não iniciou.'; }
    else if (!live) { msg.className = 'fpm-msg'; msg.textContent = 'Abra um jogo: ele aparece aqui sozinho em poucos segundos.'; }"""
new = """    if (!d.success) { msg.className = 'fpm-msg err'; msg.textContent = d.error || 'O medidor não iniciou.'; }
    else if (d.needsAdmin) { msg.className = 'fpm-msg err'; msg.textContent = 'O medidor precisa de administrador: o Windows bloqueia a leitura de quadros sem ele. Use "Reabrir como admin" no topo.'; }
    else if (!live) { msg.className = 'fpm-msg'; msg.textContent = 'Abra um jogo: ele aparece aqui sozinho em poucos segundos.'; }"""
if old not in s:
    raise SystemExit("fps.js msg nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("fps.js ok")
