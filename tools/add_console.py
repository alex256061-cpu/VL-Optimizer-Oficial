import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = "  if (process.argv.includes('--pcshot')) {\n    win.webContents.once('did-finish-load', async () => {"
new = "  if (process.argv.includes('--pcshot')) {\n    win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.log('RENDER_ERR ' + message); });\n    win.webContents.once('did-finish-load', async () => {"
if old not in s:
    raise SystemExit("pcshot header nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
