import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
if "function procOpen" not in s:
    old = "function processRunning(names) {"
    ins = """const procCache = new Map();
function procOpen(names) {
  const key = (names || []).join(',');
  const hit = procCache.get(key);
  if (hit && Date.now() - hit.at < 6000) return hit.val;
  const val = processRunning(names);
  procCache.set(key, { at: Date.now(), val });
  return val;
}

function processRunning(names) {"""
    if old not in s:
        raise SystemExit("processRunning nÃ£o encontrado")
    s = s.replace(old, ins, 1)
    io.open(p, "w", encoding="utf-8").write(s)
print("ok", "function procOpen" in s)
