import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """  const walk = (dir, parent, depth) => {
    if (disk.cancel) return;
    if (depth > 12) return;
    const myId = ++id;
    let bytes = 0, files = 0;
    nodes.push([myId, parent, 0, 0, 0, path.basename(dir) || dir]);
    index.set(myId, nodes[nodes.length - 1]);
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { nodes[index.get(myId)].push(0); return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          const before = nodes.length;
          walk(p, myId, depth + 1);
          for (let k = before; k < nodes.length; k++) { if (nodes[k][1] === myId) bytes += nodes[k][2]; }
        } else if (e.isFile()) {
          const st = fs.statSync(p);
          bytes += st.size; files++;
          if (st.size > 5 * 1024 * 1024) big.push([st.size, p]);
        }
      } catch (err) {}
    }
    const n = index.get(myId);
    n[2] = bytes; n[3] = files;
    disk.bytes += 0; // progresso soma no fim
    disk.files++;
  };
  (async () => {
    const t0 = Date.now();
    walk(rootPath, 0, 0);"""

new = """  const walk = async (dir, parent, depth) => {
    if (disk.cancel) return;
    if (depth > 12) return;
    const myId = ++id;
    let bytes = 0, files = 0;
    nodes.push([myId, parent, 0, 0, 0, path.basename(dir) || dir]);
    index.set(myId, nodes[nodes.length - 1]);
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { nodes[index.get(myId)].push(0); return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          const before = nodes.length;
          await walk(p, myId, depth + 1);
          for (let k = before; k < nodes.length; k++) { if (nodes[k][1] === myId) bytes += nodes[k][2]; }
        } else if (e.isFile()) {
          const st = fs.statSync(p);
          bytes += st.size; files++;
          if (st.size > 5 * 1024 * 1024) big.push([st.size, p]);
        }
      } catch (err) {}
      if (++disk.files % 500 === 0) await yieldNow();
    }
    const n = index.get(myId);
    n[2] = bytes; n[3] = files;
  };
  (async () => {
    await walk(rootPath, 0, 0);"""
if old not in s:
    raise SystemExit("disk walk não encontrado")
s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
