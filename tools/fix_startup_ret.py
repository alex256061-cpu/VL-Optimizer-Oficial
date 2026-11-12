import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
if "return { success: true, items };" not in s:
    old = "  return { items };\n};"
    if old not in s:
        raise SystemExit("return nÃ£o encontrado")
    s = s.replace(old, "  return { success: true, items };\n};", 1)
    io.open(p, "w", encoding="utf-8").write(s)
print("ok", "return { success: true, items };" in s)
