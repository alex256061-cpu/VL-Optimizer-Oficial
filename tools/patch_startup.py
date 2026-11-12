import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

start = s.find("ex.startupList = async () => {")
end = s.find("// ────────────────────────────── LIMPEZA", start)
if start < 0 or end < 0:
    raise SystemExit("startup block nÃ£o encontrado")

block = r"""// Startup no formato do Windows: Run/Run32 + pastas de inicialização, e o estado real
// fica em Explorer\StartupApproved (é o que o Gerenciador de Tarefas lê e escreve).
const STORE_BY_SCOPE = {
  'user-run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'machine-run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  'machine-run32': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  'user-folder': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  'machine-folder': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
};

const IMPACT_HIGH = /onedrive|dropbox|google ?drive|icloud|steam|discord|teams|adobe|creative|spotify|epic|battle\.net|blizzard|origin|ea ?app|ubisoft|razer|logitech|msi|afterburner|corsair|wallpaper|runtime broker|securityhealth/i;
const IMPACT_LOW = /^(ctfmon|igfxtray|igfxhk|igfxpers|rundll32|systray|weather|news|widgets|realtek.*(tray|audio))/i;

function impactOf(name, cmd) {
  const n = String(name || '') + ' ' + String(cmd || '');
  if (IMPACT_LOW.test(String(name || ''))) return 'baixo';
  if (IMPACT_HIGH.test(n)) return 'alto';
  return 'medio';
}

async function approvedStates() {
  const r = await core.ps(`
    $stores = @(
      @{ id='user-run';     path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
      @{ id='user-folder';  path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder' },
      @{ id='machine-run';  path='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
      @{ id='machine-run32';path='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32' },
      @{ id='machine-folder';path='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder' }
    )
    $o = @{}
    foreach ($s in $stores) {
      $p = Get-ItemProperty -LiteralPath $s.path -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
        $first = 2
        try { $first = [int](@($_.Value)[0]) } catch {}
        $o[($s.id + '|' + $_.Name)] = $first
      }
    }
    Write-Output (Json $o)`, 60000);
  const map = {};
  if (r.ok && r.out) { try { Object.assign(map, JSON.parse(r.out)); } catch (e) {} }
  return map;
}

ex.startupList = async () => {
  const items = [];
  const approved = await approvedStates();
  const legacyDisabled = readJson('startup-disabled.json', {});
  const legacyValues = readJson('startup-values.json', {});

  for (const k of RUN_KEYS) {
    const r = await core.ps(`
      $o = @()
      $p = Get-ItemProperty -LiteralPath '${k.root}' -ErrorAction SilentlyContinue
      if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $o += @{ name = $_.Name; cmd = [string]$_.Value } } }
      Write-Output (Json $o)`);
    if (r.ok && r.out) {
      try {
        for (const v of JSON.parse(r.out)) {
          const id = k.scope + '|' + v.name;
          const appr = approved[id];
          let enabled = appr === undefined ? true : appr !== 3;
          // compat: itens desligados pela versão antiga (valor movido para um backup nosso)
          if (appr === undefined && legacyDisabled[id]) enabled = false;
          items.push({ id, name: v.name, cmd: v.cmd, scope: k.scope, enabled, impact: impactOf(v.name, v.cmd) });
        }
      } catch (e) {}
    }
  }
  for (const f of FOLDERS) {
    try {
      for (const fn of fs.readdirSync(f.dir)) {
        if (!/\.lnk$/i.test(fn)) continue;
        const id = f.scope + '|' + fn;
        const nm = fn.replace(/\.lnk$/i, '');
        const appr = approved[id];
        let enabled = appr === undefined ? true : appr !== 3;
        if (appr === undefined && legacyDisabled[id]) enabled = false;
        items.push({ id, name: nm, cmd: path.join(f.dir, fn), scope: f.scope, enabled, impact: impactOf(nm, fn) });
      }
    } catch (e) {}
  }
  return { items };
};

ex.startupSet = async ({ name, scope, enabled }) => {
  const store = STORE_BY_SCOPE[scope];
  if (!store) return { success: false, error: 'escopo inválido' };
  const id = scope + '|' + name;
  const bytes = enabled ? '2,0,0,0,0,0,0,0,0,0,0,0' : '3,0,0,0,0,0,0,0,0,0,0,0';
  const r = await core.ps(`
    $path = '${store}'
    if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
    $val = [byte[]](${bytes})
    try {
      if ($null -eq (Get-ItemProperty -LiteralPath $path -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue)) {
        New-ItemProperty -LiteralPath $path -Name '${name.replace(/'/g, "''")}' -Value $val -PropertyType Binary -Force | Out-Null
      } else {
        Set-ItemProperty -LiteralPath $path -Name '${name.replace(/'/g, "''")}' -Value $val -Force | Out-Null
      }
      Write-Output 'ok'
    } catch { Write-Output ('err:' + $_.Exception.Message) }`, 30000);
  const msg = (r.out || '').trim();
  if (!/^ok/.test(msg)) {
    const noAccess = /denied|negado|acesso/i.test(msg) || !r.ok;
    return { success: false, error: noAccess ? 'Para mexer na inicialização deste app o VL precisa de administrador.' : (msg.replace(/^err:/, '') || 'falha ao gravar') };
  }
  // compat: se o item estava desligado do jeito antigo, limpa o nosso controle
  const disabled = readJson('startup-disabled.json', {});
  const values = readJson('startup-values.json', {});
  if (disabled[id]) {
    delete disabled[id];
    writeJson('startup-disabled.json', disabled);
    if (enabled && values[id]) {
      const key = RUN_KEYS.find((k) => k.scope === scope);
      if (key) {
        const saved = values[id];
        await core.ps(`if ($null -eq (Get-Val '${key.root}' '${String(name).replace(/'/g, "''")}')) { Set-Val '${key.root}' '${String(name).replace(/'/g, "''")}' '${String(saved).replace(/'/g, "''")}' 'String' }`);
      }
    }
  }
  return { success: true, enabled: !!enabled };
};

"""
s = s[:start] + block + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print("startup reescrito")
