import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """ex.optiInstall = async ({ exe, dll, opts }) => {
  const st = optiStore();
  if (!st.pkg || !fs.existsSync(st.pkg.file)) return { success: false, error: 'Baixe o OptiScaler primeiro.' };
  const dir = path.dirname(exe);"""
new = """ex.optiInstall = async ({ exe, dll, opts, acceptAntiCheat }) => {
  const st = optiStore();
  if (!st.pkg || !fs.existsSync(st.pkg.file)) return { success: false, error: 'Baixe o OptiScaler primeiro.' };
  if (!exe || !fs.existsSync(exe)) return { success: false, error: 'Escolha o .exe do jogo.' };
  const a = await ex.optiAnalyze({ exe });
  if (a && a.block && !acceptAntiCheat) {
    return { success: false, error: 'Este jogo usa anti-cheat (' + a.antiCheat.join(', ') + '). Instalar DLLs nele pode dar ban — só faça isso em modo offline e por sua conta.' };
  }
  const dir = path.dirname(exe);
  try {
    const probe = path.join(dir, '.lopt-write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
  } catch (e) { return { success: false, error: 'Sem permissão de escrita na pasta do jogo. Rode o VL como administrador.' }; }"""
if old not in s:
    raise SystemExit("optiInstall header nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
