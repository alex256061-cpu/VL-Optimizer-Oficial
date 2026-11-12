import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = """ex.cleanScan = async () => {
  measureClean(false);
  return { success: true, cats: await cleanCats(), measuring: cleanM.measuring, index: cleanM.index, total: cleanM.total };
};"""
new = """ex.cleanScan = async () => {
  // mede de verdade (sem corte); a página mostra "Procurando…" enquanto isso
  if (cleanJob) await cleanJob;
  else await measureClean(false);
  return { success: true, cats: await cleanCats(), measuring: cleanM.measuring, index: cleanM.index, total: cleanM.total };
};"""
if old not in s:
    raise SystemExit("cleanScan nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
