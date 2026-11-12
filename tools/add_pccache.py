import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """ex.pcinfoGet = async () => {
  const r = await core.ps(String.raw`"""
new = """let pcinfoCache = { at: 0, data: null };
ex.pcinfoGet = async (opts) => {
  const force = !!(opts && opts.force);
  if (!force && pcinfoCache.data && Date.now() - pcinfoCache.at < 120000) return pcinfoCache.data;
  const r = await core.ps(String.raw`"""
if old not in s:
    raise SystemExit("pcinfoGet header nÃ£o encontrado")
s = s.replace(old, new, 1)

old2 = """    info.mem.total = (info.mem.modules || []).reduce((a, m) => a + m.bytes, 0);
    return { success: true, info };"""
new2 = """    info.mem.total = (info.mem.modules || []).reduce((a, m) => a + m.bytes, 0);
    const result = { success: true, info };
    pcinfoCache = { at: Date.now(), data: result };
    return result;"""
if old2 not in s:
    raise SystemExit("pcinfoGet return nÃ£o encontrado")
s = s.replace(old2, new2, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("cache ok")

p2 = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
m = io.open(p2, encoding="utf-8").read()
m = m.replace("H('pcinfo-get', () => ex.pcinfoGet());", "H('pcinfo-get', (e, opts) => ex.pcinfoGet(opts));")
io.open(p2, "w", encoding="utf-8").write(m)
print("handler ok")
