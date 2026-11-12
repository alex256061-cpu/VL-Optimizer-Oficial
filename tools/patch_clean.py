import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# 1) nova categoria: instaladores de driver
old_cat = "  { id: 'shaders', group: 'apps', name: 'Cache de shaders',"
new_cat = """  { id: 'drivers', group: 'win', name: 'Instaladores de driver', desc: 'Pastas C:\\\\NVIDIA, C:\\\\AMD, C:\\\\Intel e o downloader da NVIDIA com instaladores antigos (mais de 7 dias).', on: false, age: 7,
    paths: ['C:\\\\NVIDIA', 'C:\\\\AMD', 'C:\\\\Intel', 'C:\\\\ProgramData\\\\NVIDIA Corporation\\\\Downloader'] },
  { id: 'shaders', group: 'apps', name: 'Cache de shaders',"""
if old_cat not in s:
    raise SystemExit("categoria shaders nÃ£o encontrada")
s = s.replace(old_cat, new_cat, 1)

# 2) medição em segundo plano com progresso
start = s.find("ex.cleanScan = async () => {")
end = s.find("let tempCache = { at: 0, bytes: 0 };")
if start < 0 or end < 0:
    raise SystemExit("bloco cleanScan nÃ£o encontrado")

block = r"""// ── Medição da limpeza: roda em segundo plano, sem corte de tempo, com progresso ──
const cleanM = { at: 0, measuring: false, index: 0, total: 0, sizes: {} };

function cleanDirsOf(c) {
  if (c.steam) return steamRoot ? [path.join(steamRoot, 'appcache', 'httpcache'), path.join(steamRoot, 'logs'), path.join(steamRoot, 'dumps'), path.join(steamRoot, 'htmlcache')] : [];
  return c.paths || [];
}

async function recycleBytes() {
  const r = await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); if ($bin) { foreach ($i in $bin.Items()) { $s += $i.Size } } } catch {}; Write-Output ([int64]$s)`);
  return parseInt(r.out, 10) || 0;
}

function cleanCats() {
  return CATS.map((c) => {
    const m = cleanM.sizes[c.id];
    return {
      id: c.id, group: c.group, name: c.name, desc: c.desc, on: !!c.on,
      bytes: m ? m.bytes : 0, files: m ? m.files : 0, measured: !!m,
      open: c.procs ? processRunning(c.procs) : false,
      app: c.app, special: c.special, note: c.note,
    };
  });
}

let cleanJob = null;
async function measureClean(force) {
  if (cleanJob) return cleanJob;
  if (!force && cleanM.at && Date.now() - cleanM.at < 120000) return cleanJob;
  cleanJob = (async () => {
    cleanM.measuring = true;
    cleanM.index = 0;
    cleanM.total = CATS.length;
    cleanM.sizes = force ? {} : cleanM.sizes;
    if (!steamRoot) { try { await ex.initSteam(); } catch (e) {} }
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

ex.cleanScan = async () => {
  measureClean(false);
  return { success: true, cats: cleanCats(), measuring: cleanM.measuring, index: cleanM.index, total: cleanM.total };
};

ex.cleanStatus = async () => ({
  success: true,
  cats: cleanCats(),
  measuring: cleanM.measuring,
  index: cleanM.index,
  total: cleanM.total,
  measuredAt: cleanM.at,
});

"""
s = s[:start] + block + s[end:]

# 3) cleanRun: usa o tamanho já medido e remede depois
s = s.replace("""    const before = c.special === 'recycle'
      ? parseInt((await core.ps(`$s = 0; try { $sh = New-Object -ComObject Shell.Application; $bin = $sh.NameSpace(10); foreach ($i in $bin.Items()) { $s += $i.Size } } catch {}; Write-Output ([int64]$s)`)).out, 10) || 0
      : (await dirSizes(c.paths || [], c.age || 0)).bytes;""",
"""    const before = (cleanM.sizes[id] && cleanM.sizes[id].bytes) || (c.special === 'recycle' ? await recycleBytes() : (await dirSizes(cleanDirsOf(c), c.age || 0, 900000)).bytes);""")
s = s.replace("""  return { success: true, freed, results };""",
"""  for (const id of ids) delete cleanM.sizes[id];
  cleanM.at = 0;
  measureClean(true);
  return { success: true, freed, results };""")

io.open(p, "w", encoding="utf-8").write(s)
print("limpeza backend ok")
