import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# ── appsList: guarda DisplayIcon ──
s = s.replace(
    "$o += @{ name=[string]$k.DisplayName; pub=[string]$k.Publisher; ver=[string]$k.DisplayVersion; date=[string]$k.InstallDate; un=[string]$k.UninstallString; loc=[string]$k.InstallLocation; key=[string]$k.PSChildName; noRemove=($k.NoRemove -eq 1 -or -not $k.UninstallString) }",
    "$o += @{ name=[string]$k.DisplayName; pub=[string]$k.Publisher; ver=[string]$k.DisplayVersion; date=[string]$k.InstallDate; un=[string]$k.UninstallString; loc=[string]$k.InstallLocation; key=[string]$k.PSChildName; icon=[string]$k.DisplayIcon; noRemove=($k.NoRemove -eq 1 -or -not $k.UninstallString) }",
)
s = s.replace(
    "appsCache = list.filter((a) => a && a.name).map((a, i) => ({ key: a.key || ('app' + i), name: a.name, pub: a.pub || '', ver: a.ver || '', date: (a.date || '').replace(/^(\\d{4})(\\d{2})(\\d{2})$/, '$1-$2-$3'), un: a.un || '', loc: a.loc || '', noRemove: !!a.noRemove, bytes: 0 }));",
    "appsCache = list.filter((a) => a && a.name).map((a, i) => ({ key: a.key || ('app' + i), name: a.name, pub: a.pub || '', ver: a.ver || '', date: (a.date || '').replace(/^(\\d{4})(\\d{2})(\\d{2})$/, '$1-$2-$3'), un: a.un || '', loc: a.loc || '', icon: a.icon || '', noRemove: !!a.noRemove, bytes: 0 }));",
)

# ── appsExtra: ícones reais via shell ──
old_extra = """ex.appsExtra = async () => {
  const sizes = {}, icons = {};
  try { appsCache = appsCache || (await ex.appsList()).apps; } catch (e) {}
  for (const a of appsCache || []) {
    if (a.loc && fs.existsSync(a.loc)) {
      try {
        let total = 0;
        const walk = async (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { if (x.isSymbolicLink()) continue; const p = path.join(d, x.name); if (x.isDirectory()) await walk(p, depth + 1); else if (x.isFile()) { try { total += fs.statSync(p).size; } catch (e) {} } await yieldNow(); } };
        await walk(a.loc, 0);
        sizes[a.key] = total;
      } catch (e) {}
    }
  }
  return { success: true, sizes };
};"""
new_extra = """const qq = (s) => String(s == null ? '' : s).replace(/'/g, "''");
ex.appsExtra = async () => {
  const sizes = {}, icons = {};
  try { appsCache = appsCache || (await ex.appsList()).apps; } catch (e) {}
  for (const a of appsCache || []) {
    if (a.loc && fs.existsSync(a.loc)) {
      try {
        let total = 0;
        const walk = async (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { if (x.isSymbolicLink()) continue; const p = path.join(d, x.name); if (x.isDirectory()) await walk(p, depth + 1); else if (x.isFile()) { try { total += fs.statSync(p).size; } catch (e) {} } await yieldNow(); } };
        await walk(a.loc, 0);
        sizes[a.key] = total;
      } catch (e) {}
    }
  }
  // ícone real de cada programa (o mesmo do Explorador)
  const items = [];
  for (const a of appsCache || []) {
    let p = String(a.icon || '').trim().replace(/^"|"$/g, '');
    p = p.replace(/,\\s*-?\\d+\\s*$/, '').trim();
    if (!p && a.loc) {
      try { const exes = fs.readdirSync(a.loc).filter((f) => /\\.exe$/i.test(f)); if (exes.length) p = path.join(a.loc, exes[0]); } catch (e) {}
    }
    if (p && fs.existsSync(p) && /\\.(exe|ico)$/i.test(p)) items.push({ k: a.key, p });
  }
  if (items.length) {
    const arr = items.slice(0, 120).map((i) => `@{k='${qq(i.k)}';p='${qq(i.p)}'}`).join(',');
    const r = await core.ps(`
      Add-Type -AssemblyName System.Drawing
      $items = @(${arr})
      $o = @{}
      foreach ($i in $items) {
        try {
          $ico = [System.Drawing.Icon]::ExtractAssociatedIcon([string]$i.p)
          if (-not $ico) { continue }
          $bmp = $ico.ToBitmap()
          $ms = New-Object System.IO.MemoryStream
          $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          $o[[string]$i.k] = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
          $bmp.Dispose(); $ms.Dispose()
        } catch {}
      }
      Write-Output (Json $o)`, 120000);
    if (r.ok && r.out) { try { Object.assign(icons, JSON.parse(r.out)); } catch (e) {} }
  }
  return { success: true, sizes, icons };
};"""
if old_extra not in s:
    raise SystemExit("appsExtra nÃ£o encontrado")
s = s.replace(old_extra, new_extra)

# ── appsLeftovers: pastas + chaves de registro ──
old_left = """ex.appsLeftovers = async ({ key }) => {
  const a = (appsCache || []).find((x) => x.key === key) || {};
  const exists = (await ex.appsExists(key)).exists;
  if (exists) return { success: true, stillInstalled: true, items: [] };
  const items = [];
  const dirs = [];
  if (a.loc) dirs.push(a.loc);
  const nm = String(a.name || '').replace(/[\\\\/:*?"<>|]/g, '').trim();
  for (const base of [path.join(os.homedir(), 'AppData', 'Roaming'), path.join(os.homedir(), 'AppData', 'Local'), 'C:\\\\ProgramData', 'C:\\\\Program Files', 'C:\\\\Program Files (x86)']) {
    const p = path.join(base, nm);
    if (fs.existsSync(p)) dirs.push(p);
  }
  for (const d of [...new Set(dirs)]) {
    const { bytes } = await dirSizes([d], 0);
    items.push({ id: 'dir:' + d, kind: 'dir', label: 'Pasta', path: d, bytes });
  }
  return { success: true, stillInstalled: false, items };
};"""
new_left = """ex.appsLeftovers = async ({ key }) => {
  const a = (appsCache || []).find((x) => x.key === key) || {};
  const exists = (await ex.appsExists(key)).exists;
  if (exists) return { success: true, stillInstalled: true, items: [] };
  const items = [];
  const dirs = [];
  if (a.loc) dirs.push(a.loc);
  const nm = String(a.name || '').replace(/[\\\\/:*?"<>|]/g, '').trim();
  for (const base of [path.join(os.homedir(), 'AppData', 'Roaming'), path.join(os.homedir(), 'AppData', 'Local'), 'C:\\\\ProgramData', 'C:\\\\Program Files', 'C:\\\\Program Files (x86)']) {
    const p = path.join(base, nm);
    if (fs.existsSync(p)) dirs.push(p);
  }
  for (const d of [...new Set(dirs)]) {
    const { bytes } = await dirSizes([d], 0);
    items.push({ id: 'dir:' + d, kind: 'dir', label: 'Pasta', path: d, bytes });
  }
  // chaves de registro que sobraram com o nome do programa
  const nome = String(a.name || '').trim();
  if (nome.length >= 3) {
    const r = await core.ps(`
      $nm = '${qq(nome)}'
      $o = @()
      foreach ($root in @('HKLM:\\\\SOFTWARE','HKLM:\\\\SOFTWARE\\\\WOW6432Node','HKCU:\\\\SOFTWARE')) {
        foreach ($k in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
          $n = $k.PSChildName
          if ($n -match '^(Microsoft|Windows|Classes|Policies|WOW6432Node|RegisteredApplications|Clients|Intel|AMD|NVIDIA)$') { continue }
          if ($n.Length -lt 3) { continue }
          if ($n -like "*$nm*" -or $nm -like "*$n*") { $o += @{ path=$k.Name; name=$n } }
        }
      }
      Write-Output (Json $o)`, 120000);
    if (r.ok && r.out) {
      try {
        const regs = JSON.parse(r.out);
        const list = Array.isArray(regs) ? regs : (regs ? [regs] : []);
        for (const x of list) {
          items.push({ id: 'reg:' + x.path, kind: 'reg', label: 'Chave do registro', path: x.path, bytes: 0 });
        }
      } catch (e) {}
    }
  }
  return { success: true, stillInstalled: false, items };
};"""
if old_left not in s:
    raise SystemExit("appsLeftovers nÃ£o encontrado")
s = s.replace(old_left, new_left)

# ── appsRemoveLeftovers: lixeira + backup do registro ──
old_rem = """ex.appsRemoveLeftovers = async ({ key, ids }) => {
  let trashed = 0, regs = 0, bytes = 0;
  const failed = [];
  for (const id of ids) {
    const p = String(id).replace(/^dir:/, '');
    if (fs.existsSync(p)) {
      try { bytes += (await dirSizes([p], 0)).bytes; fs.rmSync(p, { recursive: true, force: true }); trashed++; }
      catch (e) { failed.push(p); }
    }
  }
  return { success: true, trashed, bytes, regs, failed };
};"""
new_rem = """ex.appsRemoveLeftovers = async ({ key, ids }) => {
  let trashed = 0, regs = 0, bytes = 0;
  const failed = [];
  const bakDir = path.join(APP_DATA(), 'desinstalacoes');
  try { fs.mkdirSync(bakDir, { recursive: true }); } catch (e) {}
  const regPaths = [];
  for (const id of ids) {
    const raw = String(id);
    if (raw.startsWith('dir:')) {
      const p = raw.slice(4);
      if (!fs.existsSync(p)) continue;
      const { bytes: b } = await dirSizes([p], 0);
      const r = await core.ps(`Add-Type -AssemblyName Microsoft.VisualBasic; try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${qq(p)}','OnlyErrorDialogs','SendToRecycleBin'); Write-Output 'ok' } catch { Write-Output 'err' }`, 120000);
      if (r.out.trim() === 'ok') { bytes += b; trashed++; }
      else failed.push(p);
    } else if (raw.startsWith('reg:')) {
      regPaths.push(raw.slice(4));
    }
  }
  if (regPaths.length) {
    const arr = regPaths.map((r) => `'${qq(r)}'`).join(',');
    const r = await core.ps(`
      $dir = '${qq(bakDir)}'
      $n = 0
      foreach ($p in @(${arr})) {
        try {
          $safe = ($p -replace '[\\\\/:]', '_')
          $bak = Join-Path $dir ($safe + '.reg')
          reg export "$p" "$bak" /y 2>$null | Out-Null
          $ps = $p -replace '^HKEY_LOCAL_MACHINE', 'HKLM:' -replace '^HKEY_CURRENT_USER', 'HKCU:' -replace '^HKEY_CLASSES_ROOT', 'HKCR:' -replace '^HKEY_USERS', 'HKU:'
          Remove-Item -LiteralPath $ps -Recurse -Force -ErrorAction Stop
          $n++
        } catch {}
      }
      Write-Output $n`, 120000);
    regs = parseInt(r.out, 10) || 0;
  }
  return { success: true, trashed, bytes, regs, failed };
};"""
if old_rem not in s:
    raise SystemExit("appsRemoveLeftovers nÃ£o encontrado")
s = s.replace(old_rem, new_rem)

# autostart: nome da chave
s = s.replace("'LOptimizer'", "'VLOptimizer'")

io.open(p, "w", encoding="utf-8").write(s)
print("extras ok")
