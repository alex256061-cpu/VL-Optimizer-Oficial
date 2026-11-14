// engine.js — motor do VL Optimizer
// Executa cada ajuste de verdade: PowerShell elevado, registro, serviços, powercfg, netsh.
// Tudo com backup: o "desfazer" restaura o valor exato que o Windows tinha antes.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Pasta de dados (backups, sessoes, configuracoes).
//
// Antes caia em %TEMP%, que o Storage Sense do Windows apaga sozinho — o usuario
// perdia o "desfazer". O main.js chama setDataDir() com app.getPath("userData")/data,
// que no Windows e %APPDATA%\VL Optimizer\data; aqui o padrao e esse mesmo, para nao
// existir um segundo diretorio antes da chamada.
let DATA_DIR = process.env.LOPT_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'VL Optimizer', 'data');
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
function New-Key($p) {
  # NÃO engolir o erro.
  #
  # Antes: New-Item ... | Out-Null sem -ErrorAction. Com $ErrorActionPreference =
  # 'SilentlyContinue' a negativa de acesso sumia, a chave não era criada, e o
  # New-ItemProperty seguinte falhava com "Não é possível localizar o caminho" — texto
  # que não fala de permissão e fazia o app responder "recurso nao existe".
  if (Test-Path -LiteralPath $p) { return }
  try {
    New-Item -Path $p -Force -ErrorAction Stop | Out-Null
  } catch {
    throw ("nao foi possivel criar a chave " + $p + ": " + $_.Exception.Message)
  }
}
function Get-Val($p, $n) { try { (Get-ItemProperty -LiteralPath $p -Name $n -ErrorAction Stop).$n } catch { $null } }
function Set-Val($p, $n, $v, $t) {
  New-Key $p
  # O tipo precisa ser respeitado TAMBÉM quando o valor já existe.
  #
  # Set-ItemProperty não aceita -PropertyType: ele grava no tipo que já está lá. Numa
  # restauração o valor quase sempre existe, então um Binary voltava como String e o
  # conteúdo virava o texto "1 2 3 255". Aqui a chave é removida e recriada com o tipo
  # pedido sempre que o tipo atual for diferente.
  $tipoAtual = $null
  try {
    $k = Get-Item -LiteralPath $p -ErrorAction Stop
    if ($k.GetValueNames() -contains $n) { $tipoAtual = [string]$k.GetValueKind($n) }
  } catch { }
  $mesmoTipo = $false
  if ($tipoAtual) {
    $mapa = @{ DWord = 'DWord'; String = 'String'; QWord = 'QWord'; Binary = 'Binary'; MultiString = 'MultiString'; ExpandString = 'ExpandString' }
    if ($mapa.ContainsKey($t)) { $mesmoTipo = ($tipoAtual -ieq $mapa[$t]) }
  }
  if ($tipoAtual -and $mesmoTipo) {
    Set-ItemProperty -LiteralPath $p -Name $n -Value $v -Force -ErrorAction Stop | Out-Null
  } else {
    if ($tipoAtual) { Remove-ItemProperty -LiteralPath $p -Name $n -Force -ErrorAction SilentlyContinue }
    New-ItemProperty -LiteralPath $p -Name $n -Value $v -PropertyType $t -Force -ErrorAction Stop | Out-Null
  }
}
function Del-Val($p, $n) { Remove-ItemProperty -LiteralPath $p -Name $n -ErrorAction SilentlyContinue }
function Get-SvcModo($n) {
  # Lê o StartType de um jeito que funciona sem admin e depois do serviço ser desligado.
  #
  # Medido nesta máquina:
  #   (Get-Service Spooler).StartType  -> ''  (vazio) quando o serviço está Disabled
  #   Get-CimInstance Win32_Service    -> "Namespace inválido" (WMI quebrado nesta instalação)
  #   sc.exe qc <nome>                 -> "TIPO_DE_INÍCIO : 4 DISABLED" (texto localizado!)
  # Por isso: first tenta o Get-Service, e quando ele devolve vazio/erro cai no sc.exe com
  # exit code (o texto vem traduzido, então o que vale é o CÓDIGO: 0=boot, 1=system,
  # 2=automatic, 3=manual, 4=disabled). Também devolve a marca "(DELAYED)".
  try {
    $s = Get-Service -Name $n -ErrorAction Stop
    $t = [string]$s.StartType
    if ($t) { return $t }
  } catch { return '' }
  $saida = (& sc.exe qc $n 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { return '' }
  $m = [regex]::Match($saida, ':\s*([0-4])\s')
  if (-not $m.Success) { return '' }
  $codigo = [int]$m.Groups[1].Value
  $nome = @{ 0 = 'Boot'; 1 = 'System'; 2 = 'Automatic'; 3 = 'Manual'; 4 = 'Disabled' }[$codigo]
  if ($codigo -eq 2 -and $saida -match 'DELAYED|RETARD') { $nome = 'Automatic (Delayed)' }
  return $nome
}
function Svc($n, $mode) {
  # Confere o StartType DEPOIS de gravar. Antes o Set-Service falhava com "Acesso negado",
  # a função devolvia sucesso e o app dizia "concluído" com o serviço ainda ligado.
  #
  # O 'throw' daqui NÃO chegava ao Node (o exit code do PowerShell continuava 0 quando
  # $ErrorActionPreference = 'SilentlyContinue'). Medido nesta máquina:
  #   try { throw 'x' } catch { throw 'y' }   -> exit 0, nada em stderr
  #   try { cmd -ErrorAction Stop } catch { throw 'y' } -> exit 0, nada em stderr
  #   throw 'y' na raiz do script         -> exit 1, texto no stderr
  # Por isso, quando a raiz do script é envolvida pelo trap abaixo, o throw sai de
  # ALI e vira exit code != 0. Os dois precisam andar juntos: o trap sem um throw
  # 'cru' aqui não serve para o que ele foi feito.
  $s = Get-Service -Name $n -ErrorAction SilentlyContinue
  if (-not $s) { throw ("servico " + $n + " nao existe") }
  try {
    Set-Service -Name $n -StartupType $mode -ErrorAction Stop
  } catch {
    throw ("nao foi possivel mudar o servico " + $n + ": " + $_.Exception.Message)
  }
  # reler: o Set-Service pode "passar" sem mudar
  $atual = Get-SvcModo $n
  if (-not $atual) { throw ("servico " + $n + " sumiu") }
  $igual = ($atual -ieq $mode)
  if ($mode -eq 'Automatic' -and $atual -like 'Auto*') { $igual = $true }
  if (-not $igual) {
    throw ("o servico " + $n + " continua em " + $atual + " (pedido: " + $mode + ") - precisa de administrador")
  }
  if ($mode -eq 'Disabled') { Stop-Service -Name $n -Force -ErrorAction SilentlyContinue }
  else { Start-Service -Name $n -ErrorAction SilentlyContinue }
}
function Json($o) { ConvertTo-Json -InputObject $o -Compress -Depth 8 }
`;

// Envolve o script do motor num try/trap.
//
// Medido nesta máquina (Windows PowerShell 5.1, sem elevação):
//   script com "throw" -> exit code 0 e stderr vazio, quando o script está DEPOIS de
//   alguma função da biblioteca que capturou erro (-ErrorAction Stop dentro de try/catch).
//   O mesmo "throw" na primeira linha do arquivo -> exit code 1 e texto no stderr.
//
// É por isso que o erro do Svc() "sumia": o throw do serviço negado acontecia depois
// das funções New-Key/Set-Val, e o ps() devolvia ok:true. Com o trap no fim do script,
// qualquer erro que não foi pego no lugar dele para o script com exit code != 0 e o
// texto do erro vai para a SAÍDA padrão (o stderr do PowerShell 5.1 é escrito em
// console, que nesta janela não tem destino e seperde).
//
// Escopo: as funções New-Key/Set-Val/Svc etc. continuam visíveis (o try não cria
// escopo), mas as variáveis que o script cria passam a viver dentro do try.
function psCorpo(script) {
  return 'try {\n' + script + '\n} catch {\n$vlErro = $_\n}\n' +
    'trap { Write-Output ("VL_ERRO: " + $_.Exception.Message); exit 3 }\n' +
    'if ($vlErro) { Write-Output ("VL_ERRO: " + $vlErro.Exception.Message); exit 3 }\n';
}

function ps(script, timeout = 90000) {
  return new Promise((resolve) => {
    let f;
    try {
      const dir = DATA_DIR;
      f = path.join(dir, 'ps-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
      fs.writeFileSync(f, '\ufeff' + PS_LIB + '\n' + psCorpo(script), 'utf8');
    } catch (e) {
      return resolve({ ok: false, out: '', err: String(e.message || e) });
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout,
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(f); } catch (e) {}
      const saida = (stdout || '').toString();
      // O trap escreve "VL_ERRO: <mensagem>" na saída padrão. Tira do que o app mostra e
      // passa a mensagem para o campo de erro, que é o que o erroDePermissao() lê.
      const m = /\n?VL_ERRO: ([\s\S]*)$/.exec(saida);
      const limpa = m ? saida.slice(0, m.index) : saida;
      const erroTrap = m ? m[1].trim() : '';
      const erroStderr = (stderr || '').toString();
      const textoErro = [erroTrap, erroStderr].filter(Boolean).join('\n');
      resolve({
        ok: !err && !erroTrap,
        out: limpa.trim(),
        err: textoErro.trim(),
        code: err && err.code,
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Backups ──
const BACKUP_FILE = () => path.join(DATA_DIR, 'backups.json');
let backs = null;
function loadBackups() {
  if (backs) return backs;
  try {
    const txt = fs.readFileSync(BACKUP_FILE(), 'utf8');
    const j = JSON.parse(txt);
    backs = (j && typeof j === 'object') ? j : {};
  } catch (e) {
    // Arquivo NAO existe: normal, comeca vazio.
    if (e && e.code === 'ENOENT') { backs = {}; return backs; }
    // Arquivo existe e nao abre (truncado, gravacao cortada): guardar copia e comecar vazio.
    // Antes devolvia {} e a gravacao seguinte sobrescrevia tudo — o desfazer do usuario sumia.
    try { fs.copyFileSync(BACKUP_FILE(), BACKUP_FILE() + '.corrompido-' + Date.now()); } catch (_) { }
    backs = {};
  }
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
    // Guardar o TIPO do valor junto. Sem ele, um MultiString (PagingFiles, por exemplo)
    // voltava como String e o conteúdo virava o texto "a b c".
    parts.push(`$v = $null; $e = $false; $k = $null; try { $p2 = Get-Item -LiteralPath '${esc(r.path)}' -ErrorAction Stop; $v = $p2.GetValue('${esc(r.name)}', $null, 'DoNotExpandEnvironmentNames'); if ($p2.GetValueNames() -contains '${esc(r.name)}') { $k = [string]$p2.GetValueKind('${esc(r.name)}'); $e = $true } } catch {}; $o.reg += @{ path='${esc(r.path)}'; name='${esc(r.name)}'; exists=$e; kind=$k; value=$v }`);
  });
  for (const s of svcs) parts.push(`$s = Get-Service -Name '${s}' -ErrorAction SilentlyContinue; $o.svc += @{ name='${s}'; mode=$(if ($s) { [string]$s.StartType } else { $null }); running=$(if ($s) { [bool]($s.Status -eq 'Running') } else { $false }) }`);
  const out = await ps(`$o = [ordered]@{ reg=@(); svc=@() }\n${parts.join('\n')}\nWrite-Output (Json $o)`, 60000);
  if (!out.ok) return st;
  try {
    const j = JSON.parse(out.out);
    st.reg = (j.reg || []).map((r) => ({ path: r.path, name: r.name, exists: !!r.exists, kind: r.kind || null, value: r.value }));
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
      // Tipo do valor. Binary e MultiString eram gravados como String: um array
      // [1,2,3,255] virava o texto "1 2 3 255" e o registro ficava corrompido para sempre.
      const tipo = r.kind || (typeof r.value === 'number' ? 'DWord' : 'String');
      if (tipo === 'Binary') {
        const bytes = Array.isArray(r.value) ? r.value.join(',') : String(r.value || '');
        lines.push(`Set-Val '${r.path}' '${r.name}' ${bytes} 'Binary'`);
      } else if (tipo === 'MultiString') {
        const itens = (Array.isArray(r.value) ? r.value : [String(r.value == null ? '' : r.value)])
          .map((x) => String(x).replace(/'/g, "''")).join("','");
        lines.push(`Set-Val '${r.path}' '${r.name}' '${itens}' 'MultiString'`);
      } else if (tipo === 'QWord') {
        lines.push(`Set-Val '${r.path}' '${r.name}' ${Number(r.value) || 0} 'QWord'`);
      } else {
        const lit = typeof r.value === 'string' ? `'${String(r.value).replace(/'/g, "''")}'` : String(r.value);
        lines.push(`Set-Val '${r.path}' '${r.name}' ${lit} '${tipo}'`);
      }
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
  // Conferir se o registro voltou mesmo ao valor original antes de descartar o backup.
  // ps() devolve ok:true apenas quando o PowerShell nao deu erro, nao quando a mudanca
  // aconteceu. Sem esta conferencia, um comando que roda sem efeito apagava o backup.
  let confere = true;
  if (st.reg && st.reg.length) {
    const partes = st.reg.map((r) => {
      const nome = String(r.name).replace(/'/g, "''");
      const caminho = String(r.path).replace(/'/g, "''");
      return "$v = $null; $e = $false; try { $v = (Get-ItemProperty -LiteralPath '" + caminho + "' -Name '" + nome + "' -ErrorAction Stop).'" + nome + "'; $e = $true } catch {}; $o += @{ name='" + nome + "'; exists=$e; value=$v }";
    });
    const script = "$o = @()" + String.fromCharCode(10) + partes.join(String.fromCharCode(10)) + String.fromCharCode(10) + "Write-Output (Json $o)";
    const rl = await ps(script, 30000);
    if (rl.ok) {
      try {
        // O Json do PowerShell devolve um OBJETO quando o array tem um item só.
        // Sem normalizar para lista, o .find não existia e a conferência virava
        // código morto: reportava sucesso e apagava o backup mesmo com valor divergente.
        const bruto = JSON.parse(rl.out);
        const atual = Array.isArray(bruto) ? bruto : (bruto ? [bruto] : []);
        for (const original of st.reg) {
          const agora = atual.find((x) => x && x.name === original.name);
          if (!agora) { confere = false; break; }
          if (!!original.exists !== !!agora.exists) { confere = false; break; }
          if (original.exists && String(agora.value) !== String(original.value)) { confere = false; break; }
        }
      } catch (e) {
        // se não deu para ler o estado, não afirma que voltou
        confere = false;
      }
    } else {
      confere = false;
    }
  }

  // run.ok = o PowerShell executou sem erro; NAO quer dizer que a mudanca aconteceu.
  // Antes um comando sem efeito apagava o backup. So descarta com a conferencia aprovada.
  // Itens so de servico/custom nao tem registro para conferir: ai vale o resultado do comando.
  const temReg = !!(st.reg && st.reg.length);
  const deuCerto = temReg ? confere : (run.ok || !!st.custom);
  if (deuCerto) {
    delete b[key];
    saveBackups();
  }
  return { success: deuCerto, error: deuCerto ? undefined : 'o Windows nao voltou ao valor original; o backup foi mantido' };
}

// ── Catálogo ──
// Cada item: { id, cat, title, desc, note, tags, rec, restart, reg[], svc[], on, off }
let ehAdminCache = null;
const HKCU = 'HKCU:';
const HKLM = 'HKLM:';
const ADV = HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const T = (id, o) => ({ id, ...o });

const TWEAKS = [
  // — Desempenho
  T('game-mode', { padrao: 1,
    cat: 'desempenho', title: 'Modo de Jogo ligado', rec: true, tags: ['FPS mais estável'],
    desc: 'O Windows prioriza o jogo quando você abre um: menos disputa com processos de fundo.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', type: 'DWord', on: 1, off: 0 }],
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
    // O probe é colado numa linha só pelo tweaksStatus (replace de \n por espaço),
    // então todo comando precisa de ";" explícito. Sem isso o PowerShell aborta o
    // script inteiro com "Token inesperado" e TODOS os probes voltam desligados —
    // era a causa do contador parado em "13 de 21".
    probe: `$gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.PNPDeviceID -match '^PCI\\\\' });
if ($gpus.Count -eq 0) { Write-Output '0' } else {
  $ok = 0;
  $tem = 0;
  foreach ($g in $gpus) {
    $k = 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + $g.PNPDeviceID + '\\Device Parameters\\Interrupt Management\\MessageSignaledInterruptProperties';
    if (Test-Path -LiteralPath $k) {
      $tem = $tem + 1;
      $v = (Get-ItemProperty -LiteralPath $k -Name 'MSISupported' -ErrorAction SilentlyContinue).MSISupported;
      if ($v -eq 1) { $ok = $ok + 1 }
    }
  }
  if ($tem -gt 0 -and $ok -eq $tem) { Write-Output '1' } else { Write-Output '0' }
}`,
    restart: 'reboot',
  }),
  T('mpo', {
    cat: 'desempenho', title: 'MPO desligado (corrige piscadas)', tags: ['Estabilidade'],
    desc: 'Tira a sobreposição de planos da GPU: resolve piscada/tela preta com G-Sync e FreeSync.',
    // OverlayTestMode = 5 desliga o MPO. O off era 5 também, então aplicar e desaplicar
    // gravavam o mesmo valor e o ajuste nunca mudava nada. Agora desaplicar volta para 0.
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\DWM', name: 'OverlayTestMode', type: 'DWord', on: 5, off: 0 }],
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
      { path: HKCU + '\\Control Panel\\Keyboard', name: 'KeyboardSpeed', type: 'String', on: '31', off: null },
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
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization', name: 'SystemSettingsDownloadMode', type: 'DWord', on: 2, off: 0 }],
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
    desc: 'Tira a economia de energia da placa de rede: acabam os picos de ping e as desconexoes.',
    // Usa -RegistryKeyword e nao -DisplayName: o nome da propriedade muda com o idioma
    // ('Energy-Efficient Ethernet' em ingles, 'Energia Eficiente Ethernet' em portugues).
    on: `$n = 0
$kw = @('*EEE','AdvancedEEE','EnableGreenEthernet','PowerSavingMode')
foreach ($x in $kw) {
  $props = @(Get-NetAdapterAdvancedProperty -RegistryKeyword $x -ErrorAction SilentlyContinue)
  foreach ($prop in $props) {
    $alvo = @($prop.ValidDisplayValues) | Where-Object { $_ -match '^(Disabled|Desactivado|Desativado|Desactivada|Desativadas|Off|No|Aus)$' } | Select-Object -First 1
    try {
      if ($alvo) { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword $x -DisplayValue $alvo -ErrorAction Stop }
      else { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword $x -RegistryValue 0 -ErrorAction Stop }
      $n = $n + 1
    } catch { }
  }
}
Write-Output ("mudou=" + $n)`,
    off: `$n = 0
$kw = @('*EEE','AdvancedEEE','EnableGreenEthernet','PowerSavingMode')
foreach ($x in $kw) {
  $props = @(Get-NetAdapterAdvancedProperty -RegistryKeyword $x -ErrorAction SilentlyContinue)
  foreach ($prop in $props) {
    $alvo = @($prop.ValidDisplayValues) | Where-Object { $_ -match '^(Enabled|Activado|Activada|Activados|Activadas|Ativado|Ativada|On|Yes|Aan)$' } | Select-Object -First 1
    try {
      if ($alvo) { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword $x -DisplayValue $alvo -ErrorAction Stop }
      else { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword $x -RegistryValue 1 -ErrorAction Stop }
      $n = $n + 1
    } catch { }
  }
}
Write-Output ("mudou=" + $n)`,
    // Confere TODAS as propriedades que o comando desliga.
    probe: `$tem = 0
$tudoOff = $true
$kw = @('*EEE','AdvancedEEE','EnableGreenEthernet','PowerSavingMode')
foreach ($x in $kw) {
  $props = @(Get-NetAdapterAdvancedProperty -RegistryKeyword $x -ErrorAction SilentlyContinue)
  foreach ($p in $props) {
    $tem = $tem + 1
    if ($p.DisplayValue -notmatch '^(Disabled|Desactivado|Desativado|Desactivada|Desativadas|Off|No|Aus)$') { $tudoOff = $false }
  }
}
if ($tem -eq 0) { Write-Output '1' }
elseif ($tudoOff) { Write-Output '1' }
else { Write-Output '0' }`,
  }),
  T('nic-intmod', {
    cat: 'live', title: 'Interrupt Moderation desligado', tags: ['Ping'],
    desc: 'Menos latencia na placa de rede (os micro-pacotes chegam na hora).',
    on: `$n = 0
foreach ($prop in @(Get-NetAdapterAdvancedProperty -RegistryKeyword '*InterruptModeration' -ErrorAction SilentlyContinue)) {
  try { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword '*InterruptModeration' -RegistryValue 0 -ErrorAction Stop; $n++ } catch { }
}
Write-Output ("mudou=$n")`,
    off: `$n = 0
foreach ($prop in @(Get-NetAdapterAdvancedProperty -RegistryKeyword '*InterruptModeration' -ErrorAction SilentlyContinue)) {
  try { Set-NetAdapterAdvancedProperty -Name $prop.Name -RegistryKeyword '*InterruptModeration' -RegistryValue 1 -ErrorAction Stop; $n++ } catch { }
}
Write-Output ("mudou=$n")`,
    probe: `$p = @(Get-NetAdapterAdvancedProperty -RegistryKeyword '*InterruptModeration' -ErrorAction SilentlyContinue)
if ($p.Count -eq 0) { Write-Output '1' }
else { $off = @($p | Where-Object { [int]$_.RegistryValue -eq 0 }); if ($off.Count -eq $p.Count) { Write-Output '1' } else { Write-Output '0' } }`,
  }),  T('hibernate', { padrao: 1, rec: true,
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
  T('end-task', { rec: true,
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
  T('classic-menu', {
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
  T('taskbar-left', {
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
  'Jogos em Janela Otimizados': {
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
    // PagingFiles é MultiString: cada item é "C:\pagefile.sys 1024 4096".
    // Com ele vazio o Windows gerencia sozinho; com qualquer item o arquivo é fixo ou
    // desligado. Antes o tipo declarado era String e o detect comparava [string] de um
    // array, que nunca é vazio — dava "ligado" (1) nos 6 cenários, inclusive com pagefile
    // fixo e desligado.
    regs: [{ path: HKLM + '\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'PagingFiles', type: 'MultiString', on: '', off: null }],
    // Só é "automático" quando a lista está VAZIA. Qualquer item preenchido significa
    // arquivo fixo ou desligado — e nesses casos o usuário precisa desta ação.
    detect: `$v = Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'PagingFiles'; $itens = @(); if ($null -ne $v) { $itens = @($v | Where-Object { $_ -ne $null -and ([string]\$_).Trim() -ne '' }) }; if ($itens.Count -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
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
    // Sem permissão o Get-AppxPackage não lista nada e o script responde removed=0:
    // a tela mostrava "concluído" sem ter removido coisa alguma.
    prova: { tipo: 'contador', chave: 'removed', mensagem: 'Nenhum app foi removido. O Windows nao deixou remover estes apps nesta sessao: isso precisa de administrador.' },
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
    // Declara o que o script manda mudar: o runOnce confere por fora e não diz "ok"
    // quando o Set-Service foi negado (é o mesmo serviço da auditoria que ficou Running).
    prova: { tipo: 'itens', itens: [{ nome: 'wuauserv', modo: 'Qualquer' }] },
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
    // Ausente vale como padrão SÓ quando o padrão é diferente do valor de ligar.
    //
    // Em `widgets` o padrão é 0 e o valor de ligar também é 0: são o mesmo estado. Se
    // um valor ausente fosse contado como "ligado", o desfazer (que apaga o valor) seria
    // lido como "ainda ligado" — reportava falha com o Windows já restaurado e jogava
    // fora o backup.
    const padraoIgualAoOn = padraoT !== null && padraoT === alvo;
    if (padraoT !== null && !padraoIgualAoOn) {
      return `$v = Get-Val '${r.path}' '${r.name.replace(/'/g, "''")}'; if ($null -eq $v) { $v = '${padraoT}' }; if ([string]$v -eq '${alvo}') { $c++ }`;
    }
    return `$v = Get-Val '${r.path}' '${r.name.replace(/'/g, "''")}'; if ($null -ne $v -and [string]$v -eq '${alvo}') { $c++ }`;
  });
  const r = await ps(`$c = 0\n${parts.join('\n')}\nWrite-Output $c`);
  const n = parseInt(r.out, 10) || 0;
  return n >= regs.length;
}

// ── Conferência do resultado real (a cura do "falso sucesso") ──
//
// O `probeTweak` responde "o ajuste está ligado AGORA?" — ele não sabe se a chamada
// mudou alguma coisa. Os tweaks de HKLM (edge-bg, gpu-msi, telemetry, bing, activity,
// bsod-detail) não declaram `padrao`, e aí um valor AUSENTE nunca conta como ligado…
// mas quando a chave JÁ tem o valor de ligar (medido nesta máquina: bing=0x1,
// bsod-detail=0x1) o probe devolve true. Medido sem elevação:
//   applyTweak → { success:false, error:"precisa de administrador" }   (correto)
//   tweaksStatus().on[id] → true                                       → a tela mostra LIGADO
// O cliente lê o erro no toast e, ao reabrir, vê o interruptor ligado. É o falso sucesso.
//
// A regra nova (a mesma do GDZ): depois de aplicar, REGRAVAR o estado e só dizer que deu
// certo se o valor alvo está lá. Se o valor já estava lá ANTES, o ajuste não fez nada —
// a resposta certa é "você não tem permissão", não "deu certo".
async function lerRegsAtuais(regs) {
  if (!regs.length) return null;
  const linhas = regs.map((r) => {
    const e = (x) => String(x == null ? '' : x).replace(/'/g, "''");
    return `$v = Get-Val '${e(r.path)}' '${e(r.name)}'; if ($null -eq $v) { $l += @{ name='${e(r.name)}'; existe=$false; valor=$null; texto='' } } else { $l += @{ name='${e(r.name)}'; existe=$true; valor=$v; texto=[string]$v } }`;
  });
  const r = await ps(`$l = @()\n${linhas.join('\n')}\nWrite-Output (Json $l)`, 45000);
  if (!r.ok || !r.out) return null;
  try {
    const j = JSON.parse(r.out);
    const lista = Array.isArray(j) ? j : (j ? [j] : []);
    // O Json do PowerShell devolve OBJETO quando o array tem um item só; a mesma
    // armadilha já mordeu o restoreBackup(). Normalizar sempre para lista.
    const mapa = {};
    lista.forEach((x) => { if (x && x.name) mapa[x.name] = { existe: !!x.existe, texto: x.texto == null ? '' : String(x.texto) }; });
    return regs.map((r) => mapa[r.name] || { existe: false, texto: '' });
  } catch (e) { return null; }
}

// Quais valores do ajuste NÃO estão no estado pedido? Lista curta para a mensagem e
// para a decisão de gravar ou não o backup.
function regsNoEstado(regs, atuais, want) {
  const alvo = (r) => String(want ? r.on : r.off);
  const faltando = [];
  regs.forEach((r, i) => {
    const a = atuais[i];
    if (!a || a.texto !== alvo(r)) faltando.push(r.name);
  });
  return faltando;
}

// O ajuste mexeu de verdade? Em tweaks SEM `padrao`, um valor ausente não é um estado
// válido ("ligar = tirar o valor do ar" não existe no catálogo). Em tweaks COM `padrao`,
// remover todos os valores também é um resultado — mas só para desligar.
const valorAusenteConta = (t, want) => (t.padrao !== undefined && !want);

// O estado LIDO bate com o que o ajuste pede?
//
// `probeTweak` não serve para isso: ele responde "está ligado?", e nos tweaks de HKLM
// (edge-bg, gpu-msi, telemetry, bing, activity, bsod-detail) "ligado" pode ser o valor
// que o Windows JÁ tinha (medido: bing e bsod-detail já vêm ligados de fábrica). A
// resposta certa é comparar O VALOR com o que foi pedido, um a um.
function regsNoEstado(regs, atuais, want) {
  const faltando = [];
  regs.forEach((r, i) => {
    const a = atuais && atuais[i];
    const alvo = String(want ? r.on : r.off);
    if (!a) { faltando.push(r.name); return; }
    if (!a.existe) {
      // Valor ausente: só é resultado válido quando o CATÁLOGO manda apagar o valor
      // (o `off` é explícito) ou quando o ajuste já declara que a ausência é o padrão.
      if (!(want === false && r.off !== undefined)) faltando.push(r.name);
      return;
    }
    if (a.texto !== alvo) faltando.push(r.name);
  });
  return faltando;
}

async function tweakNoAlvo(t, atuais, want) {
  if (t.probe) return (await probeTweak(t)) === want;
  const regs = tweakRegs(t);
  if (!regs.length) {
    // Ajuste sem registro (powercfg, netsh): não há como regravar por leitura barata.
    // O probe é a única medida — e o applyTweak já confere o `on`/`off` antes de chegar aqui.
    return (await probeTweak(t)) === want;
  }
  return regsNoEstado(regs, atuais, want).length === 0;
}

// O desfazer não compara com o catálogo: compara com o BACKUP, que é o estado exato que
// o Windows tinha antes. (No end-task e em parte do suggestions o valor original é
// "não existia": qualquer comparação que exija um valor acha que não voltou.)
async function backupRestaurado(st, atuais) {
  if (!st || !st.reg || !st.reg.length) return true;
  if (!atuais || atuais.length !== st.reg.length) return false;
  for (let i = 0; i < st.reg.length; i++) {
    const orig = st.reg[i];
    const ago = atuais[i];
    if (!ago) return false;
    if (!!orig.exists !== !!ago.existe) return false;
    if (orig.exists && typeof orig.value !== 'number' && String(ago.texto) !== String(orig.value)) return false;
  }
  return true;
}

// A mensagem de uma falha que não bateu no alvo. Nunca devolve texto do PowerShell:
// `erroDePermissao` classifica o que o trap pegou e, se não classificar, devolve
// "o Windows nao aceitou a mudanca…" — que é exatamente a verdade aqui.
async function mensagemDeFalhaTweak(t, extra) {
  const permissao = await erroDePermissao(t && t._ultimoErro);
  const base = 'A mudança não foi aplicada de verdade no Windows.';
  if (/administrador/i.test(permissao)) return permissao;
  if (extra) return base + ' ' + extra;
  return base + ' ' + permissao;
}

// Depois de aplicar com sucesso, guarda o backup do estado ANTERIOR.
//
// Antes o backup era gravado ANTES de aplicar (psBackupState no começo do applyTweak).
// Sem elevação o applyTweak falhava e o backup do HKLM ficava no disco para sempre: o
// "desfazer" passava a tentar restaurar um valor que nunca foi mudado e travava no erro
// — um clique sem admin queimava o desfazer daquele ajuste (achado 3 da auditoria).
// Agora o backup só é criado quando o valor real mudou; se não mudou, apaga o órfão.
// Recebe o resultado de lerAnterior(): `antes.reg` já vem com o TIPO (kind) junto, então
// o backup fica exatamente no formato que o restoreBackup() sabe consumir.
// (Antes desta função existir, o backup era gravado ANTES de aplicar e ficava órfão
// quando a aplicação falhava — e o "desfazer" travava para sempre.)
async function backupDoAnterior(key, regs, svcs, anteriores) {
  const b = loadBackups();
  if (b[key]) return;
  const st = { at: Date.now(), reg: [], svc: [] };
  regs.forEach((r, i) => {
    const a = anteriores && anteriores[i];
    st.reg.push({
      path: r.path,
      name: r.name,
      exists: !!(a && a.exists),
      kind: (a && a.exists) ? (a.kind || (typeof r.on === 'number' ? 'DWord' : 'String')) : null,
      value: a ? a.value : null,
    });
  });
  if (svcs.length) {
    const partes = svcs.map((s) => `$s = Get-Service -Name '${esc(s)}' -ErrorAction SilentlyContinue; $o += @{ name='${esc(s)}'; mode=$(if ($s) { [string]$s.StartType } else { $null }); running=$(if ($s) { [bool]($s.Status -eq 'Running') } else { $false }) }`);
    const r = await ps(`$o = @()\n${partes.join('\n')}\nWrite-Output (Json $o)`, 30000);
    if (r.ok && r.out) {
      try {
        const j = JSON.parse(r.out);
        const lista = Array.isArray(j) ? j : (j ? [j] : []);
        lista.forEach((x) => { if (x && x.name) st.svc.push({ name: x.name, mode: x.mode, running: !!x.running }); });
      } catch (e) {}
    }
  }
  b[key] = st;
  saveBackups();
}

// Guarda o VALOR anterior antes de mexer (uma leitura só, com o TIPO junto).
// psBackupState faz o mesmo, mas grava no disco na hora — e era isso que deixava o backup
// órfão quando a aplicação falhava. Aqui a leitura fica só em memória até dar certo.
async function lerAnterior(regs) {
  if (!regs.length) return { reg: [], tipos: {} };
  const partes = regs.map((r) => {
    const e = (x) => String(x == null ? '' : x).replace(/'/g, "''");
    return `$v = $null; $e = $false; $k = $null; try { $p2 = Get-Item -LiteralPath '${e(r.path)}' -ErrorAction Stop; $v = $p2.GetValue('${e(r.name)}', $null, 'DoNotExpandEnvironmentNames'); if ($p2.GetValueNames() -contains '${e(r.name)}') { $k = [string]$p2.GetValueKind('${e(r.name)}'); $e = $true } } catch {}; $o.reg += @{ path='${e(r.path)}'; name='${e(r.name)}'; exists=$e; kind=$k; value=$v }`;
  });
  const out = await ps(`$o = [ordered]@{ reg=@() }\n${partes.join('\n')}\nWrite-Output (Json $o)`, 45000);
  const vazio = { reg: [], tipos: {} };
  if (!out.ok || !out.out) return vazio;
  try {
    const j = JSON.parse(out.out);
    const lista = (j && j.reg) ? (Array.isArray(j.reg) ? j.reg : [j.reg]) : [];
    const res = { reg: [], tipos: {} };
    lista.forEach((x) => {
      if (!x) return;
      res.reg.push({ path: x.path, name: x.name, exists: !!x.exists, kind: x.kind || null, value: x.value });
      if (x.kind) res.tipos[x.path + '\u0000' + x.name] = x.kind;
    });
    // A ordem do Json não é garantida: devolver na ordem de `regs` para casar com os índices.
    const mapa = {};
    res.reg.forEach((r) => { mapa[r.name] = r; });
    res.reg = regs.map((r) => {
      const achado = mapa[r.name] || { exists: false, kind: null, value: null };
      return { path: r.path, name: r.name, exists: !!achado.exists, kind: achado.kind || null, value: achado.value };
    });
    return res;
  } catch (e) { return vazio; }
}

// O valor de DESLIGAR é exatamente o que o Windows já tinha ANTES. Aplicar "de novo"
// não muda nada e não há como distinguir de "não tenho permissão" — então a resposta
// honesta é esta, e não "precisa de administrador" (que o cliente tentaria em vão).
const MSG_JA_ESTAVA = 'Este ajuste já está neste estado no Windows: a mudança não teve efeito. Nada foi alterado.';

// Se a aplicação falhou, o backup daquele ajuste não serve para nada — e trava o
// desfazer. Só apaga o que ESTA chamada criou/que se refere a um valor que não mudou.
function descartaBackupOrfao(key) {
  const b = loadBackups();
  if (!b[key]) return;
  delete b[key];
  saveBackups();
}

// O acumulador de erro do applyTweak/runAction é por ajuste, na memória do processo.
// Antes ele nunca era zerado: o erro de uma tentativa antiga voltava na próxima.
function zeraErro(t) { if (t) { try { delete t._ultimoErro; } catch (e) {} } }

async function tweaksStatus() {
    // getDns roda em paralelo com a leitura dos ajustes: nao ha dependencia entre eles.
  const dnsPromessa = getDns().catch(() => 'auto');
const caps = await getCaps();
  // A classificação é pela PRESENÇA DE PROBE, não pela presença de registro.
  //
  // O probeTweak() consulta o probe ANTES dos valores do registro. Aqui era o
  // contrário: um ajuste que tem probe E registro (hibernate, por exemplo) caía no
  // ramo do registro e o probe era ignorado. Aplicar funcionava, o Windows mudava, e
  // o contador não subia — o "13 de 21" que o cliente viu.
  //
  // Com esta ordem as duas funções leem a mesma coisa e não podem divergir.
  const regItems = TWEAKS.filter((t) => !t.probe && tweakRegs(t).length);
  const customItems = TWEAKS.filter((t) => t.probe || !tweakRegs(t).length);
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
        // Mesma regra do probeTweak: o valor ausente só vale como padrão quando o
        // padrão é DIFERENTE do valor de ligar. Em `widgets` o padrão é 0 e o valor de
        // ligar também é 0 — são o mesmo estado, então ausência não conta como ligado.
        const padraoIgualAoOn = padraoT !== null && padraoT === alvo;
        if (padraoT !== null && !padraoIgualAoOn) {
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
    // Cada probe roda no seu próprio try/catch.
    //
    // Antes eram colados todos num script só: um `exit` ou um erro de sintaxe num
    // deles abortava o PowerShell inteiro e os 8 voltavam desligados — o contador
    // parecia travado (13 de 21) mesmo depois de otimizar.
    const blocos = comProbe.map((t, idx) => {
      // NÃO colar as linhas do probe.
      //
      // O replace de \n por espaço juntava comandos sem separador
      // ("$tem = 0 $tudoOff = $true" virava um erro de sintaxe) e, como os probes
      // rodam todos no mesmo script, um erro derrubava os oito. O contador ficava
      // parado mesmo com os ajustes aplicados de verdade.
      //
      // Aqui as quebras de linha são preservadas e o probe vai dentro de um
      // scriptblock & { ... }, que é uma expressão válida dentro de @().
      const seguro = String(t.probe).replace(/\bexit\b/g, 'return');
      return `$__probes['${idx}'] = @( & { ${seguro} } ) -join ' '`;
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

  // ── O interruptor não pode mentir ──
  //
  // `on` é "o valor do Windows JÁ é o valor de ligar" — e isso pode ser o padrão de
  // fábrica, não algo que o cliente ligou. Sem administrador, os 6 ajustes de HKLM
  // (edge-bg, gpu-msi, telemetry, bing, activity, bsod-detail) nem conseguem ser
  // aplicados; quando o valor já vem de fábrica (medido: edge-bg=0, bing=1,
  // bsod-detail=1) o interruptor aparecia LIGADO logo depois de o app dizer
  // "precisa de administrador". É exatamente o falso sucesso que o cliente viu.
  //
  // Agora cada ajuste diz também se é aplicável AGORA (admin) e se o Windows já estava
  // nesse estado antes de qualquer tentativa. O renderer usa `precisaAdmin` para mostrar
  // "precisa de admin" em vez de um interruptor ligado, sem tocar em nenhum dos 34
  // ajustes que funcionam.
  const souAdmin = await ehAdmin().catch(() => false);
  const b = loadBackups();
  const bloqueios = {};
  TWEAKS.forEach((t) => {
    const regs = tweakRegs(t);
    const temHklm = regs.some((r) => /^HKLM:/i.test(r.path));
    const temSvc = !!(t.svc && t.svc.length);
    // Ajustes com `on` próprio (gpu-msi, hibernate, eee, nic-intmod…) também passam por
    // um comando que só um administrador deixa mudar. Sem regs/svc não há como saber
    // pelo catálogo: a regra é "o comando do `on` mexe em HKLM ou em serviço".
    const cmdAdmin = /HKLM:|Set-Service|Start-Service|Stop-Service|powercfg \/h|Set-NetAdapter|Enable-NetAdapter|Disable-NetAdapter/i.test(String(t.on || ''));
    const precisa = (temHklm || temSvc || cmdAdmin) && !souAdmin;
    const mexido = !!b['tweak:' + t.id];
    // Só avisa quando o "ligado" é de fábrica E o ajuste é o que precisa de admin:
    // dizer "aplicado" para o que nunca foi aplicado nesta máquina é a mentira.
    bloqueios[t.id] = precisa ? {
      admin: true,
      // true = o Windows já estava assim antes (valor de fábrica), o app não fez isso.
      padrao: on[t.id] === true && !mexido,
      motivo: 'Precisa de administrador. Clique em "Reabrir como admin" na faixa vermelha no topo da tela.',
    } : undefined;
  });
  const out = TWEAKS.map((t) => ({
    id: t.id, title: t.title, desc: t.desc, note: t.note, tags: t.tags || [], rec: !!t.rec,
    restart: t.restart, blocked: (t.cap === 'rtx' && !caps.rtx) || undefined,
    // A tela e o applyTweak leem a MESMA coisa (probeTweak/tweakNoAlvo). Antes esta
    // linha usava uma regra própria e podia divergir do que o motor aplicava.
    on: on[t.id] === true,
    precisaAdmin: bloqueios[t.id] || undefined,
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
    // NAO colar as linhas do detect.
    //
    // O replace de \n por espaço juntava comandos sem separador ("$a = 0 $b = 1" vira
    // um erro de sintaxe) e, como os detects rodam todos no mesmo script, um erro
    // derrubava todos — TODAS as ações voltavam desligadas e o painel ficava parado
    // em "14 de 21" mesmo depois de otimizar. Mesmo defeito que o tweaksStatus tinha.
    const blocos = itens.map(({ name, a }, idx) => {
      const seguro = String(a.detect);
      return `$r['${idx}'] = @( & { ${seguro} } ) -join ' '`;
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

async function ehAdmin() {
  if (ehAdminCache !== null) return ehAdminCache;
  try {
    const r = await ps("$id = [Security.Principal.WindowsIdentity]::GetCurrent(); $p = New-Object Security.Principal.WindowsPrincipal($id); Write-Output ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))", 15000);
    ehAdminCache = String(r.out || "").trim().toLowerCase() === "true";
  } catch (e) { ehAdminCache = false; }
  return ehAdminCache;
}

// Mensagem especifica quando o Windows barra por falta de permissao.
async function erroDePermissao(err) {
  const e = String(err || "");

  // Permissão: os textos do Windows em português NÃO usam "acesso negado".
  // Medido nesta máquina:
  //   HKLM           -> "Acesso ao Registro solicitado não é permitido."
  //   System32       -> "O acesso ao caminho '...' foi negado."
  //   Política       -> "Acesso negado." / "Access is denied." (inglês)
  // O regex antigo só cobria a terceira forma, então as duas mais comuns passavam cruas.
  const SEM_PERMISSAO = new RegExp([
    'acesso negado',
    'access denied',
    'access is denied',
    'n[ãa]o [ée] permitido',          // "não é permitido" (registro)
    'ao Registro solicitado',          // "Acesso ao Registro solicitado..."
    'foi negado',                      // "O acesso ao caminho ... foi negado."
    'negado',
    'privil[ée]gio',
    'privilege',
    'requer eleva[çc][ãa]o',
    'elevation required',
    'solicite permiss[ãa]o',
    'n[ãa]o autorizad',               // "...operação não autorizada" (visto no cliente)
    'operac[ãa]o n[ãa]o permitida',
    'n[ãa]o permitid',
    'n[ãa]o [ée] poss[íi]vel localizar o caminho',   // HKLM sem admin: a chave nao foi criada
    'unauthorized',
    'not permitted',
    'permiss[õo]es elevadas',        // DISM: "Permissões elevadas obrigatórias"
    'exige eleva[çc][ãa]o',         // netsh: "exige elevação"
    'privil[ée]gios de administrador',
    'membro do grupo administradores',
    // a própria classe da exceção: vale mesmo se o Windows estiver em outro idioma
    'UnauthorizedAccessException',
    'AccessDeniedException',
    // espanhol (o notebook do cliente pode estar em ES)
    'operaci[óo]n no autorizada',
    'no autorizado',
  ].join('|'), 'i');

  // O recurso não existe — não é permissão, é o ambiente.
  const NAO_EXISTE = new RegExp([
    'n[ãa]o existe',
    'n[ãa]o foi encontrad',
    'n[ãa]o [ée] poss[íi]vel localizar',
    'cannot find',
    'does not exist',
    'was not found',
    'n[ãa]o especificad',
  ].join('|'), 'i');

  if (SEM_PERMISSAO.test(e)) {
    const adm = await ehAdmin();
    if (!adm) return "Este ajuste precisa de administrador. Use o botao Reabrir como admin, na faixa vermelha no topo da tela.";
    return "O Windows bloqueou esta mudanca mesmo como administrador. Pode ser politica da empresa ou antivirus.";
  }
  if (NAO_EXISTE.test(e)) {
    return "Este recurso nao existe nesta versao do Windows.";
  }

  // Erro desconhecido: NUNCA devolver o texto do PowerShell.
  //
  // Antes o fallback pegava a primeira linha "limpa" do stderr e devolvia ao usuário.
  // Isso vazava texto de cmdlet e de exceção .NET na tela (o cliente viu
  // "New-ItemProperty: Tentativa de execução de uma operação não autorizada").
  //
  // O GDZ não tem esse problema porque o texto de erro dele é escrito pelo próprio app
  // (marcador GDZ_ERRO na stdout); aqui a regra passa a ser a mesma ideia: o texto é
  // nosso, só o detalhe curto vai entre parênteses.
  const limpo = String(e)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^\s*\+/.test(l) && !/\.ps1:\d+/.test(l) && !/^No linha|^At line/.test(l)) || '';
  // Tira o prefixo de cmdlet ("New-ItemProperty : ") e corta o tamanho.
  const curto = String(limpo).replace(/^[\w.-]{2,40}\s*:\s*/, '').slice(0, 90).trim();
  // Se o que sobrou ainda parece texto técnico, descarta.
  const tecnico = /Exception|\.NET|System\.|CategoryInfo|FullyQualifiedErrorId|\\|Cmdlet|cmdlet|ParameterBinding/i.test(curto);
  // Já é uma frase nossa ou repete a nossa mensagem: não duplicar.
  const jaEMensagem = /^o Windows n[ãa]o aceitou a mudan/i.test(curto) || /^tente abrir o VL/i.test(curto);
  const detalhe = curto && !tecnico && !jaEMensagem ? ' (' + curto + ')' : '';
  return 'o Windows nao aceitou a mudanca' + detalhe + '. Tente abrir o VL como administrador.';
}

// Confere no NODE o StartType de um serviço depois de tentar mudar.
//
// Mesmo com o trap, o Svc() ainda pode terminar sem mudar nada em algum caso
// (política, serviço protegido). A leitura é refeita por fora e comparada.
//
// Medido nesta máquina: o Get-Service devolve StartType VAZIO quando o serviço está
// Disabled, e o Get-CimInstance está quebrado (Namespace inválido). O que funciona sem
// admin é o `sc query`, que responde pelo EXIT CODE: 1060 = serviço não existe, e o
// TIPO de início de um serviço parado não está ali. Para o StartType sem admin, o teste
// no Node usa Get-Service e, quando vem vazio, conclui 'Disabled' (o único caso em que
// o Get-Service omite o tipo sem que o serviço tenha sumido).
async function confereServico(nome, esperado) {
  try {
    const n = String(nome).replace(/'/g, "''");
    // existência: sc query tem exit code confiável mesmo com nome localizado
    const r = await ps(`& sc.exe query '${n}' 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Output 'AUSENTE' } else { $t = [string](Get-Service -Name '${n}' -ErrorAction SilentlyContinue).StartType; if (-not $t) { Write-Output 'Disabled' } else { Write-Output $t } }`, 20000);
    const atual = String(r.out || '').trim();
    if (!atual) return { ok: false, atual: 'desconhecido' };
    if (atual === 'AUSENTE') return { ok: false, atual: 'AUSENTE' };
    if (String(esperado) === 'Qualquer') return { ok: true, atual };
    let igual = atual.toLowerCase() === String(esperado).toLowerCase();
    if (String(esperado).toLowerCase() === 'automatic' && /^auto/i.test(atual)) igual = true;
    return { ok: igual, atual };
  } catch (e) { return { ok: false, atual: 'erro' }; }
}

// Confere se um script de "de uma vez" REALMENTE mexeu nos serviços que ele cita.
// runOnce() não tinha conferência nenhuma: "Serviços Desativados" respondia concluído
// com o Spooler ainda Disabled (ou seja, sem mudar nada) porque o Set-Service negado
// não virava erro. Só entram aqui os serviços que o próprio script MANDA mudar.
function servicosDoScript(script) {
  const s = String(script || '');
  const achados = [];
  const add = (nome, modo) => { if (nome && !achados.some((a) => a.nome === nome)) achados.push({ nome, modo }); };
  const ESC = (x) => String(x).replace(/'/g, "''");
  const nomes = (bruto) => {
    let lista = [];
    bruto.split(',').forEach((p) => {
      const q = p.trim().replace(/^['"]|['"]$/g, '').trim();
      if (q) lista.push(q);
    });
    return lista;
  };
  let m;
  // Svc 'X' 'Disabled'  /  Svc 'X' 'Manual'
  const reSvc = /\bSvc\s+(['"][^'"]+['"])\s+(['"][^'"]+['"])/g;
  while ((m = reSvc.exec(s))) add(ESC(m[1].slice(1, -1)), m[2].slice(1, -1));
  // Set-Service -Name X -StartupType Y   (e -StartupType antes de -Name)
  const reSet = /\bSet-Service\b[^\n]*/g;
  while ((m = reSet.exec(s))) {
    const linha = m[0];
    const nm = /-Name\s+(['"]?)([A-Za-z0-9_.\-]+)\1/.exec(linha);
    const st = /-StartupType\s+(['"]?)([A-Za-z0-9_.\- ]+?)\1(?=[\s;|]|$)/.exec(linha);
    if (nm && st) add(ESC(nm[2]), st[2].trim());
  }
  // sc config X start= disabled / demand
  const reSc = /\bsc(\.exe)?\s+(config|CONFIG)\s+([A-Za-z0-9_.\-]+)\s+start=\s*(\w+)/g;
  while ((m = reSc.exec(s))) {
    const modo = { disabled: 'Disabled', demand: 'Manual', auto: 'Automatic', delayed: 'Automatic' }[String(m[4]).toLowerCase()] || m[4];
    add(ESC(m[3]), modo);
  }
  // Stop-Service -Name X / X,Y  -> continua do jeito que estava: só confere se existiu.
  const reStop = /\b(?:Stop-Service|Restart-Service)\b[^\n]*/g;
  while ((m = reStop.exec(s))) {
    const nm = /-(?:Name|DisplayName|ServiceName)\s+((?:['"]?[A-Za-z0-9_.\-]+['"]?\s*,\s*)*['"]?[A-Za-z0-9_.\-]+['"]?)/.exec(m[0]);
    if (nm) nomes(nm[1]).forEach((x) => { if (!achados.some((a) => a.nome === ESC(x))) add(ESC(x), null); });
  }
  // Stop-Service 'a','b'  (posicional)
  const reStop2 = /\b(?:Stop-Service|Restart-Service)\s+((?:'[^']+'\s*,\s*)*'[^']+')/g;
  while ((m = reStop2.exec(s))) nomes(m[1]).forEach((x) => { if (!achados.some((a) => a.nome === ESC(x))) add(ESC(x), null); });
  // Start-Service 'a'  e  =& sc stop a
  const reStart = /\bStart-Service\s+((?:'[^']+'\s*,\s*)*'[^']+')/g;
  while ((m = reStart.exec(s))) nomes(m[1]).forEach((x) => { if (!achados.some((a) => a.nome === ESC(x))) add(ESC(x), null); });
  const reScStop = /\bsc(\.exe)?\s+(stop|START|start)\s+([A-Za-z0-9_.\-]+)/g;
  while ((m = reScStop.exec(s))) add(ESC(m[3]), null);
  return achados;
}

async function confereScript(name, script) {
  const alvos = servicosDoScript(script);
  for (const alvo of alvos) {
    const c = await confereServico(alvo.nome, alvo.modo || 'Qualquer');
    if (alvo.modo && !c.ok) {
      if (c.atual === 'AUSENTE') return { ok: false, service: alvo.nome, error: 'O serviço ' + alvo.nome + ' não existe neste Windows.' };
      return { ok: false, service: alvo.nome, error: 'O serviço ' + alvo.nome + ' continua em ' + c.atual + '. Para mexer em serviços o VL precisa de administrador.' };
    }
    if (!alvo.modo && c.atual === 'AUSENTE') {
      return { ok: false, service: alvo.nome, error: 'O serviço ' + alvo.nome + ' não existe neste Windows.' };
    }
  }
  return { ok: true };
}
async function applyTweak(id, want) {
  const t = tweakById(id);
  if (!t) return { success: false, error: 'ajuste desconhecido' };
  const key = 'tweak:' + id;
  const regs = tweakRegs(t);
  const svcs = t.svc || [];
  zeraErro(t);
  if (want) {
    // 1. Estado ANTES — lido UMA vez, só em memória (o disco só recebe o backup se der certo).
    const antesLido = regs.length ? await lerAnterior(regs) : { reg: [], tipos: {} };
    const antes = antesLido.reg;
    if (regs.length || svcs.length) {
      const lines = [];
      for (const r of regs) {
        const v = typeof r.on === 'string' ? `'${r.on}'` : r.on;
        lines.push(`Set-Val '${r.path}' '${r.name}' ${v} '${r.type}'`);
      }
      for (const s of svcs) lines.push(`Svc '${s}' 'Disabled'`);
      const r = await ps(lines.join('\n'), 60000);
      if (!r.ok) {
        t._ultimoErro = r.err;
        // A chave que não pôde ser criada é PERMISSÃO, não "recurso não existe":
        // "New-ItemProperty : Não foi possível localizar o caminho 'HKLM:\…'" era
        // classificado como NAO_EXISTE e o cliente lia "este recurso nao existe nesta
        // versao do Windows" para um ajuste que só precisava de administrador.
        const err = String(r.err || '');
        descartaBackupOrfao(key);
        if (/HKLM:|Acesso |negad|denied|permitid|UnauthorizedAccess/i.test(err)) {
          return { success: false, on: false, error: await erroDePermissao('acesso negado: ' + err) };
        }
        return { success: false, on: false, error: await erroDePermissao(err) };
      }
      // O PowerShell deste app roda com ErrorActionPreference SilentlyContinue: um throw
      // não chega aqui como erro. Conferir CADA serviço no Node é a única prova real.
      for (const s of svcs) {
        const c = await confereServico(s, 'Disabled');
        if (!c.ok) {
          t._ultimoErro = 'service';
          descartaBackupOrfao(key);
          return {
            success: false,
            on: false,
            error: c.atual === 'AUSENTE'
              ? ('O serviço ' + s + ' não existe neste Windows.')
              : ('O serviço ' + s + ' continua em ' + c.atual + '. Para mexer em serviços o VL precisa de administrador.'),
          };
        }
      }
      if (r.err && /acesso negado|access denied|denied/i.test(String(r.err))) { t._ultimoErro = r.err; }
    }
    if (t.on) {
      const r = await ps(t.on, 60000);
      if (!r.ok) {
        t._ultimoErro = r.err;
        descartaBackupOrfao(key);
        return { success: false, on: false, error: await erroDePermissao(r.err) };
      }
      if (r.err && /acesso negado|access denied|denied/i.test(String(r.err))) { t._ultimoErro = r.err; }
    }

    // 2. Estado DEPOIS — REGRAVADO. O retorno do PowerShell não é prova de nada.
    const depois = regs.length ? await lerRegsAtuais(regs) : null;
    const noAlvo = await tweakNoAlvo(t, depois || [], true);

    if (noAlvo) {
      if (regs.length && mesmaCoisa(antes, depois)) {
        // O valor pedido JÁ era o valor do Windows ANTES desta chamada: aplicar não fez
        // nada. Não é permissão (o valor está lá) nem sucesso (nada mudou). Dizer
        // "precisa de administrador" mandaria o cliente tentar em vão.
        descartaBackupOrfao(key);
        return { success: false, on: true, error: MSG_JA_ESTAVA };
      }
      // Só agora o backup faz sentido: o valor anterior deixou de existir para sempre.
      if (regs.length || svcs.length) await backupDoAnterior(key, regs, svcs, antes);
      return { success: true, on: true };
    }

    // Não bateu no alvo. O backup (se existir) é lixo: apaga para o desfazer não travar
    // e para o "desfazer" nunca ser oferecido para uma mudança que não aconteceu.
    descartaBackupOrfao(key);
    // A aplicação FALHOU. Sem admin essa é a causa comum e a mensagem tem de dizer isso,
    // em vez do genérico "o Windows nao aceitou a mudanca".
    let souAdmin = false;
    try { souAdmin = await ehAdmin(); } catch (e) { souAdmin = false; }
    if (!souAdmin) {
      t._ultimoErro = null;
      return { success: false, on: false, error: await erroDePermissao('acesso negado') };
    }
    return { success: false, on: false, error: await mensagemDeFalhaTweak(t) };
  }
  // desligar = restaurar o backup exato
  const st = loadBackups()[key];
  let restaurado = false;
  if (st) {
    const rb = await restoreBackup(key);
    if (!rb.success) return { success: false, error: rb.error };
    // O restoreBackup já conferiu o registro. Aqui só falta o caso de item sem registro.
    restaurado = true;
  } else if (t.off) {
    // Antes o resultado era descartado: se o script falhasse, a funcao ainda podia
    // responder sucesso. Agora um erro do PowerShell volta como erro.
    const r = await ps(t.off, 60000);
    if (!r.ok) return { success: false, on: true, error: await erroDePermissao(r.err || 'falha') };
  } else if (regs.length) {
    const lines = regs.map((r) => `Set-Val '${r.path}' '${r.name}' ${typeof r.off === 'string' ? `'${r.off}'` : r.off} '${r.type}'`);
    const r = await ps(lines.join('\n'), 60000);
    if (!r.ok) return { success: false, on: true, error: await erroDePermissao(r.err || 'falha') };
  }
  // Mesma regra ao contrário: reler e só dizer que desfez se o estado real voltou.
  // Antes perguntava ao probeTweak, que responde "está ligado?" — e nos ajustes em que
  // "ligado" é o valor de fábrica (bing, bsod-detail) o desfazer dizia ter falhado com
  // o Windows já restaurado, e o backup era jogado fora.
  const depoisRev = regs.length ? await lerRegsAtuais(regs) : null;
  const noLugar = restaurado || (await tweakNoAlvo(t, depoisRev || [], false));
  if (noLugar) {
    // O restoreBackup apaga o seu próprio backup. O que sobrou é do caso t.off/regs.
    if (!st) descartaBackupOrfao(key);
    return { success: true, on: false };
  }
  return { success: false, on: true, error: 'nao foi possivel desfazer. ' + await erroDePermissao(t && t._ultimoErro) };
}

// Duas leituras de registro são o mesmo estado?
function mesmaCoisa(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!!a[i].existe !== !!b[i].existe) return false;
    if (String(a[i].texto) !== String(b[i].texto)) return false;
  }
  return true;
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
  if (lines.length) {
    const r = await ps(lines.join('\n'), 60000);
    if (!r.ok) return { success: false, error: await erroDePermissao(r.err) };
    // Mesmo motivo do applyTweak: conferir no Node, não confiar no retorno do PowerShell.
    for (const s of svcs) {
      const c = await confereServico(s, 'Disabled');
      if (!c.ok) {
        return {
          success: false,
          error: c.atual === 'AUSENTE'
            ? ('O serviço ' + s + ' não existe neste Windows.')
            : ('O serviço ' + s + ' continua em ' + c.atual + '. Para mexer em serviços o VL precisa de administrador.'),
        };
      }
    }
  }
  if (a.run) {
    const r = await ps(a.run, 120000);
    // Mesmo tratamento do runOnce/runTool: saída com texto de permissão é falha, e o
    // stderr cru nunca vai para a tela.
    const v = resultadoPs(r, r.out);
    if (!v.ok) {
      const texto = v.erroVisivel || (v.semPermissao ? v.saidaOk : '') || 'falha';
      return { success: false, error: await erroDePermissao(texto) };
    }
    if (r.out.includes('noobs')) return { success: false, error: 'OBS não encontrado neste PC.' };
  }
  const msg = a.restart === 'reboot' ? 'Vale depois de reiniciar o PC.' : undefined;
  return { success: true, message: msg };
}

// Tira da saída do PowerShell o que não pode ir para a tela do cliente:
// texto de erro de cmdlet, bloco CategoryInfo, bytes nulos do DISM, caminho do .ps1.
const pareceSaidaDeErro = (txt) => /CategoryInfo|FullyQualifiedErrorId|^\s*\+/m.test(String(txt || ''));

function limpaSaida(txt) {
  return String(txt || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*\+/.test(l) && !/\.ps1:\d+/.test(l) && !/^(No linha|At line|CategoryInfo|FullyQualifiedErrorId)/i.test(l) && !/\d+ characters?/.test(l))
    .join('\n')
    .trim();
}

// Congela cada caractere como o motor VÊ a saída do PowerShell.
//
// O console do PowerShell 5.1 entrega a saída em OEM (CP850) e o Node lê como UTF-8:
// medido nesta máquina, "Permissões" chega como "Permiss<U+FFFD>..." e "execução"
// chega sem o 'ç'. Se a mensagem for montada com o texto original, o cliente lê
// "Permiss��es" no toast — a mensagem que sobra parecia correta na medição por estar
// num arquivo UTF-8, mas na tela ela herda o estrago do console.
//
// Aqui, antes de entregar ao erroDePermissao(): separa o texto do erro (que é UTF-8,
// o próprio Windows escreve na exceção) e só o que veio do console passa pelo mesmo
// estrago de encoding. Sem isso, o reconhecimento da falta de permissão depende de
// acento que nunca chega.
function descaracterizaConsole(txt) {
  return String(txt || '')
    .split('')
    .map((c) => (/[\u00C0-\u00FF]/.test(c) ? '\uFFFD' : c))
    .join('');
}

function aoProblema(msg) {
  return { erroVisivel: String(msg || ''), reportado: descaracterizaConsole(msg) };
}

// Texto do DISM/cmdlet que, mesmo na SAÍDA padrão, significa "não tenho permissão".
// Medido: `Dism /Online /Cleanup-Image /StartComponentCleanup 2>&1` sem elevação
// escreve "Erro: 740 ... Permissões elevadas obrigatórias para execução do DISM."
// na SAÍDA padrão e o exit code do PowerShell continua 0.
//
// NADA DE ACENTO AQUI. O console do PowerShell 5.1 codifica a saída em OEM (CP850),
// não em UTF-8. Medido nesta máquina: o texto real chega ao Node com o 'õ' de
// "Permissões" trocado por U+FFFD ("Permiss��es") e o 'ç' de "execução" perdido.
// Um regex com acento NUNCA casa com a saída de verdade — foi assim que o
// "Permissões elevadas obrigatórias" do DISM passou como sucesso.
const CARIMBO_SEM_PERMISSAO = /erro\s*[:]\s*7\s?40|erro\s+740|permiss[^\s]{0,4} elevadas|privil[e\u00e9]gios elevados|acesso negado|access denied|executar como administrador|run this command as an administrator|elevated privileges|elevation required|opera[^\s]{1,3}o n[a\u00e3]o autorizada|no autorizado|access is denied|administrador|administrator/i;

// Para "de uma vez" e ferramentas: o que estiver na saída DE ERRO é tratado como erro,
// independente do exit code — é o único jeito de o cliente não ver "concluído" com o
// erro do Windows colado do lado.
function resultadoPs(r, saida) {
  const saidaOk = String(saida || '');
  const erroVisivel = String(r.err || '').trim();
  const semPermissao = CARIMBO_SEM_PERMISSAO.test(erroVisivel) || CARIMBO_SEM_PERMISSAO.test(saidaOk);
  return { ok: !!r.ok && !erroVisivel && !semPermissao, semPermissao, erroVisivel, saidaOk };
}

// O que o cliente lê quando a ferramenta ou o "de uma vez" falhou por permissão.
//
// Texto FIXO, sem acento e sem copiar nada da ferramenta: o erro do DISM vem do
// console em OEM e chega ao Node com o acento estragado ("Permiss��es"). Mensagem
// montada a partir dele aparece quebrada na tela.
const MSG_PRECISA_ADMIN = 'Precisa de administrador para este item. Use o botao Reabrir como admin, na faixa vermelha no topo da tela.';

async function mensagemDaFalha(v) {
  const temSaida = !!(v.saidaOk && v.saidaOk.trim());
  if (v.semPermissao || CARIMBO_SEM_PERMISSAO.test(v.erroVisivel || '')) return MSG_PRECISA_ADMIN;
  const msgErro = await erroDePermissao(v.erroVisivel || 'falha');
  // Se a saída só tem lixo técnico, não citar.
  const saidaUtil = v.semPermissao ? '' : limpaSaida(v.saidaOk);
  return saidaUtil && podeCitarSaida(saidaUtil) ? (msgErro + ' (' + saidaUtil.slice(0, 120) + ')') : msgErro;
}

function podeCitarSaida(txt) {
  // Sem o '\.NET' e sem o '\\' soltos: "System.ServiceProcess.ServiceController" é o
  // que o Out-String de um Get-Service devolve (sem exceção nenhuma), e o '\\' do
  // caminho do Windows não é texto de erro. Medido: as duas regras barravam o "ok".
  return !!txt && !/Exception|System\.|CategoryInfo|FullyQualifiedErrorId|Cmdlet|cmdlet|ParameterBinding|\uFFFD/i.test(txt);
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
  if (a.revert) {
    const r = await ps(a.revert, 60000);
    // Saída com texto de permissão também é falha, mesmo com exit code 0.
    if (!r.ok || CARIMBO_SEM_PERMISSAO.test(String(r.err || '')) || CARIMBO_SEM_PERMISSAO.test(String(r.out || ''))) {
      return { success: false, error: await erroDePermissao(r.err || r.out || 'falha') };
    }
    return { success: true };
  }
  return { success: false, error: 'sem backup' };
}

async function runOnce(name) {
  const o = ONCES[name];
  if (!o) return { success: false, error: 'ação desconhecida' };
  const r = await ps(o.run, 180000);
  const v = resultadoPs(r, r.out);
  // Conferência extra: os scripts de serviço ("Serviços Desativados", "Desativar
  // Atualizações Windows") diziam "concluído" sem ter mudado nada sem admin.
  const conf = v.ok ? await confereScript(name, o.run) : { ok: true };
  if (v.ok && !conf.ok) return { success: false, error: conf.error };
  if (!v.ok) {
    // NUNCA repassar o stderr cru: só a mensagem do erroDePermissao().
    return { success: false, error: await mensagemDaFalha(v) };
  }
  if (v.ok) {
    // Leituras de efeito declaradas pelo próprio script ("removed=3", "services=...")
    // são conferidas por fora. "UWP Removidos" respondia success:true com removed=0.
    const prova = await provaDeEfeito(o.prova, v.saidaOk);
    if (!prova.ok) return { success: false, error: prova.error };
  }
  const msg = limpaSaida(v.saidaOk).slice(0, 200);
  return { success: true, message: msg || 'concluído' };
}

function valorDesaida(txt, chave) {
  const m = new RegExp(chave + '\\s*=\\s*(\\d+)', 'i').exec(String(txt || ''));
  return m ? Number(m[1]) : null;
}

async function provaDeEfeito(prova, saida) {
  if (!prova) return { ok: true };
  if (prova.tipo === 'contador') {
    const n = valorDesaida(saida, prova.chave || 'removed');
    if (n === null) return { ok: true };
    if (n > 0) return { ok: true };
    return { ok: false, error: prova.mensagem || 'Nenhum item foi alterado. O Windows nao mudou nada: isso precisa de administrador.' };
  }
  if (prova.tipo === 'itens') {
    const alvos = prova.itens || [];
    for (const it of alvos) {
      const c = await confereServico(it.nome, it.modo || 'Qualquer');
      if (c.atual === 'AUSENTE') return { ok: false, error: 'O serviço ' + it.nome + ' não existe neste Windows.' };
      if ((it.modo || 'Qualquer') !== 'Qualquer' && !c.ok) {
        return { ok: false, error: 'O serviço ' + it.nome + ' continua em ' + c.atual + '. Para mexer em serviços o VL precisa de administrador.' };
      }
    }
  }
  return { ok: true };
}

async function runTool(id) {
  const t = TOOLS[id];
  if (!t) return { success: false, error: 'ferramenta desconhecida' };
  const r = await ps(t.run, t.long ? 60 * 60 * 1000 : 120000);
  const v = resultadoPs(r, r.out);
  if (!v.ok) {
    // DISM sem admin: "Erro: 740 ... Permissões elevadas obrigatórias" fica na saída
    // padrão e o PowerShell termina com 0. Aqui vira success:false.
    return { success: false, error: await mensagemDaFalha(v) };
  }
  const msg = limpaSaida(v.saidaOk).slice(-400);
  return { success: true, message: msg || 'ok' };
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
  if (!r.ok) return { success: false, error: await erroDePermissao(r.err || 'falha') };
  let dado = null;
  try { dado = JSON.parse(r.out); } catch (e) { dado = null; }
  if (!dado || typeof dado !== 'object') {
    // O Json do PowerShell é uma linha só. Se a saída não abre, não é resposta: antes
    // isso aparecia como "resposta inválida" sem explicar nada.
    return { success: false, error: 'a verificação não respondeu. Tente de novo em alguns segundos.' };
  }
  return { success: true, ...dado };
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
  // expostos para as medições (nao usados pelo app)
  servicosDoScript, confereServico, confereScript, resultadoPs, limpaSaida, mensagemDaFalha,
};
