import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = "    const out = path.join(__dirname, 'site', 'preview');"
new = "    const out = process.env.VL_SITE_OUT || path.join(__dirname, 'site', 'preview');"
if old not in s:
    raise SystemExit("out nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
