import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """function dirSizes(dirs, ageDays) {
  let bytes = 0, files = 0;
  const cutoff = ageDays ? Date.now() - ageDays * 86400000 : 0;
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) {
          const st = fs.statSync(p);
          if (!cutoff || st.mtimeMs < cutoff) { bytes += st.size; files++; }
        }
      } catch (e) {}
    }
  };
  for (const d of dirs) walk(d);
  return { bytes, files };
}"""

new = """const yieldNow = () => new Promise((r) => setImmediate(r));
async function dirSizes(dirs, ageDays) {
  let bytes = 0, files = 0, n = 0;
  const cutoff = ageDays ? Date.now() - ageDays * 86400000 : 0;
  const walk = async (dir, depth) => {
    if (depth > 14) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (e.isFile()) {
          const st = fs.statSync(p);
          if (!cutoff || st.mtimeMs < cutoff) { bytes += st.size; files++; }
        }
      } catch (e) {}
      if (++n % 400 === 0) await yieldNow();
    }
  };
  for (const d of dirs) await walk(d, 0);
  return { bytes, files };
}"""
if old not in s:
    raise SystemExit("dirSizes não encontrado")
s = s.replace(old, new)

# call sites: await
s = s.replace("({ bytes, files } = dirSizes(dirs, c.age || 0));", "({ bytes, files } = await dirSizes(dirs, c.age || 0));")
s = s.replace("? parseInt((await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); foreach ($i in $bin.Items()) { $s += $i.Size } } catch {}; Write-Output ([int64]$s)`)).out, 10) || 0\n      : dirSizes(c.paths || [], c.age || 0).bytes;",
              "? parseInt((await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); foreach ($i in $bin.Items()) { $s += $i.Size } } catch {}; Write-Output ([int64]$s)`)).out, 10) || 0\n      : (await dirSizes(c.paths || [], c.age || 0)).bytes;")
s = s.replace("results.push({ id, freed: Math.max(0, before - (c.age ? dirSizes(c.paths, c.age).bytes : 0)), failed, open });",
              "results.push({ id, freed: Math.max(0, before - (c.age ? (await dirSizes(c.paths, c.age)).bytes : 0)), failed, open });")
s = s.replace(": dirSizes(c.paths || [], c.age || 0).bytes;", ": (await dirSizes(c.paths || [], c.age || 0)).bytes;")
s = s.replace("ex.cleanTempSize = () => dirSizes([os.tmpdir(), 'C:\\\\Windows\\\\Temp'], 1).bytes;",
              "ex.cleanTempSize = async () => (await dirSizes([os.tmpdir(), 'C:\\\\Windows\\\\Temp'], 1)).bytes;")
s = s.replace("return { startupOn: on, tempBytes: ex.cleanTempSize() };", "return { startupOn: on, tempBytes: await ex.cleanTempSize() };")

# appsExtra: async walk
old2 = """      try {
        let total = 0;
        const walk = (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p, depth + 1); else if (x.isFile()) { try { total += fs.statSync(p).size; } catch (e) {} } } };
        walk(a.loc, 0);
        sizes[a.key] = total;
      } catch (e) {}"""
new2 = """      try {
        let total = 0;
        const walk = async (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { if (x.isSymbolicLink()) continue; const p = path.join(d, x.name); if (x.isDirectory()) await walk(p, depth + 1); else if (x.isFile()) { try { total += fs.statSync(p).size; } catch (e) {} } await yieldNow(); } };
        await walk(a.loc, 0);
        sizes[a.key] = total;
      } catch (e) {}"""
s = s.replace(old2, new2)

# appsLeftovers uses dirSizes
s = s.replace("const { bytes } = dirSizes([d], 0);", "const { bytes } = await dirSizes([d], 0);")
s = s.replace("bytes += dirSizes([p], 0).bytes; fs.rmSync(p, { recursive: true, force: true }); trashed++;",
              "bytes += (await dirSizes([p], 0)).bytes; fs.rmSync(p, { recursive: true, force: true }); trashed++;")

io.open(p, "w", encoding="utf-8").write(s)
print("patched", "await dirSizes" in s)
