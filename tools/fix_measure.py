import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

anchor = "async function anyRunning(names) {\n  const set = await runningNames();\n  return (names || []).some((n) => set.has(String(n).toLowerCase()));\n}\n"
if anchor not in s:
    raise SystemExit("anchor anyRunning nÃ£o encontrado")

block = r"""
// ── Medição da limpeza: segundo plano, sem corte de tempo, com progresso ──
const cleanM = { at: 0, measuring: false, index: 0, total: 0, sizes: {} };

function cleanDirsOf(c) {
  if (c.steam) return steamRoot ? [path.join(steamRoot, 'appcache', 'httpcache'), path.join(steamRoot, 'logs'), path.join(steamRoot, 'dumps'), path.join(steamRoot, 'htmlcache')] : [];
  return c.paths || [];
}

async function recycleBytes() {
  const r = await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); if ($bin) { foreach ($i in $bin.Items()) { $s += $i.Size } } } catch {}; Write-Output ([int64]$s)`);
  return parseInt(r.out, 10) || 0;
}

async function cleanCats() {
  const out = [];
  for (const c of CATS) {
    const m = cleanM.sizes[c.id];
    out.push({
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      open: c.procs ? await anyRunning(c.procs) : false,
      app: c.app, special: c.special, note: c.note,
    });
  }
  return out;
}

let cleanJob = null;
async function measureClean(force) {
  if (cleanJob) return cleanJob;
  if (!force && cleanM.at && Date.now() - cleanM.at < 120000) return null;
  cleanJob = (async () => {
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
  })();
  return cleanJob;
}

"""
s = s.replace(anchor, anchor + block, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("medição restaurada")
