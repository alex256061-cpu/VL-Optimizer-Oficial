import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()

old = """  isAdmin = await feat.isAdmin();
  if (!isAdmin && !isTest && !process.argv.includes('--elevated') && !process.argv.includes('--no-elevate')) {
    const ok = await feat.elevate(app.isPackaged ? null : app.getAppPath());
    if (ok) { app.exit(0); return; }
    elevateFailed = true;
  }
  createWindow();"""
new = """  isAdmin = await feat.isAdmin();
  if (isAdmin && process.argv.includes('--elevated')) {
    // instância elevada: deixa o marcador para a original saber que subiu
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'elevated.lock'), String(Date.now())); } catch (e) {}
  }
  if (app.isPackaged && !isAdmin && !isTest && !process.argv.includes('--elevated') && !process.argv.includes('--no-elevate')) {
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
if old not in s:
    raise SystemExit("bloco de elevação nÃ£o encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("elevação robusta ok")
