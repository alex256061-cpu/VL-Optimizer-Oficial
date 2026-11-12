import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()

old = """  if (app.isPackaged && !isAdmin && !isTest && !process.argv.includes('--elevated') && !process.argv.includes('--no-elevate')) {
    const marker = path.join(app.getPath('userData'), 'elevated.lock');
    try { fs.unlinkSync(marker); } catch (e) {}
    const ok = await feat.elevate(null);
    // só sai quando a instância elevada realmente abriu
    if (ok) {
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (fs.existsSync(marker)) { app.exit(0); return; }
      }
    }
    elevateFailed = true;
  }
  createWindow();"""
new = """  // A elevação é sob demanda: o app abre sempre; a faixa no topo oferece "Reabrir como admin".
  // (auto-elevação no start se mostrou frágil: se o UAC é cancelado a janela não abria)
  createWindow();"""
if old not in s:
    raise SystemExit("bloco de auto-elevaÃ§Ã£o nÃ£o encontrado")
s = s.replace(old, new)

# elevate-now: espera o marcador da instância elevada
old_ev = """H('elevate-now', async () => {
  const ok = await feat.elevate(app.isPackaged ? null : app.getAppPath());
  if (ok) { app.exit(0); return { success: true }; }
  return { success: false, error: 'Elevação cancelada.' };
});"""
new_ev = """H('elevate-now', async () => {
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
});"""
if old_ev not in s:
    raise SystemExit("elevate-now nÃ£o encontrado")
s = s.replace(old_ev, new_ev)
io.open(p, "w", encoding="utf-8").write(s)
print("elevação sob demanda ok")
