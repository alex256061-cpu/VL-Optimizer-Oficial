import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# ── findGameExe: aceita exe pequeno e prefere o nome da pasta ──
old = """const findGameExe = (dir) => {
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
};"""
new = """const findGameExe = (dir) => {
  if (!dir || !fs.existsSync(dir)) return '';
  const folder = path.basename(dir).toLowerCase();
  const cands = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\\.exe$/i.test(e.name)) {
        try { const st = fs.statSync(p); if (st.size > 60 * 1024) cands.push({ p, size: st.size, name: e.name }); } catch (err) {}
      }
    }
  };
  walk(dir, 0);
  if (!cands.length) return '';
  const scored = cands.map((c) => {
    const n = c.name.toLowerCase().replace(/\\.exe$/, '');
    let sc = c.size;
    if (/launcher|unins|setup|crash|report|updater|service|tool|redist|vc_redist|dxsetup/.test(n)) sc /= 20;
    if (/(gta|fivem|cs2|valorant|fortnite|game|shipping|win64)/.test(n)) sc *= 2;
    if (n === folder || folder.includes(n) || n.includes(folder)) sc *= 5;
    return { p: c.p, s: sc };
  }).sort((a, b) => b.s - a.s);
  return scored[0].p;
};

// apps do Steam que não são jogos (não entram em Meus jogos)
const NON_GAME = /^(steamworks common redistributables|steamvr|steam linux runtime|proton|steam client|wallpaper engine|lossless scaling)$/i;"""
if old not in s:
    raise SystemExit("findGameExe nÃ£o encontrado")
s = s.replace(old, new)

# filtra não-jogos no scan da Steam
s = s.replace("            if (!name || !appid || seen.has(appid)) continue;",
              "            if (!name || !appid || seen.has(appid) || NON_GAME.test(name.trim())) continue;")

# ── lsLaunch: verificação pós-abertura (o engine aceitou nosso Settings.xml?) ──
old_launch = """    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);
    let message;
    if (applied && applied.firstRun) message = 'Primeira vez: o Lossless criou o perfil. Se as opções não pegarem, clique Iniciar de novo.';
    else if (applied && applied.applied) message = 'Opções aplicadas no Lossless.';
    return { success: true, message, engine: exePath, applied: applied ? applied.applied : 0 };"""
new_launch = """    const c = scalingCfg(); c.engine = exePath; c.lastLaunch = Date.now(); saveScaling(c);
    // confere daqui a 8s se o engine aceitou o arquivo (se reescreveu, nossas opções não valeram)
    setTimeout(async () => {
      try {
        const cur = ex.lsRead();
        if (!cur.exists) return;
        const want = lsWrite ? null : null;
        const marker = (applied && applied.settings) ? applied.settings.FrameGeneration : null;
        const now = cur.settings && cur.settings.FrameGeneration;
        const cc = scalingCfg();
        cc.settingsRejected = !!(marker && now && String(now).toUpperCase() !== String(marker).toUpperCase());
        saveScaling(cc);
      } catch (e) {}
    }, 8000);
    let message;
    if (applied && applied.firstRun) message = 'Lossless aberto pela primeira vez. Se as opções não pegarem, clique Iniciar de novo.';
    else if (applied && applied.applied) message = 'Opções aplicadas no Lossless.';
    if (scalingCfg().settingsRejected) message = 'O Lossless rejeitou as opções da janela: abra ele e ajuste uma vez (depois o VL passa a aplicar).';
    return { success: true, message, engine: exePath, applied: applied ? applied.applied : 0 };"""
if old_launch not in s:
    raise SystemExit("lsLaunch trecho nÃ£o encontrado")
s = s.replace(old_launch, new_launch)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")

# preload: ls-status
p = ROOT + r"\preload.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("'ls-browse-exe', 'ls-find-exe', 'ls-launch', 'ls-stop', 'ls-config',",
              "'ls-browse-exe', 'ls-find-exe', 'ls-launch', 'ls-stop', 'ls-config', 'ls-status',")
io.open(p, "w", encoding="utf-8").write(s)
print("preload ok", "'ls-status'" in s)
