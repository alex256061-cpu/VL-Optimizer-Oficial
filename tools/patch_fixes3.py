import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# settings path: descobre a pasta do Lossless em %LOCALAPPDATA%
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "const lsSettingsPath = () => path.join(os.homedir(), 'AppData', 'Local', LS_DIR, 'Settings.xml');"
new = """const lsSettingsPath = () => {
  const base = path.join(os.homedir(), 'AppData', 'Local');
  try {
    for (const d of fs.readdirSync(base)) {
      if (!/lossless/i.test(d)) continue;
      const f = path.join(base, d, 'Settings.xml');
      if (fs.existsSync(f)) return f;
    }
  } catch (e) {}
  return path.join(base, LS_DIR, 'Settings.xml');
};"""
if old not in s:
    raise SystemExit("lsSettingsPath nÃ£o encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("path ok")

# nome do arquivo da janela de scaling (não sobrescrever a página)
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace("fs.writeFileSync(path.join(dir, 'scaling.png'), img.toPNG());", "fs.writeFileSync(path.join(dir, 'scaling-window.png'), img.toPNG());")
io.open(p, "w", encoding="utf-8").write(s)
print("main ok")
