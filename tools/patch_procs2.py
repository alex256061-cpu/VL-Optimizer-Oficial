import io, re

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# substitui o bloco procCache/procOpen/processRunning por versão async, uma chamada só
start = s.find("const procCache = new Map();")
end = s.find("ex.cleanScan = async () => {")
if start < 0 or end < 0:
    raise SystemExit("bloco de processos nÃ£o encontrado")
new = r"""let procList = { at: 0, set: new Set() };
async function runningNames() {
  if (Date.now() - procList.at < 5000) return procList.set;
  const r = await core.ps(`$n = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique); Write-Output (Json $n)`, 15000);
  const set = new Set();
  try {
    const j = JSON.parse(r.out);
    for (const n of (Array.isArray(j) ? j : [j])) set.add(String(n).toLowerCase());
  } catch (e) {}
  procList = { at: Date.now(), set };
  return set;
}
async function anyRunning(names) {
  const set = await runningNames();
  return (names || []).some((n) => set.has(String(n).toLowerCase()));
}

"""
s = s[:start] + new + s[end:]

# cleanCats vira async e usa anyRunning
s = s.replace("function cleanCats() {\n  return CATS.map((c) => {", "async function cleanCats() {\n  const out = [];\n  for (const c of CATS) {")
s = s.replace("""    return {
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      open: c.procs ? procOpen(c.procs) : false,
      app: c.app, special: c.special, note: c.note,
    };
  });
}""", """    out.push({
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      open: c.procs ? await anyRunning(c.procs) : false,
      app: c.app, special: c.special, note: c.note,
    });
  }
  return out;
}""")

# chamadas
s = s.replace("return { success: true, cats: cleanCats(), measuring:", "return { success: true, cats: await cleanCats(), measuring:")
s = s.replace("  cats: cleanCats(),", "  cats: await cleanCats(),")
s = s.replace("if (c.procs && procOpen(c.procs))", "if (c.procs && await anyRunning(c.procs))")

io.open(p, "w", encoding="utf-8").write(s)
print("async procs ok")
