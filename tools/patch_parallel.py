import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """  cleanJob = (async () => {
    cleanM.measuring = true;
    cleanM.index = 0;
    cleanM.total = CATS.length;
    if (force) cleanM.sizes = {};
    for (const c of CATS) {
      try {
        if (c.special === 'recycle') {
          const bytes = await recycleBytes();
          cleanM.sizes[c.id] = { bytes, files: bytes ? 1 : 0 };
        } else {
          const r = await dirSizes(cleanDirsOf(c), c.age || 0, 900000);
          cleanM.sizes[c.id] = { bytes: r.bytes, files: r.files };
        }
      } catch (e) {
        cleanM.sizes[c.id] = { bytes: 0, files: 0 };
      }
      cleanM.index++;
    }
    cleanM.measuring = false;
    cleanM.at = Date.now();
    cleanJob = null;
  })();"""
new = """  cleanJob = (async () => {
    cleanM.measuring = true;
    cleanM.index = 0;
    cleanM.total = CATS.length;
    if (force) cleanM.sizes = {};
    // categorias em paralelo: o tempo total vira o da pasta mais lenta, não a soma
    await Promise.all(CATS.map(async (c) => {
      const t0 = Date.now();
      try {
        if (c.special === 'recycle') {
          const bytes = await recycleBytes();
          cleanM.sizes[c.id] = { bytes, files: bytes ? 1 : 0 };
        } else {
          // orçamento alto (30 s) só como trava de segurança; não corta o caso normal
          const r = await dirSizes(cleanDirsOf(c), c.age || 0, 30000);
          cleanM.sizes[c.id] = { bytes: r.bytes, files: r.files };
        }
      } catch (e) {
        cleanM.sizes[c.id] = { bytes: 0, files: 0 };
      }
      cleanM.index++;
      void t0;
    }));
    cleanM.measuring = false;
    cleanM.at = Date.now();
    cleanJob = null;
  })();"""
if old not in s:
    raise SystemExit("measureClean loop nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("paralelo ok")
