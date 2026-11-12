import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
anchor = "const isSmoke = process.argv.includes('--smoke');"
if anchor not in s:
    raise SystemExit("anchor nÃ£o encontrado")
block = """// Em modos de teste, usa um perfil isolado: evita conflito com a instância elevada
// (cache do Chromium preso por admin faz o sandbox de rede falhar com acesso negado).
const TEST_FLAGS = ['--smoke', '--shots', '--siteshot', '--uitest', '--pcshot', '--optishot', '--animcheck', '--animstrip', '--ftest'];
if (TEST_FLAGS.some((f) => process.argv.includes(f))) {
  try { app.setPath('userData', path.join(os.tmpdir(), 'vl-dev-' + process.pid)); } catch (e) {}
}

const isSmoke = process.argv.includes('--smoke');"""
s = s.replace(anchor, block, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
