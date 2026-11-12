import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "  try {\n    fs.writeFileSync(file, out, 'utf8');\n    const cur = lsParse((lsProfileParts(out) || {}).block || out);"
new = "  try {\n    fs.mkdirSync(path.dirname(file), { recursive: true });\n    fs.writeFileSync(file, out, 'utf8');\n    const cur = lsParse((lsProfileParts(out) || {}).block || out);"
if old not in s:
    raise SystemExit("trecho write nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
