import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# 1) Steam: steamId + bytes/cover + tamanho depois
s = s.replace(
    "games.push({ id: 'steam:' + appid, name, dir: dir ? path.join(appsDir, 'common', dir) : '', exe: dir ? findGameExe(path.join(appsDir, 'common', dir)) : '', gpu: true, canClean: true, appid, store: 'steam' });",
    "games.push({ id: 'steam:' + appid, name, dir: dir ? path.join(appsDir, 'common', dir) : '', exe: dir ? findGameExe(path.join(appsDir, 'common', dir)) : '', gpu: true, canClean: true, appid: String(appid), steamId: String(appid), store: 'steam', bytes: 0 });",
)
s = s.replace(
    "games.push({ id: 'epic:' + j.AppName, name: j.DisplayName, dir: j.InstallLocation, exe: findGameExe(j.InstallLocation), gpu: true, canClean: true, store: 'epic' });",
    "games.push({ id: 'epic:' + j.AppName, name: j.DisplayName, dir: j.InstallLocation, exe: findGameExe(j.InstallLocation), gpu: true, canClean: true, store: 'epic', bytes: 0 });",
)
s = s.replace(
    "games.push({ id: 'fivem', name: 'FiveM (GTA RP)', dir: path.join(fivem, 'FiveM.app'), exe: path.join(fivem, 'FiveM.app', 'FiveM.exe'), gpu: true, canClean: true, store: 'fivem' });",
    "games.push({ id: 'fivem', name: 'FiveM (GTA RP)', dir: path.join(fivem, 'FiveM.app'), exe: path.join(fivem, 'FiveM.app', 'FiveM.exe'), gpu: true, canClean: true, store: 'fivem', bytes: 0 });",
)

# 2) calcula tamanho das pastas em paralelo com orçamento por jogo
old_tail = """  gamesCache = games;
  return { success: true, games };
};"""
new_tail = """  await Promise.all(games.map(async (g) => {
    if (!g.dir || !fs.existsSync(g.dir)) return;
    try {
      const r = await dirSizes([g.dir], 0, 4000);
      g.bytes = r.bytes;
    } catch (e) {}
  }));
  for (const g of games) g.sizeLabel = fmtBytes(g.bytes);
  gamesCache = games;
  return { success: true, games };
};"""
if old_tail not in s:
    raise SystemExit("gamesScan tail nÃ£o encontrado")
s = s.replace(old_tail, new_tail, 1)

# 3) gamesStatus: marca o que está rodando de verdade
old_status = """ex.gamesStatus = async () => {
  if (!gamesCache) await ex.gamesScan();
  return { scanning: false, games: gamesCache };
};"""
new_status = """const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (!n) return '';
  const u = [['TB', 1024 ** 4], ['GB', 1024 ** 3], ['MB', 1024 ** 2]];
  for (const [suf, v] of u) if (n >= v) return (n / v).toLocaleString('pt-BR', { maximumFractionDigits: n / v >= 100 ? 0 : 1 }) + ' ' + suf;
  return Math.round(n / 1024) + ' KB';
};

ex.gamesStatus = async () => {
  if (!gamesCache) await ex.gamesScan();
  try {
    const r = await core.ps(`$n = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique); Write-Output (Json $n)`);
    let names = [];
    try { const j = JSON.parse(r.out); names = Array.isArray(j) ? j : [j]; } catch (e) {}
    const set = new Set(names.map((n) => String(n).toLowerCase()));
    for (const g of gamesCache || []) {
      const base = g.exe ? path.basename(g.exe, path.extname(g.exe)).toLowerCase() : '';
      g.running = !!(base && set.has(base)) || (g.store === 'fivem' && set.has('fivem'));
    }
  } catch (e) {}
  return { scanning: false, games: gamesCache };
};"""
if old_status not in s:
    raise SystemExit("gamesStatus nÃ£o encontrado")
s = s.replace(old_status, new_status, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("games backend ok")

# 4) renderer: tamanho no rodapé do card
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
old = '<div class="game-footer"><span class="game-name" title="${name}">${name}</span></div>'
new = '<div class="game-footer"><span class="game-name" title="${name}">${name}</span><span class="game-size">${info.sizeLabel || \'\'}</span></div>'
if old not in s:
    raise SystemExit("game-footer nÃ£o encontrado")
s = s.replace(old, new, 1)
# estilo do tamanho
css = ".game-size { margin-left: auto; font-size: 10.5px; font-weight: 700; color: var(--text3); white-space: nowrap; }\n"
s = s.replace(".game-footer", css + ".game-footer", 1)
io.open(p, "w", encoding="utf-8").write(s)
print("renderer ok")
