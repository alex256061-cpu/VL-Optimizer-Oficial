// engine.js — motor do VL Optimizer
// Executa cada ajuste de verdade: PowerShell elevado, registro, serviços, powercfg, netsh.
// Tudo com backup: o "desfazer" restaura o valor exato que o Windows tinha antes.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let DATA_DIR = process.env.LOPT_DATA_DIR || path.join(os.tmpdir(), 'l-optimizer-data');
function setDataDir(dir) {
  DATA_DIR = dir;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  // Remove ps-*.ps1 orfaos: se o app encerra no meio de uma chamada, o callback que apagaria o
  // temporario nunca roda. Só apaga arquivos com mais de 1 minuto, para nao remover um script que
  // outra chamada acabou de criar.
  try {
    const agora = Date.now();
    for (const nome of fs.readdirSync(DATA_DIR)) {
      if (!nome.startsWith('ps-') || !nome.endsWith('.ps1')) continue;
      try {
        const p = path.join(DATA_DIR, nome);
        if (agora - fs.statSync(p).mtimeMs > 60000) fs.unlinkSync(p);
      } catch (e) {}
    }
  } catch (e) {}
}
setDataDir(DATA_DIR);

// ── PowerShell ──
const PS_LIB = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
function New-Key($p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null } }
function Get-Val($p, $n) { try { (Get-ItemProperty -LiteralPath $p -Name $n -ErrorAction Stop).$n } catch { $null } }
function Set-Val($p, $n, $v, $t) {
  New-Key $p
  $cur = Get-Val $p $n
  if ($null -eq $cur) { New-ItemProperty -LiteralPath $p -Name $n -Value $v -PropertyType $t -Force | Out-Null }
  else { Set-ItemProperty -LiteralPath $p -Name $n -Value $v -Force | Out-Null }
}
function Del-Val($p, $n) { Remove-ItemProperty -LiteralPath $p -Name $n -ErrorAction SilentlyContinue }
function Svc($n, $mode) { $s = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($s) { Set-Service -Name $n -StartupType $mode -ErrorAction SilentlyContinue; if ($mode -eq 'Disabled') { Stop-Service -Name $n -Force -ErrorAction SilentlyContinue } else { Start-Service -Name $n -ErrorAction SilentlyContinue } } }
function Json($o) { ConvertTo-Json -InputObject $o -Compress -Depth 8 }
`;

function ps(script, timeout = 90000) {
  return new Promise((resolve) => {
    let f;
    try {
      const dir = DATA_DIR;
      f = path.join(dir, 'ps-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
      fs.writeFileSync(f, '\ufeff' + PS_LIB + '\n' + script, 'utf8');
    } catch (e) {
      return resolve({ ok: false, out: '', err: String(e.message || e) });
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout,
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(f); } catch (e) {}
      resolve({ ok: !err, out: (stdout || '').toString().trim(), err: (stderr || '').toString().trim(), code: err && err.code });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Backups ──
const BACKUP_FILE = () => path.join(DATA_DIR, 'backups.json');
let backs = null;
function loadBackups() {
  if (backs) return backs;
  try { backs = JSON.parse(fs.readFileSync(BACKUP_FILE(), 'utf8')); } catch (e) { backs = {}; }
  return backs;
}
function saveBackups() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(BACKUP_FILE(), JSON.stringify(backs, null, 1), 'utf8'); } catch (e) {}
}

// Guarda o estado atual de um conjunto de chaves/serviços, uma única vez, antes de mexer.
function backupKey(key, regs = [], svcs = [], extra = {}) {
  const b = loadBackups();
  if (b[key]) return b[key];
  const state = { reg: [], svc: [], at: Date.now(), ...extra };
  for (const r of regs) state.reg.push({ path: r.path, name: r.name, exists: undefined });
  for (const s of svcs) state.svc.push({ name: s, mode: undefined });
  b[key] = state;
  saveBackups();
  return state;
}

async function psBackupState(key, regs, svcs) {
  const b = loadBackups();
  if (b[key]) return b[key];
  const st = { at: Date.now(), reg: [], svc: [] };
  const parts = [];
  regs.forEach((r, i) => {
    parts.push(`$v = $null; $e = $false; try { $v = (Get-ItemProperty -LiteralPath '${esc(r.path)}' -Name '${esc(r.name)}' -ErrorAction Stop).'${esc(r.name)}'; $e = $true } catch {}; $o.reg += @{ path='${esc(r.path)}'; name='${esc(r.name)}'; exists=$e; value=$v }`);
  });
  for (const s of svcs) parts.push(`$s = Get-Service -Name '${s}' -ErrorAction SilentlyContinue; $o.svc += @{ name='${s}'; mode=$(if ($s) { [string]$s.StartType } else { $null }); running=$(if ($s) { [bool]($s.Status -eq 'Running') } else { $false }) }`);
  const out = await ps(`$o = [ordered]@{ reg=@(); svc=@() }\n${parts.join('\n')}\nWrite-Output (Json $o)`, 60000);
  if (!out.ok) return st;
  try {
    const j = JSON.parse(out.out);
    st.reg = (j.reg || []).map((r) => ({ path: r.path, name: r.name, exists: !!r.exists, value: r.value }));
    st.svc = (j.svc || []).map((s) => ({ name: s.name, mode: s.mode, running: !!s.running }));
  } catch (e) {}
  backs = loadBackups();
  backs[key] = st;
  saveBackups();
  return st;
}
const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");

// Restaura um backup salvo.
async function restoreBackup(key) {
  const b = loadBackups();
  const st = b[key];
  if (!st) return { success: false, error: 'sem backup' };
  const lines = [];
  for (const r of st.reg) {
    if (r.exists) {
      const lit = typeof r.value === 'string' ? `'${String(r.value).replace(/'/g, "''")}'` : String(r.value);
      lines.push(`Set-Val '${r.path}' '${r.name}' ${lit} '${typeof r.value === 'number' ? 'DWord' : 'String'}'`);
    } else {
      lines.push(`Del-Val '${r.path}' '${r.name}'`);
    }
  }
  for (const s of st.svc) {
    if (!s.mode) continue;
    lines.push(`Svc '${s.name}' '${s.mode}'`);
    if (s.running) lines.push(`Start-Service -Name '${s.name}' -ErrorAction SilentlyContinue`);
  }
  const run = await ps(lines.join('\n'));
  if (st.custom && st.custom.revert) {
    const r2 = await ps(st.custom.revert);
    if (!r2.ok) return { success: false, error: r2.err || 'falha ao reverter' };
  }
  delete b[key];
  saveBackups();
  return { success: run.ok || !!st.custom, error: run.ok ? undefined : (run.err || 'falha ao restaurar') };
}

// ── Catálogo ──
// Cada item: { id, cat, title, desc, note, tags, rec, restart, reg[], svc[], on, off }
const HKCU = 'HKCU:';
const HKLM = 'HKLM:';
const ADV = HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const T = (id, o) => ({ id, ...o });

const TWEAKS = [
  // — Desempenho
  T('game-mode', { padrao: 1,
    cat: 'desempenho', title: 'Modo de Jogo ligado', rec: true, tags: ['FPS mais estável'],
    desc: 'O Windows prioriza o jogo quando você abre um: menos disputa com processos de fundo.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', type: 'DWord', on: 1, off: 1 }],
    probe: `if ((Get-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'AutoGameModeEnabled') -eq 1) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('steam-overlay', {
    cat: 'desempenho', title: 'Sobreposição da Steam desligada', tags: ['Mais FPS'],
    desc: 'A sobreposição Shift+Tab da Steam desenha por cima do jogo e custa FPS.',
    reg: [{ path: HKCU + '\\Software\\Valve\\Steam', name: 'EnableGameOverlay', type: 'DWord', on: 0, off: 1 }],
    note: 'A Steam pode reescrever ao abrir a loja; desligue também em Steam > Configurações > Na biblioteca.',
  }),
  T('bg-apps', {
    cat: 'desempenho', title: 'Apps em segundo plano desligados', tags: ['PC fraco'],
    desc: 'Apps de fábrica param de rodar escondidos e gastar CPU/RAM.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', name: 'GlobalUserDisabled', type: 'DWord', on: 1, off: 0 }],
  }),
  T('edge-bg', { rec: true,
    cat: 'desempenho', title: 'Edge sem ficar em segundo plano', tags: ['PC fraco'],
    desc: 'O Edge deixa de continuar residente depois de fechar.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Edge', name: 'BackgroundModeEnabled', type: 'DWord', on: 0, off: 1 }],
  }),
  T('dlss-ind', {
    cat: 'desempenho', title: 'Indicador do DLSS na tela', cap: 'rtx', tags: ['Só verifica'],
    desc: 'Mostra "DLSS" escrito no canto do jogo: serve para confirmar qual modelo de DLSS está rodando.',
    reg: [{ path: HKCU + '\\Software\\NVIDIA Corporation\\Global\\NGXCore', name: 'ShowDlssIndicator', type: 'DWord', on: 1, off: 0 }],
    note: 'O preset do DLSS 4.5 fica na NVIDIA App (Sobreposição/Substituição do DLSS).',
  }),
  T('dlss-rec', {
    cat: 'desempenho', title: 'DLSS no modelo recomendado pela NVIDIA', cap: 'rtx', tags: ['Imagem', 'Mais FPS'],
    desc: 'Os jogos com DLSS passam a usar a versao mais nova que o driver tem, com o modelo que a NVIDIA recomenda para cada modo: o DLSS 4.5 nos modos Desempenho e Ultra Desempenho e o DLSS 4 nos outros. E o botao Recomendado de Substituicao do DLSS na NVIDIA App. A imagem dos modos mais leves melhora, entao da para trocar Qualidade por Desempenho dentro do jogo e ganhar FPS.',
    note: 'O preset fica na NVIDIA App (Sobreposicao/Substituicao do DLSS).',
  }),
  T('gpu-msi', {
    cat: 'desempenho', title: 'MSI na placa de vídeo', tags: ['Menos atraso'],
    desc: 'Interrupções por mensagem no lugar do modo legado: menos stutter de IRQ.',
    on: `
      $gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -match '^PCI\\\\' })
      foreach ($g in $gpus) {
        $k = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + $g.PNPDeviceID + '\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties'
        if (Test-Path -LiteralPath $k) { Set-Val $k 'MSISupported' 1 'DWord' }
      }
      Write-Output 'ok'`,
    off: `
      $gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -match '^PCI\\\\' })
      foreach ($g in $gpus) {
        $k = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + $g.PNPDeviceID + '\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties'
        if (Test-Path -LiteralPath $k) { Set-Val $k 'MSISupported' 0 'DWord' }
      }
      Write-Output 'ok'`,
    probe: `Write-Output '1'`,
    restart: 'reboot',
  }),
  T('mpo', {
    cat: 'desempenho', title: 'MPO desligado (corrige piscadas)', tags: ['Estabilidade'],
    desc: 'Tira a sobreposição de planos da GPU: resolve piscada/tela preta com G-Sync e FreeSync.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\DWM', name: 'OverlayTestMode', type: 'DWord', on: 5, off: 5 }],
    note: 'Vale depois de reiniciar o PC.',
  }),
  T('transparency', {
    cat: 'desempenho', title: 'Transparência do Windows desligada', tags: ['PC fraco'],
    desc: 'Sem acrílico/blur nas janelas: alivia vídeo integrado e ganha um pouco de RAM.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', type: 'DWord', on: 0, off: 1 }],
  }),
  // — Mouse e teclado
  T('mouse-accel', {
    cat: 'inputlag', title: 'Aceleração do mouse desligada', rec: true, tags: ['Mira consistente'],
    desc: 'O ponteiro anda sempre o mesmo tanto para o mesmo movimento: mira 1:1.',
    reg: [
      { path: HKCU + '\\Control Panel\\Mouse', name: 'MouseSpeed', type: 'String', on: '0', off: '1' },
      { path: HKCU + '\\Control Panel\\Mouse', name: 'MouseThreshold1', type: 'String', on: '0', off: '6' },
      { path: HKCU + '\\Control Panel\\Mouse', name: 'MouseThreshold2', type: 'String', on: '0', off: '10' },
    ],
    on: `
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, int[] c, uint d); }'
      $arr = @(0, 0, 0)
      [M]::SystemParametersInfo(0x0004, 0, $arr, 0x01) | Out-Null
      Write-Output 'ok'`,
    probe: `if ((Get-Val '${HKCU}\\Control Panel\\Mouse' 'MouseSpeed') -eq '0') { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('kbd-repeat', { rec: true,
    cat: 'inputlag', title: 'Repetição do teclado rápida', tags: ['Resposta imediata'],
    desc: 'Sem atraso para o caractere começar a repetir.',
    reg: [
      { path: HKCU + '\\Control Panel\\Keyboard', name: 'KeyboardDelay', type: 'String', on: '0', off: '1' },
      { path: HKCU + '\\Control Panel\\Keyboard', name: 'KeyboardSpeed', type: 'String', on: '31', off: '31' },
    ],
  }),
  T('sticky', { padrao: "506", rec: true,
    cat: 'inputlag', title: 'Teclas de aderência desligadas', tags: ['Nada abrindo sozinho'],
    desc: 'Apertar Shift cinco vezes não abre mais aquela janela no meio da partida.',
    reg: [{ path: HKCU + '\\Control Panel\\Accessibility\\StickyKeys', name: 'Flags', type: 'String', on: "0", off: "506" }],
  }),
  T('numlock', {
    cat: 'inputlag', title: 'Num Lock ligado ao iniciar', tags: ['Praticidade'],
    desc: 'O teclado numérico já acorda ligado.',
    reg: [{ path: HKCU + '\\Control Panel\\Keyboard', name: 'InitialKeyboardIndicators', type: 'String', on: '2', off: '0' }],
  }),
  // — Internet
  T('delivery', { padrao: 0, rec: true,
    cat: 'live', title: 'Delivery Optimization desligado', tags: ['Internet livre'],
    desc: 'O Windows para de usar sua internet para distribuir atualizações (P2P).',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization', name: 'SystemSettingsDownloadMode', type: 'DWord', on: 0, off: 0 }],
  }),
  T('lso', {
    cat: 'live', title: 'LSO desligado (upload estável)', tags: ['Live'],
    desc: 'Corrige a live/discord caindo quando você joga: desliga o Large Send Offload da placa de rede.',
    on: `Get-NetAdapter | Disable-NetAdapterLso -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    off: `Get-NetAdapter | Enable-NetAdapterLso -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `$l = @(Get-NetAdapterLso -ErrorAction SilentlyContinue | Where-Object { $_.Enabled }); if ($l.Count -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('eee', {
    cat: 'live', title: 'EEE desligado (sem queda de cabo)', tags: ['Rede'],
    desc: 'Tira o Energy-Efficient Ethernet: acabam os picos de ping e desconexões.',
    on: `Get-NetAdapter | Set-NetAdapterAdvancedProperty -DisplayName 'Energy-Efficient Ethernet' -DisplayValue 'Disabled' -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    off: `Get-NetAdapter | Set-NetAdapterAdvancedProperty -DisplayName 'Energy-Efficient Ethernet' -DisplayValue 'Enabled' -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `$p = @(Get-NetAdapterAdvancedProperty -DisplayName 'Energy-Efficient Ethernet' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayValue -eq 'Disabled' }); if ($p.Count -gt 0) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('nic-intmod', {
    cat: 'live', title: 'Interrupt Moderation desligado', tags: ['Ping'],
    desc: 'Menos latência na placa de rede (micro-pacotes chegam na hora).',
    on: `Get-NetAdapter | Set-NetAdapterAdvancedProperty -DisplayName 'Interrupt Moderation' -RegistryValue 0 -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    off: `Get-NetAdapter | Set-NetAdapterAdvancedProperty -DisplayName 'Interrupt Moderation' -RegistryValue 1 -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `$p = @(Get-NetAdapterAdvancedProperty -DisplayName 'Interrupt Moderation' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayValue -eq 'Disabled' }); if ($p.Count -gt 0) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('hibernate', { padrao: 1, rec: true,
    cat: 'limpeza', title: 'Hibernação desligada', tags: ['Espaço em disco'],
    desc: 'Apaga o hiberfil.sys (tamanho de boa parte da sua RAM) e a inicialização rápida.',
    on: `powercfg /h off; Write-Output 'ok'`,
    off: `powercfg /h on; Write-Output 'ok'`,
    probe: `$h = Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Power' 'HibernateEnabled'; if ($null -eq $h -or $h -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  // — Windows: privacidade
  T('telemetry', {
    cat: 'tweaks', title: 'Telemetria desligada', rec: true, tags: ['Privacidade'],
    desc: 'O Windows para de enviar dados de uso/diagnóstico.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowTelemetry', type: 'DWord', on: 0, off: 1 }],
    svc: ['DiagTrack'],
  }),
  T('suggestions', {
    cat: 'tweaks', title: 'Sugestões e anúncios desligados', rec: true, tags: ['Privacidade'],
    desc: 'Sem "dicas" no menu Iniciar, no Explorador e sem ID de propaganda.',
    reg: [
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338388Enabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338389Enabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SystemPaneSuggestionsEnabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('bing', { rec: true,
    cat: 'tweaks', title: 'Pesquisa na web desligada', tags: ['Privacidade'],
    desc: 'A busca do Windows deixa de consultar a internet/Bing.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'DisableWebSearch', type: 'DWord', on: 1, off: 0 }],
  }),
  T('activity', { rec: true,
    cat: 'tweaks', title: 'Histórico de atividades desligado', tags: ['Privacidade'],
    desc: 'O Windows para de publicar e enviar o que você abriu.',
    reg: [
      { path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'PublishUserActivities', type: 'DWord', on: 0, off: 1 },
      { path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'UploadUserActivities', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('widgets', { padrao: 0,
    cat: 'tweaks', title: 'Widgets (notícias e clima) desligados', rec: true, tags: ['Mais FPS'],
    desc: 'O painel de notícias sai da barra e deixa de carregar em segundo plano.',
    reg: [{ path: ADV, name: 'TaskbarDa', type: 'DWord', on: 0, off: 1 }],
    restart: 'reboot',
  }),
  T('location', {
    cat: 'tweaks', title: 'Localização desligada', tags: ['Privacidade'],
    desc: 'Apps param de conseguir sua posição.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\LocationAndSensors', name: 'DisableLocation', type: 'DWord', on: 1, off: 0 }],
  }),
  // — Windows: praticidade
  T('end-task', { premium: true, rec: true,
    cat: 'tweaks', title: 'Encerrar tarefa no botão direito', tags: ['Praticidade'],
    desc: 'Botão "Finalizar tarefa" direto no menu da barra de tarefas.',
    reg: [{ path: ADV, name: 'TaskbarEndTask', type: 'DWord', on: 1, off: 0 }],
  }),
  T('file-ext', { rec: true,
    cat: 'tweaks', title: 'Mostrar extensões de arquivo', tags: ['Praticidade'],
    desc: 'Vê .exe, .jpg e afins no nome, sem esconder nada.',
    reg: [{ path: ADV, name: 'HideFileExt', type: 'DWord', on: 0, off: 1 }],
  }),
  T('hidden-files', {
    cat: 'tweaks', title: 'Mostrar arquivos ocultos', tags: ['Praticidade'],
    desc: 'Arquivos ocultos e de sistema aparecem no Explorador.',
    reg: [{ path: ADV, name: 'Hidden', type: 'DWord', on: 1, off: 2 }],
  }),
  T('this-pc', {
    cat: 'tweaks', title: 'Explorador abre em Este PC', tags: ['Praticidade'],
    desc: 'O Explorador começa em Este PC, não em Acesso rápido.',
    reg: [{ path: ADV, name: 'LaunchTo', type: 'DWord', on: 1, off: 2 }],
  }),
  T('classic-menu', { premium: true,
    cat: 'tweaks', title: 'Menu de contexto clássico', restart: 'explorer', tags: ['Praticidade'],
    desc: 'O botão direito volta a mostrar todas as opções de uma vez (Windows 11).',
    reg: [],
    on: `New-Key '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32'; Set-ItemProperty -LiteralPath '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32' -Name '(default)' -Value '' -Force; Write-Output 'ok'`,
    off: `Remove-Item -Path '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}' -Recurse -Force -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `if (Test-Path '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}') { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('dark', {
    cat: 'tweaks', title: 'Modo escuro no Windows', tags: ['Aparência'],
    desc: 'Apps e sistema em tema escuro.',
    reg: [
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'AppsUseLightTheme', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'SystemUsesLightTheme', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('task-view', {
    cat: 'tweaks', title: 'Botão Visão de Tarefas escondido', tags: ['Aparência'],
    desc: 'Tira o botão de visão de tarefas da barra.',
    reg: [{ path: ADV, name: 'ShowTaskViewButton', type: 'DWord', on: 0, off: 1 }],
  }),
  T('taskbar-left', { premium: true,
    cat: 'tweaks', title: 'Barra de tarefas à esquerda', tags: ['Visual'],
    desc: 'Botão Iniciar e ícones no canto esquerdo, como no Windows 10.',
    note: 'Só existe no Windows 11.',
    cap: 'win11',
    reg: [{ path: ADV, name: 'TaskbarAl', type: 'DWord', on: 0, off: 1 }],
  }),
  T('search-icon', {
    cat: 'tweaks', title: 'Busca só com ícone', tags: ['Aparência'],
    desc: 'A busca vira um ícone discreto na barra.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Search', name: 'SearchboxTaskbarMode', type: 'DWord', on: 1, off: 2 }],
  }),
  T('bsod-detail', {
    cat: 'tweaks', title: 'Tela azul com mais detalhes', tags: ['Diagnóstico'],
    desc: 'A tela azul mostra o código de parada em vez do texto genérico.',
    reg: [{ path: HKLM + '\\SYSTEM\\CurrentControlSet\\Control\\CrashControl', name: 'DisplayParameters', type: 'DWord', on: 1, off: 0 }],
  }),
];

const tweakById = (id) => TWEAKS.find((t) => t.id === id);
const tweakRegs = (t) => (t.reg || []).filter((r) => r.type !== undefined && r.on !== undefined);

// ── Ações com backup ──
const ACTIONS = {
  'Plano de Alta Performance': {
    tag: 'desempenho', rec: true, restart: 'reboot',
    title: 'Plano de energia Alto Desempenho',
    desc: 'O processador não baixa a velocidade para economizar energia: menos travadinhas e FPS mínimo mais alto.',
    note: 'Gasta um pouco mais de energia.',
    run: `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; Write-Output 'ok'`,
    detect: `$g = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value; Write-Output $g`,
    revert: `powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e; Write-Output 'ok'`,
  },
  'Modo Máximo Desempenho': {
    tag: 'desempenho', restart: 'reboot',
    title: 'Plano de energia Desempenho Máximo',
    desc: 'Versão mais forte do Alto Desempenho: tira a economia de energia do disco, do USB e da placa de rede.',
    note: 'Mais consumo e temperatura. Indicado só para PC de mesa.',
    run: `
      $p = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value
      Set-Content -Path (Join-Path $env:TEMP 'lopt-power.bak') -Value $p -Encoding ascii
      $u = powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null
      if ($u) { $u = [regex]::Match($u, '[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}').Value; powercfg /setactive $u }
      Write-Output 'ok'`,
    detect: `powercfg /list | Select-String -Pattern 'e9a42b02-d5df-448d-aa00-03f14749eb61' | Out-String | ForEach-Object { if ($_ -match '\\*') { 'active' } }`,
    revert: `
      $f = Join-Path $env:TEMP 'lopt-power.bak'
      if (Test-Path $f) { $g = (Get-Content $f -Raw).Trim(); if ($g) { powercfg /setactive $g } }
      Write-Output 'ok'`,
  },
  'Modo X3D Correto': {
    tag: 'desempenho', cap: 'x3dDual', rec: true,
    title: 'Modo certo para Ryzen X3D',
    desc: 'Para Ryzen 7900X3D, 7950X3D, 9900X3D e 9950X3D: plano Equilibrado, Modo de Jogo e Game Bar ligados.',
    run: `
      powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e
      Set-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'AutoGameModeEnabled' 1 'DWord'
      Set-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'UseNexusForGameBarEnabled' 1 'DWord'
      Write-Output 'ok'`,
    detect: `$g = (powercfg /getactivescheme | Out-String); $gm = Get-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'AutoGameModeEnabled'; if ($g -match '381b4222-f694-41f0-9685-ff5bb260df2e' -and $gm -eq 1) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; Write-Output 'ok'`,
  },
  'DVR Desativado': {
    tag: 'desempenho', rec: true, title: 'Sem gravação em segundo plano',
    desc: 'Desliga a gravação automática do Xbox Game Bar, que filma os últimos minutos e ocupa a placa de vídeo o tempo todo.',
    regs: [
      { path: HKCU + '\\System\\GameConfigStore', name: 'GameDVR_Enabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', type: 'DWord', on: 0, off: 1 },
    ],
    detect: `if ((Get-Val '${HKCU}\\System\\GameConfigStore' 'GameDVR_Enabled') -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKCU}\\System\\GameConfigStore' 'GameDVR_Enabled' 1 'DWord'; Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' 'AppCaptureEnabled' 1 'DWord'; Write-Output 'ok'`,
  },
  'Game Bar Desativado': {
    tag: 'desempenho', rec: true, title: 'Game Bar (Win+G) desligada',
    desc: 'A tela do Xbox Game Bar para de abrir por cima do jogo e de ficar carregada em segundo plano. O app continua instalado.',
    regs: [{ path: HKCU + '\\Software\\Microsoft\\GameBar', name: 'UseNexusForGameBarEnabled', type: 'DWord', on: 0, off: 1 }],
    detect: `if ((Get-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'UseNexusForGameBarEnabled') -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'UseNexusForGameBarEnabled' 1 'DWord'; Write-Output 'ok'`,
  },
  'Sem Reinício Durante o Jogo': {
    tag: 'desempenho', rec: true, title: 'Windows não reinicia sozinho',
    desc: 'As atualizações de segurança continuam chegando, mas o PC só reinicia quando você mandar.',
    regs: [
      { path: HKLM + '\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings', name: 'ActiveHoursStart', type: 'DWord', on: 0, off: 0 },
      { path: HKLM + '\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings', name: 'ActiveHoursEnd', type: 'DWord', on: 23, off: 23 },
    ],
    detect: `$h = Get-Val '${HKLM}\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' 'ActiveHoursEnd'; if ($null -ne $h -and [int]$h -ge 0) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Del-Val '${HKLM}\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' 'ActiveHoursStart'; Del-Val '${HKLM}\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' 'ActiveHoursEnd'; Write-Output 'ok'`,
  },
  'Desativar Notificações': {
    tag: 'desempenho', title: 'Sem notificações do Windows',
    desc: 'Os avisos que sobem no canto da tela param de aparecer.',
    note: 'Vale o tempo todo: você deixa de ver os avisos também fora do jogo.',
    regs: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', name: 'ToastEnabled', type: 'DWord', on: 0, off: 1 }],
    detect: `if ((Get-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' 'ToastEnabled') -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' 'ToastEnabled' 1 'DWord'; Write-Output 'ok'`,
  },
  'HAGS Ativo': {
    tag: 'desempenho', rec: true, restart: 'reboot', title: 'Agendamento de GPU por hardware (HAGS)',
    desc: 'A placa de vídeo organiza a fila de quadros, tirando trabalho do processador. Obrigatório para o DLSS Frame Generation.',
    regs: [{ path: HKLM + '\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode', type: 'DWord', on: 2, off: 1 }],
    detect: `if ((Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'HwSchMode') -eq 2) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'HwSchMode' 1 'DWord'; Write-Output 'ok'`,
  },
  'Jogos em Janela Otimizados': { premium: true,
    tag: 'desempenho', rec: true, title: 'Jogos em janela e sem bordas otimizados',
    desc: 'Jogos em janela ou tela cheia sem bordas passam a usar a apresentação moderna: menos atraso, G-Sync/FreeSync e Auto HDR.',
    regs: [{ path: HKCU + '\\Software\\Microsoft\\DirectX\\GraphicsSettings', name: 'SwapEffectUpgradeEnable', type: 'DWord', on: 1, off: 0 }],
    detect: `if ((Get-Val '${HKCU}\\Software\\Microsoft\\DirectX\\GraphicsSettings' 'SwapEffectUpgradeEnable') -eq 1) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKCU}\\Software\\Microsoft\\DirectX\\GraphicsSettings' 'SwapEffectUpgradeEnable' 0 'DWord'; Write-Output 'ok'`,
  },
  'Efeitos Visuais Off': {
    tag: 'desempenho', title: 'Sem efeitos visuais do Windows',
    desc: 'Tira sombras e animações de janelas e menus. Ajuda em PC com vídeo integrado ou pouca memória.',
    note: 'O Windows fica com a cara mais simples.',
    regs: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', name: 'VisualFXSetting', type: 'DWord', on: 2, off: 0 }],
    detect: `if ((Get-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' 'VisualFXSetting') -eq 2) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' 'VisualFXSetting' 0 'DWord'; Write-Output 'ok'`,
  },
  'SysMain Desativado': {
    tag: 'desempenho', title: 'SysMain (Superfetch) desligado',
    desc: 'O Windows para de pré-carregar na memória os programas que você mais usa. Ajuda em PC com HD e 8 GB ou menos.',
    note: 'Com SSD o ganho é quase zero, e os programas podem abrir um pouco mais devagar.',
    svcs: ['SysMain'],
    detect: `if ((Get-Service -Name 'SysMain' -ErrorAction SilentlyContinue).StartType -eq 'Disabled') { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Svc 'SysMain' 'Automatic'; Write-Output 'ok'`,
  },
  'Indexação Off': {
    tag: 'desempenho', title: 'Indexação de arquivos desligada',
    desc: 'O Windows para de ler o disco o tempo todo para montar o índice da pesquisa. Alivia HDs lentos.',
    note: 'A pesquisa de arquivos do Windows fica bem mais lenta.',
    svcs: ['WSearch'],
    detect: `if ((Get-Service -Name 'WSearch' -ErrorAction SilentlyContinue).StartType -eq 'Disabled') { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Svc 'WSearch' 'Automatic'; Write-Output 'ok'`,
  },
  'Serviços Desativados': {
    tag: 'desempenho', title: 'Serviços pouco usados desligados',
    desc: 'Desliga impressão, fax, registro remoto, mapas offline e leitor de digital.',
    note: 'Não use se você tem impressora ou entra no Windows pela digital.',
    svcs: ['Spooler', 'Fax', 'RemoteRegistry', 'MapsBroker', 'WbioSrvc'],
    detect: `$all = @('Spooler','Fax','RemoteRegistry','MapsBroker','WbioSrvc'); $d = 0; foreach ($n in $all) { $s = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($s -and $s.StartType -eq 'Disabled') { $d++ } }; if ($d -ge 4) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Svc 'Spooler' 'Automatic'; Svc 'Fax' 'Manual'; Svc 'RemoteRegistry' 'Disabled'; Svc 'MapsBroker' 'Automatic'; Svc 'WbioSrvc' 'Manual'; Write-Output 'ok'`,
  },
  'Serviços Xbox Desativados': {
    tag: 'desempenho', title: 'Serviços do Xbox desligados',
    desc: 'Desliga o login e a sincronização de saves do Xbox. Controles do Xbox continuam funcionando.',
    note: 'Jogos do Game Pass, Forza e Minecraft Bedrock deixam de abrir.',
    svcs: ['XblAuthManager', 'XblGameSave', 'XboxGipSvc', 'XboxNetApiSvc'],
    detect: `$all = @('XblAuthManager','XblGameSave','XboxGipSvc','XboxNetApiSvc'); $d = 0; foreach ($n in $all) { $s = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($s -and $s.StartType -eq 'Disabled') { $d++ } }; if ($d -ge 3) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Svc 'XblAuthManager' 'Manual'; Svc 'XblGameSave' 'Manual'; Svc 'XboxGipSvc' 'Manual'; Svc 'XboxNetApiSvc' 'Manual'; Write-Output 'ok'`,
  },
  'Game Bar Removido': {
    tag: 'desempenho', title: 'Xbox Game Bar desinstalado',
    desc: 'Remove o Game Bar (Win+G) e o aviso "ms-gamingoverlay" que aparece sem ele.',
    run: `
      $p = @(Get-AppxPackage -Name '*XboxGamingOverlay*' -ErrorAction SilentlyContinue)
      foreach ($x in $p) { Remove-AppxPackage -Package $x.PackageFullName -ErrorAction SilentlyContinue }
      Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\GameBar' 'UseNexusForGameBarEnabled' 0 'DWord'
      Write-Output 'ok'`,
    detect: `if (-not (Get-AppxPackage -Name '*XboxGamingOverlay*' -ErrorAction SilentlyContinue)) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `
      Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\GameBar' 'UseNexusForGameBarEnabled' 1 'DWord'
      $winget = Get-Command winget -ErrorAction SilentlyContinue
      if ($winget) { winget install --id 9NZKPSTSNW4P --accept-source-agreements --accept-package-agreements --silent 2>$null | Out-Null }
      Write-Output 'ok'`,
  },
  '720p Boost Ativo': {
    tag: 'desempenho', title: 'Tela em 720p (emergência)',
    desc: 'Baixa a resolução do Windows para 1280x720 para a placa de vídeo aguentar. Volta ao desligar ou ao reiniciar o PC.',
    note: 'Tudo fica maior e menos nítido. Prefira baixar a resolução dentro do jogo.',
    run: `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class D { [StructLayout(LayoutKind.Sequential)] public struct DM { public int a; public int b; public int c; public int d; public int w; public int h; };
 [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DM d, int f);
 [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string n, int m, ref DM d); }
'@
      $dm = New-Object D+DM
      [D]::EnumDisplaySettings($null, -1, [ref]$dm) | Out-Null
      Set-Content -Path (Join-Path $env:TEMP 'lopt-res.bak') -Value ("$($dm.w)x$($dm.h)") -Encoding ascii
      $dm.w = 1280; $dm.h = 720
      [D]::ChangeDisplaySettings([ref]$dm, 0) | Out-Null
      Write-Output 'ok'`,
    detect: `Write-Output '0'`,
    revert: `
      $f = Join-Path $env:TEMP 'lopt-res.bak'
      if (Test-Path $f) {
        $v = (Get-Content $f -Raw).Trim(); $p = $v.Split('x')
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class D2 { [StructLayout(LayoutKind.Sequential)] public struct DM { public int a; public int b; public int c; public int d; public int w; public int h; };
 [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DM d, int f);
 [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string n, int m, ref DM d); }
'@
        $dm = New-Object D2+DM
        [D2]::EnumDisplaySettings($null, -1, [ref]$dm) | Out-Null
        $dm.w = [int]$p[0]; $dm.h = [int]$p[1]
        [D2]::ChangeDisplaySettings([ref]$dm, 0) | Out-Null
      }
      Write-Output 'ok'`,
  },
  'OBS Prioritário': {
    tag: 'live', rec: true, cap: 'obs', title: 'OBS com prioridade',
    desc: 'Abre o OBS como administrador (assim ele reserva placa de vídeo e acaba o "lag de codificação") e impede o Windows de jogá-lo para núcleos lentos.',
    note: 'O Windows vai pedir confirmação toda vez que o OBS abrir.',
    run: `
      $p = Get-Val '${HKLM}\\SOFTWARE\\OBS Studio' '(default)'
      if (-not $p) { $p = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' }
      if (Test-Path $p) { Set-Val '${HKCU}\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' $p '~ RUNASADMIN' 'String'; Write-Output 'ok' } else { Write-Output 'noobs' }`,
    detect: `$p = Get-Val '${HKLM}\\SOFTWARE\\OBS Studio' '(default)'; if (-not $p) { $p = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' }; $v = Get-Val '${HKCU}\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' $p; if ($v -match 'RUNASADMIN') { Write-Output '1' } else { Write-Output '0' }`,
    revert: `$p = Get-Val '${HKLM}\\SOFTWARE\\OBS Studio' '(default)'; if (-not $p) { $p = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' }; Del-Val '${HKCU}\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers' $p; Write-Output 'ok'`,
  },
  'Pagefile Automático': {
    tag: 'memoria', rec: true, restart: 'reboot', title: 'Memória virtual gerenciada pelo Windows',
    desc: 'Volta o arquivo de paginação para o automático. Otimizadores que desligam ou fixam esse arquivo fazem jogos pesados, como o GTA, fecharem do nada.',
    regs: [{ path: HKLM + '\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'PagingFiles', type: 'String', on: '', off: null }],
    detect: `$v = Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'PagingFiles'; $auto = $false; if ($null -eq $v -or [string]$v -eq '') { $auto = $true } elseif (-not ([string]$v -match '^\\s*\\d+\\s+\\d+\\s')) { $auto = $true }; if ($auto) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `Write-Output 'ok'`,
  },
};

const ACTION_NAMES = Object.keys(ACTIONS);

// Ações "uma vez" (sem desfazer) e ferramentas
const ONCES = {
  'Otimização Rápida': {
    tag: 'desempenho', title: 'Otimização Rápida', btn: 'Otimizar',
    desc: 'Aplica de uma vez: plano Alto Desempenho, Modo de Jogo, gravação em segundo plano desligada e aceleração do mouse desligada.',
    run: `
      powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
      Set-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'AutoGameModeEnabled' 1 'DWord'
      Set-Val '${HKCU}\\System\\GameConfigStore' 'GameDVR_Enabled' 0 'DWord'
      Set-Val '${HKCU}\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' 'AppCaptureEnabled' 0 'DWord'
      Set-Val '${HKCU}\\Control Panel\\Mouse' 'MouseSpeed' '0' 'String'
      Set-Val '${HKCU}\\Control Panel\\Mouse' 'MouseThreshold1' '0' 'String'
      Set-Val '${HKCU}\\Control Panel\\Mouse' 'MouseThreshold2' '0' 'String'
      Write-Output 'ok'`,
  },
  'UWP Removidos': {
    tag: 'desempenho', title: 'Remover apps que vêm com o Windows', btn: 'Remover',
    desc: 'Desinstala Cortana, Clima, Mapas, Filmes e TV, Your Phone, apps do Xbox e outros apps de fábrica.',
    note: 'Não tem desfazer: para ter algum de volta, reinstale pela Microsoft Store.',
    confirm: true,
    run: `
      $apps = @('*Microsoft.549981C3F5F10*','*Microsoft.BingWeather*','*Microsoft.WindowsMaps*','*Microsoft.ZuneVideo*','*Microsoft.YourPhone*','*Microsoft.XboxGamingOverlay*','*Microsoft.XboxApp*','*Microsoft.GetHelp*','*Microsoft.Getstarted*','*Microsoft.MicrosoftSolitaireCollection*')
      $n = 0
      foreach ($a in $apps) { foreach ($x in @(Get-AppxPackage -Name $a -ErrorAction SilentlyContinue)) { Remove-AppxPackage -Package $x.PackageFullName -ErrorAction SilentlyContinue; $n++ } }
      Write-Output "removed=$n"`,
  },
  'Chrome/Discord Limitados': {
    tag: 'desempenho', title: 'Chrome e Discord em prioridade baixa', btn: 'Aplicar',
    desc: 'Quando o processador ficar disputado, o jogo tem a vez. Os dois continuam funcionando normalmente.',
    run: `
      foreach ($n in @('chrome','discord')) { foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) { try { $p.PriorityClass = 'BelowNormal' } catch {} } }
      Write-Output 'ok'`,
  },
  'Apps de Sincronização Fechados': {
    tag: 'desempenho', title: 'Fechar OneDrive, Dropbox e Google Drive', btn: 'Fechar',
    desc: 'Fecha os apps de nuvem para não usarem disco e internet durante o jogo. Voltam a abrir na próxima vez que você ligar o PC.',
    run: `foreach ($n in @('OneDrive','Dropbox','GoogleDriveFS')) { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }; Write-Output 'ok'`,
  },
  'Explorer Mínimo': {
    tag: 'tweaks', title: 'Reiniciar a barra de tarefas', btn: 'Reiniciar',
    desc: 'Reinicia o Explorador do Windows. Resolve barra de tarefas ou Iniciar travados. Não muda o FPS.',
    run: `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; Start-Process explorer; Write-Output 'ok'`,
  },
  'Padrões Restaurados': {
    tag: 'tweaks', title: 'Limpar ajustes antigos do L', btn: 'Limpar',
    desc: 'Volta ao padrão do Windows ajustes sem efeito ou prejudiciais de versões antigas (timer, fila do mouse, rede).',
    run: `
      Set-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'LargeSystemCache' 0 'DWord'
      Del-Val '${HKCU}\\Control Panel\\Mouse' 'MouseSensitivity'
      Del-Val '${HKCU}\\Control Panel\\Mouse' 'SmoothMouseXCurve'
      Del-Val '${HKCU}\\Control Panel\\Mouse' 'SmoothMouseYCurve'
      Write-Output 'ok'`,
  },
  'Defender Off': {
    tag: 'tweaks', title: 'Religar o Windows Defender', btn: 'Religar',
    desc: 'Religa a proteção em tempo real, se uma versão antiga do VL a desligou.',
    run: `Set-MpPreference -DisableRealtimeMonitoring $false -ErrorAction SilentlyContinue; Set-Val '${HKLM}\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection' 'DisableRealtimeMonitoring' 0 'DWord'; Write-Output 'ok'`,
  },
  'Desativar Atualizações Windows': {
    tag: 'tweaks', title: 'Religar o Windows Update', btn: 'Religar',
    desc: 'Religa o serviço de atualizações, se uma versão antiga do VL o desativou.',
    run: `Svc 'wuauserv' 'Manual'; Set-Service -Name 'wuauserv' -StartupType Manual -ErrorAction SilentlyContinue; Start-Service 'wuauserv' -ErrorAction SilentlyContinue; Write-Output 'ok'`,
  },
  'System Restore Off': {
    tag: 'tweaks', title: 'Religar a Restauração do Sistema', btn: 'Religar',
    desc: 'Volta a criar pontos de restauração, se uma versão antiga do VL os desligou.',
    run: `Del-Val '${HKLM}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore' 'SystemRestorePointCreationFrequency'; Enable-ComputerRestore -Drive 'C:\\' -ErrorAction SilentlyContinue; Write-Output 'ok'`,
  },
  'DPI Scaling Off': {
    tag: 'tweaks', title: 'Consertar a escala da tela', btn: 'Consertar',
    desc: 'Desfaz o antigo "Desativar DPI Scaling", que deixava textos e janelas minúsculos em telas grandes.',
    run: `Set-Val '${HKCU}\\Control Panel\\Desktop' 'Win8DpiScaling' 0 'DWord'; Del-Val '${HKCU}\\Control Panel\\Desktop' 'LogPixels'; Write-Output 'ok'`,
  },
};

const TOOLS = {
  'flush-dns': { title: 'Limpar cache de DNS', btn: 'Limpar', desc: 'Resolve site ou servidor de jogo que "não abre" depois de mudar de rede ou de DNS. Instantâneo.', run: `Clear-DnsClientCache; Write-Output 'ok'` },
  'net-reset': { title: 'Resetar a rede', btn: 'Resetar', desc: 'Refaz as configurações de rede do Windows (Winsock e TCP/IP). Use quando a internet funciona no celular mas não no PC.', note: 'Apaga IP fixo e pode desconfigurar VPNs. Reinicie o PC depois.', confirm: true, run: `netsh winsock reset 2>&1 | Out-Null; netsh int ip reset 2>&1 | Out-Null; Write-Output 'ok'` },
  'update-cleanup': { title: 'Limpar sobras do Windows Update', btn: 'Limpar', time: 'Leva de 5 a 20 minutos', desc: 'Apaga versões antigas de arquivos do sistema que as atualizações deixam para trás. Costuma liberar alguns GB no disco C:', run: `Dism /Online /Cleanup-Image /StartComponentCleanup 2>&1 | Select-Object -Last 2 | Out-String`, long: true },
  'repair': { title: 'Reparar arquivos do Windows', btn: 'Reparar', time: 'Leva de 15 a 40 minutos', desc: 'Roda o DISM e o SFC: verificam e consertam arquivos do Windows corrompidos.', confirm: true, run: `Dism /Online /Cleanup-Image /RestoreHealth 2>&1 | Select-Object -Last 2 | Out-String; sfc /scannow 2>&1 | Select-Object -Last 2 | Out-String`, long: true },
  'restore-point': { title: 'Criar ponto de restauração', btn: 'Criar ponto', desc: 'Todo ajuste do VL já tem volta. O ponto de restauração é uma garantia extra do próprio Windows.', run: `Enable-ComputerRestore -Drive 'C:\\' -ErrorAction SilentlyContinue; Checkpoint-Computer -Description 'VL Optimizer' -RestorePointType 'MODIFY_SETTINGS' 2>&1 | Out-Null; Write-Output 'ok'`, long: true },
};

// ── DNS ──
const DNS_OPTS = {
  auto: null,
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
  quad9: ['9.9.9.9', '149.112.112.112'],
  adguard: ['94.140.14.14', '94.140.15.15'],
};

async function getDns() {
  const r = await ps(`
    $act = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    $ifs = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 -and ($act.Count -eq 0 -or $act -contains $_.InterfaceIndex) })
    if ($ifs.Count -eq 0) { Write-Output 'auto'; exit }
    $a = ($ifs[0].ServerAddresses | Sort-Object) -join ','
    $map = @{ '1.1.1.1,1.0.0.1'='cloudflare'; '8.8.8.8,8.8.4.4'='google'; '9.9.9.9,149.112.112.112'='quad9'; '94.140.14.14,94.140.15.15'='adguard' }
    if ($map.ContainsKey($a)) { Write-Output $map[$a] } else { Write-Output 'custom' }`);
  return r.ok ? (r.out.split('\n')[0].trim() || 'auto') : 'auto';
}

async function setDns(provider) {
  const srv = DNS_OPTS[provider];
  if (!provider || !DNS_OPTS.hasOwnProperty(provider)) return { success: false, error: 'DNS inválido' };
  if (srv === null) {
    const r = await ps(`
      $idx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
      if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
      foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ResetServerAddresses -ErrorAction SilentlyContinue }
      Write-Output 'ok'`);
    return { success: r.ok, dns: 'auto' };
  }
  const list = srv.map((s) => `'${s}'`).join(',');
  const r = await ps(`
    $idx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
    foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ServerAddresses ${list} -ErrorAction SilentlyContinue }
    Write-Output 'ok'`);
  return { success: r.ok, dns: provider };
}

// ── Capacidades do PC ──
async function getCaps() {
  const script = `
    $cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
    $cpu = (Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0').ProcessorNameString
    $n = [string]$cpu
    $vendor = if ($n -match 'AMD') { 'amd' } elseif ($n -match 'Intel') { 'intel' } else { 'other' }
    $x3d = ($n -match 'X3D')
    $x3dDual = ($n -match '79(0|5)0X3D' -or $n -match '99(0|5)0X3D' -or $n -match '79[05]0X3D')
    $hybrid = ($n -match 'Core Ultra' -or $n -match '1[2-4][0-9]00' -or $n -match 'i[3579]-1[2-4]')
    $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; integrated = ($_.Name -match 'Intel|AMD Radeon\\(TM\\)|Vega|UHD'); nvidia = ($_.Name -match 'NVIDIA'); amd = ($_.Name -match 'Radeon') } })
    $nv = @($gpus | Where-Object { $_.nvidia }).Count -gt 0
    $amdGpu = @($gpus | Where-Object { $_.amd -and -not $_.integrated }).Count -gt 0
    $rtx = @($gpus | Where-Object { $_.nvidia -and $_.name -match 'RTX' }).Count -gt 0
    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    $obs = "$env:ProgramFiles\\obs-studio\\bin\\64bit\\obs64.exe"
    $o = [ordered]@{ cpuName = $n; cpuVendor = $vendor; x3d = $x3d; x3dDual = $x3dDual; intelHybrid = $hybrid; nvidia = $nv; amdGpu = $amdGpu; rtx = $rtx; laptop = [bool]$bat; gpus = $gpus; obsExe = (Test-Path $obs); build = [int]$cv.CurrentBuildNumber; ubr = [int]$cv.UBR }
    Write-Output (Json $o)`;
  const r = await ps(script, 60000);
  let caps = { cpuVendor: 'other', nvidia: false, amdGpu: false, rtx: false, laptop: false, gpus: [], x3d: false, x3dDual: false, intelHybrid: false, obsExe: false };
  if (r.ok && r.out) { try { Object.assign(caps, JSON.parse(r.out)); } catch (e) {} }
  return caps;
}

// ── Status dos ajustes ──
async function probeTweak(t) {
  if (t.probe) { const r = await ps(t.probe); return r.ok && r.out.trim().endsWith('1'); }
  const regs = tweakRegs(t);
  if (!regs.length) return false;
    const padraoT = (t.padrao !== undefined) ? String(t.padrao).replace(/'/g, "''") : null;
  const parts = regs.map((r) => {
    const alvo = String(r.on).replace(/'/g, "''");
    if (padraoT !== null) {
      return `$v = Get-Val '${r.path}' '${r.name.replace(/'/g, "''")}'; if ($null -eq $v) { $v = '${padraoT}' }; if ([string]$v -eq '${alvo}') { $c++ }`;
    }
    return `$v = Get-Val '${r.path}' '${r.name.replace(/'/g, "''")}'; if ($null -ne $v -and [string]$v -eq '${alvo}') { $c++ }`;
  });
  const r = await ps(`$c = 0\n${parts.join('\n')}\nWrite-Output $c`);
  const n = parseInt(r.out, 10) || 0;
  return n >= regs.length;
}

async function tweaksStatus() {
    // getDns roda em paralelo com a leitura dos ajustes: nao ha dependencia entre eles.
  const dnsPromessa = getDns().catch(() => 'auto');
const caps = await getCaps();
  const regItems = TWEAKS.filter((t) => tweakRegs(t).length);
  const customItems = TWEAKS.filter((t) => !tweakRegs(t).length);
  const on = {};
  if (regItems.length) {
    const parts = regItems.map((t) => {
      const regs = tweakRegs(t);
      // quando o tweak declara um valor padrao e o registro nao existe, o Windows assume esse
      // padrao. Sem isso, AutoGameModeEnabled ausente (que significa Modo de Jogo LIGADO) contava
      // como desligado.
      const padraoT = (t.padrao !== undefined) ? String(t.padrao).replace(/'/g, "''") : null;
      const cond = regs.map((r) => {
        const alvo = String(r.on).replace(/'/g, "''");
        if (padraoT !== null) {
          return `$v = Get-Val '${esc(r.path)}' '${esc(r.name)}'; if ($null -eq $v) { $v = '${padraoT}' }; if ([string]$v -eq '${alvo}') { $ok++ }`;
        }
        return `$v = Get-Val '${esc(r.path)}' '${esc(r.name)}'; if ($null -ne $v -and [string]$v -eq '${alvo}') { $ok++ }`;
      }).join('\n');
      return `$ok = 0\n${cond}\n$out['${t.id}'] = ($ok -ge ${regs.length})`;
    });
    const r = await ps(`$out = @{}\n${parts.join('\n')}\nWrite-Output (Json $out)`, 120000);
    if (r.ok && r.out) { try { Object.assign(on, JSON.parse(r.out)); } catch (e) {} }
  }
  // Todos os probe num PowerShell so. Antes era um processo por item (8 itens), e cada
  // powershell.exe custa ~120 ms apenas para iniciar.
  const comProbe = customItems.filter((t) => t.probe);
  const semProbe = customItems.filter((t) => !t.probe);
  semProbe.forEach((t) => { on[t.id] = false; });
  if (comProbe.length) {
    const blocos = comProbe.map((t, idx) => {
      const seguro = String(t.probe).replace(/\r?\n/g, ' ');
      return `$__probes['${idx}'] = @( ${seguro} ) -join ' '`;
    });
    const scriptP = `$__probes = @{}
${blocos.join('\n')}
Write-Output (Json $__probes)`;
    const rp = await ps(scriptP, 120000);
    if (rp.ok && rp.out) {
      let vals = null;
      try { vals = JSON.parse(rp.out); } catch (e) { vals = null; }
      comProbe.forEach((t, idx) => {
        const s = vals && vals[String(idx)] != null ? String(vals[String(idx)]).trim() : '';
        on[t.id] = s.endsWith('1');
      });
    } else {
      comProbe.forEach((t) => { on[t.id] = false; });
    }
  }
  const out = TWEAKS.map((t) => ({
    id: t.id, title: t.title, desc: t.desc, note: t.note, tags: t.tags || [], rec: !!t.rec,
    restart: t.restart, blocked: (t.cap === 'rtx' && !caps.rtx) || undefined, on: !!on[t.id],
  }));
  const dns = await dnsPromessa;
  return { success: true, tweaks: out, dns, tools: [] };
}

// GUIDs de plano de energia que o app aplica. O detect do plano devolve o GUID ativo, nao '1'.
const PLANO_GUID = {
  'Plano de Alta Performance': '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  'Modo X3D Correto': '381b4222-f694-41f0-9685-ff5bb260df2e',
};

async function actionsStatus() {
  const on = {};
  const b = loadBackups();

  // Monta um unico script que avalia o detect de cada acao e devolve tudo em JSON.
  // Antes era um PowerShell por acao (18 processos em sequencia, 2.263 ms no total).
  const itens = ACTION_NAMES.map((name) => ({ name, a: ACTIONS[name] })).filter((x) => x.a && x.a.detect);
  const semDetect = ACTION_NAMES.filter((name) => {
    const a = ACTIONS[name];
    return a && !a.detect;
  });

  if (itens.length) {
    const blocos = itens.map(({ name, a }, idx) => {
      const seguro = String(a.detect).replace(/\r?\n/g, ' ');
      return `$r['${idx}'] = @( ${seguro} ) -join ' '`;
    });
    const script = `$r = @{}
${blocos.join('\n')}
Write-Output (Json $r)`;
    const r = await ps(script, 120000);
    if (r.ok && r.out) {
      let valores = null;
      try { valores = JSON.parse(r.out); } catch (e) { valores = null; }
      itens.forEach(({ name }, idx) => {
        const saida = valores && valores[String(idx)] != null ? String(valores[String(idx)]).trim() : '';
        let aplicado = false;
        if (saida) {
          if (/(^|\s)(1|active)($|\s)/i.test(saida)) aplicado = true;
          const guid = PLANO_GUID[name];
          if (guid && saida.toLowerCase().includes(guid.toLowerCase())) aplicado = true;
        }
        on[name] = aplicado;
      });
    } else {
      // Se o script unico falhar, cai no backup para nao marcar tudo como desligado.
      itens.forEach(({ name }) => { on[name] = !!b[name]; });
    }
  }

  // Sem detect: nao ha como perguntar ao Windows, vale o backup.
  semDetect.forEach((name) => { on[name] = !!b[name]; });

  return { success: true, on };
}

async function applyTweak(id, want) {
  const t = tweakById(id);
  if (!t) return { success: false, error: 'ajuste desconhecido' };
  const key = 'tweak:' + id;
  const regs = tweakRegs(t);
  const svcs = t.svc || [];
  if (want) {
    if (regs.length || svcs.length) {
      await psBackupState(key, regs, svcs);
      const lines = [];
      for (const r of regs) {
        const v = typeof r.on === 'string' ? `'${r.on}'` : r.on;
        lines.push(`Set-Val '${r.path}' '${r.name}' ${v} '${r.type}'`);
      }
      for (const s of svcs) lines.push(`Svc '${s}' 'Disabled'`);
      const r = await ps(lines.join('\n'), 60000);
      if (!r.ok) return { success: false, error: r.err || 'falha' };
    }
    if (t.on) {
      const r = await ps(t.on, 60000);
      if (!r.ok) return { success: false, error: r.err || 'falha' };
    }
    const now = await probeTweak(t);
    return { success: now, on: now, error: now ? undefined : 'o Windows não aceitou a mudança.' };
  }
  // desligar = restaurar o backup exato
  const st = loadBackups()[key];
  if (st) {
    const rb = await restoreBackup(key);
    if (!rb.success) return { success: false, error: rb.error };
  } else if (t.off) {
    await ps(t.off, 60000);
  } else if (regs.length) {
    const lines = regs.map((r) => `Set-Val '${r.path}' '${r.name}' ${typeof r.off === 'string' ? `'${r.off}'` : r.off} '${r.type}'`);
    await ps(lines.join('\n'), 60000);
  }
  const now = await probeTweak(t);
  return { success: !now, on: now, error: now ? 'não foi possível desfazer.' : undefined };
}

async function runAction(name) {
  const a = ACTIONS[name];
  if (!a) return { success: false, error: 'ação desconhecida' };
  const regs = a.regs || [];
  const svcs = a.svcs || [];
  if (regs.length || svcs.length) await psBackupState(name, regs, svcs);
  const lines = [];
  for (const r of regs) {
    const v = typeof r.on === 'string' ? `'${r.on}'` : r.on;
    lines.push(`Set-Val '${r.path}' '${r.name}' ${v} '${r.type}'`);
  }
  for (const s of svcs) lines.push(`Svc '${s}' 'Disabled'`);
  if (lines.length) { const r = await ps(lines.join('\n'), 60000); if (!r.ok) return { success: false, error: r.err || 'falha' }; }
  if (a.run) {
    const r = await ps(a.run, 120000);
    if (!r.ok) return { success: false, error: r.err || 'falha' };
    if (r.out.includes('noobs')) return { success: false, error: 'OBS não encontrado neste PC.' };
  }
  const msg = a.restart === 'reboot' ? 'Vale depois de reiniciar o PC.' : undefined;
  return { success: true, message: msg };
}

async function revertAction(name) {
  const a = ACTIONS[name];
  if (!a) return { success: false, error: 'ação desconhecida' };
  const b = loadBackups()[name];
  if (b) {
    const rb = await restoreBackup(name);
    if (!rb.success) return { success: false, error: rb.error };
    return { success: true };
  }
  if (a.revert) { const r = await ps(a.revert, 60000); return { success: r.ok, error: r.ok ? undefined : r.err }; }
  return { success: false, error: 'sem backup' };
}

async function runOnce(name) {
  const o = ONCES[name];
  if (!o) return { success: false, error: 'ação desconhecida' };
  const r = await ps(o.run, 180000);
  return { success: r.ok, message: (r.out || '').slice(0, 200) || 'concluído', error: r.ok ? undefined : r.err };
}

async function runTool(id) {
  const t = TOOLS[id];
  if (!t) return { success: false, error: 'ferramenta desconhecida' };
  const r = await ps(t.run, t.long ? 60 * 60 * 1000 : 120000);
  return { success: r.ok, message: (r.out || '').slice(-400) || 'concluído', error: r.ok ? undefined : r.err };
}

// ── Verificações ──
const CHECKS = {
  gpu: {
    title: 'Placa de vídeo',
    run: `
      $hags = Get-Val 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'HwSchMode'
      $lines = @()
      $drv = Get-CimInstance Win32_VideoController | Select-Object -First 1
      $age = if ($drv.DriverDate) { [math]::Round(((Get-Date) - $drv.DriverDate).TotalDays) } else { $null }
      if ($age) { $lines += "Driver de $age dias atras ($($drv.DriverVersion))." ; if ($age -gt 180) { $level = 'warn' } }
      if ($hags -eq 2) { $lines += 'HAGS ligado.' } else { $lines += 'HAGS desligado: ligue para usar DLSS Frame Generation.'; $level = 'warn' }
      $o = @{ level = $(if ($level) { $level } else { 'ok' }); title = 'Placa de video'; lines = $lines }
      Write-Output (Json $o)`,
  },
  ram: {
    title: 'Memória',
    run: `
      $m = @(Get-CimInstance Win32_PhysicalMemory)
      $lines = @(); $level = 'ok'
      $rates = @($m | ForEach-Object { $_.ConfiguredClockSpeed } | Where-Object { $_ })
      $xmp = @($m | ForEach-Object { $_.Speed } | Where-Object { $_ } | Sort-Object -Descending | Select-Object -First 1)
      $best = if ($rates.Count) { ($rates | Sort-Object -Descending)[0] } else { 0 }
      $lines += "Velocidade atual: $best MT/s."
      if ($xmp.Count -and $best -lt $xmp[0]) { $lines += "O kit suporta $($xmp[0]) MT/s: XMP/EXPO desligado na BIOS."; $level = 'warn' }
      $ch = @($m | Select-Object -ExpandProperty BankLabel -Unique)
      $lines += ($m.Count.ToString() + ' pente(s) instalado(s).')
      $o = @{ level = $level; title = 'Memoria (XMP/EXPO)'; lines = $lines }
      Write-Output (Json $o)`,
  },
  amd: {
    title: 'Processador AMD',
    cap: 'amd',
    run: `
      $lines = @(); $level = 'ok'
      $s = Get-Service -Name 'amd3dvcacheSvc' -ErrorAction SilentlyContinue
      if (-not $s) { $lines += 'Servico de cache 3D V-Cache ausente: instale o driver de chipset AMD.'; $level = 'warn' } else { $lines += 'Driver de chipset AMD presente.' }
      $o = @{ level = $level; title = 'Ryzen'; lines = $lines }; Write-Output (Json $o)`,
  },
  intel: {
    title: 'Processador Intel',
    cap: 'intel',
    run: `
      $lines = @(); $level = 'ok'
      $rev = (Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0').'Update Revision'
      $lines += "Microcode: $([string]$rev)"
      $o = @{ level = 'ok'; title = 'Core / Core Ultra'; lines = $lines }; Write-Output (Json $o)`,
  },
  encoder: {
    title: 'Configuração do OBS',
    run: `
      $g = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
      $enc = if ($g -match 'NVIDIA') { 'NVENC (NVIDIA)' } elseif ($g -match 'AMD') { 'AMF (AMD)' } elseif ($g -match 'Intel') { 'QSV (Intel)' } else { 'x264' }
      $lines = @("Encoder recomendado: $enc.", 'Preset de qualidade, 6000 kbps para 1080p60.')
      $o = @{ level = 'ok'; title = 'OBS'; lines = $lines }; Write-Output (Json $o)`,
  },
};

async function runCheck(name) {
  const c = CHECKS[name];
  if (!c) return { success: false, error: 'verificação desconhecida' };
  const r = await ps(c.run, 60000);
  if (!r.ok) return { success: false, error: r.err || 'falha' };
  try { return { success: true, ...JSON.parse(r.out) }; } catch (e) { return { success: false, error: 'resposta inválida' }; }
}

// ── Recomendações ──
async function recommendations() {
  const [startup, temp] = await Promise.all([startupList(), cleanTempSize()]);
  let on = 0;
  for (const i of (startup.items || [])) if (i.enabled) on++;
  return { startupOn: on, tempBytes: temp };
}

module.exports = {
  ps, setDataDir, loadBackups, saveBackups, restoreBackup, getCaps,
  tweaksStatus, actionsStatus, applyTweak, runAction, revertAction, runOnce, runTool, runCheck,
  getDns, setDns, TWEAKS, ACTIONS, ONCES, TOOLS, tweakById, DATA_DIR: () => DATA_DIR,
};
