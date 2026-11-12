import io
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# orçamento de tempo no walk (não deixa a limpeza passar de ~5s)
old = """async function dirSizes(dirs, ageDays) {
  let bytes = 0, files = 0, n = 0;
  const cutoff = ageDays ? Date.now() - ageDays * 86400000 : 0;"""
new = """async function dirSizes(dirs, ageDays, budgetMs) {
  let bytes = 0, files = 0, n = 0;
  const started = Date.now();
  const budget = budgetMs || 5000;
  const cutoff = ageDays ? Date.now() - ageDays * 86400000 : 0;"""
s = s.replace(old, new)
s = s.replace("      if (++n % 400 === 0) await yieldNow();", "      if (++n % 400 === 0) { await yieldNow(); if (Date.now() - started > budget) { n = -1; break; } }")
s = s.replace("      if (n < 0) break;", "")  # noop se não existir
# interrompe o loop externo se estourou
s = s.replace("  for (const d of dirs) await walk(d, 0);\n  return { bytes, files };",
              "  for (const d of dirs) { if (n < 0) break; await walk(d, 0); }\n  return { bytes, files };")

# cache de 30s para o tamanho de temporários
s = s.replace("ex.cleanTempSize = async () => (await dirSizes([os.tmpdir(), 'C:\\\\Windows\\\\Temp'], 1)).bytes;",
"""let tempCache = { at: 0, bytes: 0 };
ex.cleanTempSize = async () => {
  if (Date.now() - tempCache.at < 30000) return tempCache.bytes;
  const r = await dirSizes([os.tmpdir(), 'C:\\\\Windows\\\\Temp'], 1, 4000);
  tempCache = { at: Date.now(), bytes: r.bytes };
  return r.bytes;
};""")

# scans da UI de limpeza: orçamento de 6s por categoria
s = s.replace("({ bytes, files } = await dirSizes(dirs, c.age || 0));", "({ bytes, files } = await dirSizes(dirs, c.age || 0, 6000));")

io.open(p, "w", encoding="utf-8").write(s)
print("ok", "budget" in s)
