// engine.js — motor do VL Optimizer
// Executa cada ajuste de verdade: PowerShell elevado, registro, serviços, powercfg, netsh.
// Tudo com backup: o "desfazer" restaura o valor exato que o Windows tinha antes.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A fotografia do estado do Windows (8 tipos de item, como o GDZ).
//
// Fica em arquivo separado de propósito: o script PowerShell embutido tem cifrão e
// barra invertida que brigam com o template literal do JavaScript. Separado, cada
// lado é validado com a sua própria ferramenta e não há como um quebrar o outro.
//
// A função recebe o `ps` por parâmetro para não criar ciclo de require.
const { fotoSistema } = require('./foto-sistema');
// O caminho de volta do fotoSistema: os 8 tipos que o lerAnterior/restoreBackup
// não cobrem (svc, scheme, pwr, bcd, tcp, dns, drs). Mesmo padrão: o `ps` entra
// por parâmetro para não criar ciclo de require.
const { desfazerFoto } = require('./restaurar-sistema');

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
  # VL: converte "1,2,3" em byte[] quando o destino é REG_BINARY.
  #
  # Sem isso, Set-ItemProperty recebia a string "02,00,00,00,00,00,00,00,00,00,00,00"
  # e gravava os CARACTERES como bytes — 33 bytes de lixo no lugar dos 12 reais.
  # Em StartupApproved\Run isso diz ao Windows que TODOS os programas de boot
  # mudaram de estado, e o cliente perde a inicialização automática.
  if ($t -eq 'Binary' -and $v -is [string]) {
    $pedacos = $v -split '[,;\s]+' | Where-Object { $_ -ne '' }
    $bytes = @()
    foreach ($p2 in $pedacos) {
      $num = 0
      if ([int]::TryParse($p2, [ref]$num)) { $bytes += [byte]([math]::Min(255, [math]::Max(0, $num))) }
    }
    if ($bytes.Count -gt 0) { $v = [byte[]]$bytes }
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
  # VL: so inicia quando o tipo pedido e Automatic.
  # Antes iniciava sempre, inclusive quando o pedido era Manual — e um Start-Service
  # que falha deixa o serviço com o tipo novo e parado, que é um estado que o
  # cliente não pediu.
  elseif ($mode -eq 'Automatic') { Start-Service -Name $n -ErrorAction SilentlyContinue }
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
// VL: Add-Type roda FORA do try.
//
// Todo script do motor é embrulhado em try{} (ver psCorpo). Acontece que
// `Add-Type -TypeDefinition` compila um arquivo .cs temporário e precisa
// resolver o caminho dele; dentro de um try de um .ps1 a posição é sintética e
// a compilação falha com TypeDefinitionError SEMPRE. Com o erro engolido pelo
// try, o ajuste "funcionava" sem fazer nada.
//
// Aqui: quando o script tem Add-Type, ele vai para antes do try. Se não compilar,
// o erro aparece de verdade.
function separaAddType(script) {
  const linhas = String(script).split(String.fromCharCode(10));
  const fora = [];
  const dentro = [];
  for (const l of linhas) {
    if (/^\s*Add-Type\b/.test(l) || /^\s*\$vlTipos\b/.test(l)) fora.push(l);
    else dentro.push(l);
  }
  return { fora: fora.join(String.fromCharCode(10)), dentro: dentro.join(String.fromCharCode(10)) };
}

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
    cat: 'desempenho', title: 'Modo de Jogo do Windows', rec: true, tags: ['FPS mais estável'],
    desc: 'Quando um jogo abre, o Windows segura atualizações e tarefas de fundo e dá prioridade de processador e placa de vídeo para ele.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', type: 'DWord', on: 1, off: 0 }],
    // O Windows assume Modo de Jogo LIGADO quando o valor NÃO existe (padrao: 1).
    //
    // O probe testava só `-eq 1`: com o valor ausente respondia 0 = desligado, a tela
    // mostrava DESLIGADO com o Windows LIGADO, e o cliente clicava em "ligar" num
    // ajuste que já estava ligado. O GDZ testa `-eq 0` (ausente não é 0, logo não está
    // desligado) — mesma semântica aplicada aqui.
    probe: `$v = Get-Val '${HKCU}\\Software\\Microsoft\\GameBar' 'AutoGameModeEnabled'; if ($null -eq $v) { $v = 1 }; if ($v -eq 1) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  T('steam-overlay', {
    cat: 'desempenho', title: 'Sobreposição do Steam (Shift+Tab) desligada', tags: ['Mais FPS'],
    desc: 'Desliga a tela que o Steam abre por cima do jogo com o Shift+Tab. Ela injeta código em todo jogo do Steam e é causa conhecida de queda de FPS, travadinhas e conflito com outros programas de captura.',
    reg: [{ path: HKCU + '\\Software\\Valve\\Steam', name: 'EnableGameOverlay', type: 'DWord', on: 0, off: 1 }],
    note: 'O Steam fecha e abre de novo para a alteração valer. Sem a sobreposição você perde o chat, o navegador e as conquistas por cima do jogo (e o Steam Input de alguns controles).',
    // GDZ: `caps.steamPath ? null : "O Steam não está instalado neste PC."`. O caminho
    // vem de HKCU\Software\Valve\Steam\SteamPath e só vale se steam.exe estiver lá.
    block: (caps) => caps.steamPath ? null : 'O Steam não está instalado neste PC.',
  }),
  T('bg-apps', {
    cat: 'desempenho', title: 'Sem apps da Loja rodando escondidos', tags: ['PC fraco'],
    desc: 'Apps instalados pela Microsoft Store (Clima, Fotos, Xbox, Your Phone...) param de rodar em segundo plano quando estão fechados.',
    note: 'Apps da Loja, como o WhatsApp, deixam de mostrar notificações com a janela fechada.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', name: 'GlobalUserDisabled', type: 'DWord', on: 1, off: 0 }],
  }),
  T('edge-bg', { rec: true,
    cat: 'desempenho', title: 'Edge fechado de verdade', tags: ['PC fraco'],
    desc: 'Impede o Edge de abrir escondido junto com o Windows e de continuar rodando depois que você fecha a janela. Devolve memória e deixa a inicialização mais leve.',
    note: 'Nas configurações do Edge vai aparecer "Gerenciado pela sua organização". É normal: é assim que o Windows marca essa regra.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Edge', name: 'BackgroundModeEnabled', type: 'DWord', on: 0, off: 1 }],
  }),
  // 'dlss-ind' REMOVIDO: não existe no GDZ.
  //
  // O catálogo do GDZ (33 tweaks, extraído por execução isolada do bundle)
  // não tem 'dlss-ind', nem 'ShowDlssIndicator', nem 'NGXCore' — zero
  // ocorrências dos três. Ele tem só o 'dlss-rec'.
  //
  // Este ajuste foi escrito aqui sem referência: foi invenção. Sai do catálogo.
T('dlss-rec', {
    cat: 'desempenho', title: 'DLSS no modelo recomendado pela NVIDIA', cap: 'rtx', tags: ['Imagem', 'Mais FPS'],
    desc: 'Os jogos com DLSS passam a usar a versao mais nova que o driver tem, com o modelo que a NVIDIA recomenda para cada modo: o DLSS 4.5 nos modos Desempenho e Ultra Desempenho e o DLSS 4 nos outros. E o botao Recomendado de Substituicao do DLSS na NVIDIA App. A imagem dos modos mais leves melhora, entao da para trocar Qualidade por Desempenho dentro do jogo e ganhar FPS.',
    note: 'O preset fica na NVIDIA App (Sobreposicao/Substituicao do DLSS).',
    // GDZ: `!rtx ? "Só para placas de vídeo NVIDIA RTX..." : !nvapi ? "O driver da
    // NVIDIA não está instalado neste PC." : null`. Duas causas, não uma: ter a placa
    // não basta, o driver precisa estar instalado — sem ele o DLSS nem existe.
    block: (caps) => !caps.rtx
      ? 'Só para placas de vídeo NVIDIA RTX, que são as que têm DLSS.'
      : !caps.nvapi
        ? 'O driver da NVIDIA não está instalado neste PC.'
        : null,
  }),
  T('gpu-msi', {
    cat: 'desempenho', title: 'Placa de vídeo com interrupção MSI e prioridade alta', tags: ['Menos atraso'],
    desc: 'A placa de vídeo passa a avisar o processador pelo modo moderno (MSI), em vez de dividir uma linha de interrupção antiga com outros dispositivos, e o Windows atende esse aviso na frente dos demais. É o que o MSI Utility faz, sem instalar programa nenhum. Costuma tirar travadinhas e encurtar o tempo entre o clique e o tiro.',
    note: 'Vale só depois de reiniciar o PC. Se a imagem ficar estranha ou o PC travar ao iniciar, desligue aqui de novo (ou use um ponto de restauração).',
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
    // GDZ: `caps.gpuIrq ? null : "Não encontrei uma placa de vídeo dedicada NVIDIA ou AMD
    // neste PC."` — `gpuIrq` só existe quando há dGPU NVIDIA/AMD com PNP PCI válido, que
    // é justamente o que o script acima precisa achar para ter onde gravar.
    block: (caps) => caps.gpuIrq ? null : 'Não encontrei uma placa de vídeo dedicada NVIDIA ou AMD neste PC.',
  }),
  T('mpo', {
    cat: 'desempenho', title: 'Correção de tela piscando (MPO)', tags: ['Estabilidade'],
    desc: 'Desliga o Multiplane Overlay, causa conhecida de tela piscando, faixas pretas e travadinhas com G-Sync/FreeSync ou com dois monitores.',
    // OverlayTestMode = 5 desliga o MPO. O off era 5 também, então aplicar e desaplicar
    // gravavam o mesmo valor e o ajuste nunca mudava nada. Agora desaplicar volta para 0.
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\DWM', name: 'OverlayTestMode', type: 'DWord', on: 5, off: 0 }],
    note: 'Só ative se você tem esse problema. Sem ele, não muda nada.',
  }),
  T('transparency', {
    cat: 'desempenho', title: 'Sem transparência nas janelas', tags: ['PC fraco'],
    desc: 'Desliga o efeito de vidro fosco da barra de tarefas, do menu Iniciar e das janelas. A placa de vídeo para de desfocar o fundo o tempo todo, o que alivia PC com vídeo integrado.',
    note: 'Com placa de vídeo dedicada a diferença no FPS é praticamente zero. A barra de tarefas e os menus ficam com cor sólida.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', type: 'DWord', on: 0, off: 1 }],
  }),
  // — Mouse e teclado
  T('mouse-accel', {
    cat: 'inputlag', title: 'Mira sem aceleração do mouse', rec: true, tags: ['Mira consistente'],
    desc: 'Desliga a "Precisão do ponteiro aprimorada". O cursor anda sempre a mesma distância para o mesmo movimento da mão, e a memória muscular da mira funciona.',
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
    cat: 'inputlag', title: 'Teclado repetindo na velocidade máxima', tags: ['Resposta imediata'],
    desc: 'Põe no máximo as duas réguas de "Propriedades do Teclado": o intervalo até a tecla começar a repetir vai para o mais curto e a taxa de repetição para a mais rápida. Segurar A ou D passa a responder no primeiro instante.',
    note: 'Vale para o Windows todo: digitando, segurar uma tecla enche a linha de letras mais rápido.',
    reg: [
      { path: HKCU + '\\Control Panel\\Keyboard', name: 'KeyboardDelay', type: 'String', on: '0', off: '1' },
      { path: HKCU + '\\Control Panel\\Keyboard', name: 'KeyboardSpeed', type: 'String', on: '31', off: null },
    ],
  }),
  T('sticky', { padrao: "506", rec: true,
    cat: 'inputlag', title: 'Sem janelas de acessibilidade no meio do jogo', tags: ['Nada abrindo sozinho'],
    desc: 'Apertar Shift 5 vezes ou segurar Num Lock/Shift não abre mais as janelas de Teclas de Aderência e Filtragem no meio da partida. Os recursos continuam nas Configurações.',
    reg: [{ path: HKCU + '\\Control Panel\\Accessibility\\StickyKeys', name: 'Flags', type: 'String', on: "0", off: "506" }],
  }),
  T('numlock', {
    cat: 'inputlag', title: 'Num Lock ligado ao iniciar', tags: ['Praticidade'],
    desc: 'O teclado numérico já vem ligado na tela de login e quando você entra no Windows.',
    reg: [{ path: HKCU + '\\Control Panel\\Keyboard', name: 'InitialKeyboardIndicators', type: 'String', on: '2', off: '0' }],
  }),
  // — Internet
  T('delivery', { padrao: 0, rec: true,
    cat: 'live', title: 'Sem upload de atualizações para outros PCs', tags: ['Internet livre'],
    desc: 'O Windows para de enviar pedaços de atualizações para computadores de outras pessoas pela internet. Sobra upload para o jogo, a chamada e a live.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization', name: 'SystemSettingsDownloadMode', type: 'DWord', on: 2, off: 0 }],
  }),
  T('lso', {
    cat: 'live', title: 'LSO da placa de rede desligado', tags: ['Live'],
    desc: 'Com o LSO (Large Send Offload) quem divide os envios grandes é a placa de rede, e não o processador. Alguns drivers (Intel I219/I225 e certos Realtek) fazem isso com defeito: upload lento, Discord e live engasgando ou a conexão caindo do nada. Desligar resolve nesses casos.',
    note: 'Só ative se você tem esse problema: não muda o ping nem o FPS do FiveM, e o processador trabalha um pouco mais em upload pesado. A internet cai por alguns segundos ao ligar e ao desligar.',
    on: `Get-NetAdapter | Disable-NetAdapterLso -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    off: `Get-NetAdapter | Enable-NetAdapterLso -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `$l = @(Get-NetAdapterLso -ErrorAction SilentlyContinue | Where-Object { $_.Enabled }); if ($l.Count -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
    // GDZ: `caps.nicLso.length ? null : "Nenhuma placa de rede deste PC tem LSO para desligar."`
    block: (caps) => caps.nicLso.length ? null : 'Nenhuma placa de rede deste PC tem LSO para desligar.',
  }),
  T('eee', {
    cat: 'live', title: 'Economia de energia da placa de rede desligada (EEE)', tags: ['Rede'],
    desc: 'O EEE (Energy Efficient Ethernet) e o Green Ethernet põem a placa de rede para "cochilar" entre um pacote e outro e gastar menos energia. Com alguns roteadores e switches isso dá defeito: a conexão cai e volta, o ping dá picos ou a velocidade do cabo cai para 100 Mb. Desligar resolve nesses casos.',
    note: 'É correção, não ganho de ping: com a rede funcionando bem, não muda nada no FiveM. A internet cai por alguns segundos ao ligar e ao desligar.',
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
    // GDZ (`nicOptOf(caps, NIC_EEE)`): as palavras-chave de EEE que o driver desta
    // placa realmente declara. Sem nenhuma, o script acima não tem o que desligar.
    block: (caps) => caps.nicOpt.filter((x) => NIC_EEE.includes(x.n)).length
      ? null
      : 'Nenhuma placa de rede com cabo deste PC tem EEE ou Green Ethernet para desligar.',
  }),
  T('nic-intmod', {
    cat: 'live', title: 'Placa de rede sem moderação de interrupção', tags: ['Ping'],
    desc: 'Por padrão a placa de rede junta vários pacotes antes de avisar o processador. Sem a moderação ela avisa a cada pacote, e o pacote chega ao jogo uma fração de milissegundo antes.',
    note: 'O ganho é menor que 1 ms: não espere ver diferença no ping. Em troca o processador trabalha mais durante downloads e lives, e é ele que limita o FPS do FiveM. Não use em PC fraco. A internet cai por alguns segundos ao ligar e ao desligar.',
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
# RegistryValue vem como String[] em algumas placas (medido: Ethernet -> String[]).
# [int] num String[] lança exceção e derrubava TODOS os probes do app.
# Comparar como texto funciona para os dois formatos.
else { $off = @($p | Where-Object { (@($_.RegistryValue) -join '') -eq '0' }); if ($off.Count -eq $p.Count) { Write-Output '1' } else { Write-Output '0' } }`,
    // GDZ (`nicOptOf(caps, NIC_INTMOD)`): sem a palavra-chave na placa, o ajuste não tem
    // onde agir.
    block: (caps) => caps.nicOpt.filter((x) => NIC_INTMOD.includes(x.n)).length
      ? null
      : 'Nenhuma placa de rede deste PC tem moderação de interrupção para desligar.',
  }),  T('hibernate', { padrao: 1, rec: true,
    cat: 'limpeza', title: 'Desligar de verdade (sem hibernação)', tags: ['Espaço em disco'],
    desc: 'Desativa a hibernação e a Inicialização Rápida. O "Desligar" passa a zerar o Windows (drivers e memória limpos a cada boot) e o arquivo hiberfil.sys some, liberando alguns GB no disco C:.',
    note: 'O PC pode levar alguns segundos a mais para ligar. Em notebook, você perde a opção Hibernar.',
    on: `powercfg /h off; Write-Output 'ok'`,
    off: `powercfg /h on; Write-Output 'ok'`,
    probe: `$h = Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Power' 'HibernateEnabled'; if ($null -eq $h -or $h -eq 0) { Write-Output '1' } else { Write-Output '0' }`,
  }),
  // — Windows: privacidade
  T('telemetry', {
    cat: 'tweaks', title: 'Telemetria e anúncios personalizados', rec: true, tags: ['Privacidade'],
    desc: 'Desliga o serviço que envia dados de uso para a Microsoft, o ID de propaganda e as pesquisas de "dê sua opinião". Um processo a menos rodando o tempo todo.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowTelemetry', type: 'DWord', on: 0, off: 1 }],
    svc: ['DiagTrack'],
  }),
  T('suggestions', {
    cat: 'tweaks', title: 'Sem sugestões, dicas e apps instalados sozinhos', rec: true, tags: ['Privacidade'],
    desc: 'O Windows para de instalar apps promovidos (joguinhos, TikTok...) e tira as "sugestões" do Iniciar e das Configurações e as dicas que aparecem na tela.',
    reg: [
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338388Enabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338389Enabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SystemPaneSuggestionsEnabled', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('bing', { rec: true,
    cat: 'tweaks', title: 'Pesquisa do Iniciar sem Bing', tags: ['Privacidade'],
    desc: 'A pesquisa do menu Iniciar procura só no seu PC: sem resultados da web e sem sugestões do Bing. Fica mais rápida e o que você digita não vai para a internet.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'DisableWebSearch', type: 'DWord', on: 1, off: 0 }],
  }),
  T('activity', { rec: true,
    cat: 'tweaks', title: 'Sem histórico de atividades', tags: ['Privacidade'],
    desc: 'O Windows para de registrar quais arquivos, sites e apps você abriu e de enviar esse histórico para a sua conta Microsoft.',
    reg: [
      { path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'PublishUserActivities', type: 'DWord', on: 0, off: 1 },
      { path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'UploadUserActivities', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('widgets', { padrao: 0,
    cat: 'tweaks', title: 'Sem Widgets (notícias e clima)', rec: true, tags: ['Mais FPS'],
    desc: 'Tira o painel de notícias e clima da barra de tarefas e impede que ele fique carregado em segundo plano: são centenas de MB de memória a menos.',
    reg: [{ path: ADV, name: 'TaskbarDa', type: 'DWord', on: 0, off: 1 }],
    restart: 'reboot',
  }),
  T('location', {
    cat: 'tweaks', title: 'Localização desligada', tags: ['Privacidade'],
    desc: 'Nenhum app consegue saber onde você está.',
    note: 'O fuso horário automático, o Clima e o "Localizar meu dispositivo" deixam de funcionar.',
    reg: [{ path: HKLM + '\\SOFTWARE\\Policies\\Microsoft\\Windows\\LocationAndSensors', name: 'DisableLocation', type: 'DWord', on: 1, off: 0 }],
  }),
  // — Windows: praticidade
  T('end-task', { rec: true,
    cat: 'tweaks', title: 'Finalizar tarefa pela barra de tarefas', tags: ['Praticidade'],
    desc: 'Botão direito num programa na barra de tarefas → "Finalizar tarefa". Fecha na hora um jogo travado, sem abrir o Gerenciador de Tarefas.',
    reg: [{ path: ADV, name: 'TaskbarEndTask', type: 'DWord', on: 1, off: 0 }],
    // GDZ: `caps.build && caps.build < 22631 ? "Requer Windows 11 23H2 ou mais novo." : null`.
    // O `build &&` é do GDZ e é o que importa: sem leitura (build 0) NÃO bloqueia — um
    // ajuste de barra de tarefas não pode virar refém de uma falha de leitura do Windows.
    block: (caps) => caps.build && caps.build < 22631 ? 'Requer Windows 11 23H2 ou mais novo.' : null,
  }),
  T('file-ext', { rec: true,
    cat: 'tweaks', title: 'Mostrar a extensão dos arquivos', tags: ['Praticidade'],
    desc: 'Mostra o final do nome dos arquivos (.exe, .zip, .pdf). Ajuda a não abrir vírus disfarçado, como "foto.jpg.exe".',
    reg: [{ path: ADV, name: 'HideFileExt', type: 'DWord', on: 0, off: 1 }],
  }),
  T('hidden-files', {
    cat: 'tweaks', title: 'Mostrar arquivos ocultos', tags: ['Praticidade'],
    desc: 'Mostra pastas escondidas como a AppData, onde ficam configs e saves de muitos jogos.',
    reg: [{ path: ADV, name: 'Hidden', type: 'DWord', on: 1, off: 2 }],
  }),
  T('this-pc', {
    cat: 'tweaks', title: 'Explorador abre em "Este Computador"', tags: ['Praticidade'],
    desc: 'Ao abrir o Explorador (Win+E) você cai direto nos seus discos, em vez da página Início com arquivos recentes.',
    reg: [{ path: ADV, name: 'LaunchTo', type: 'DWord', on: 1, off: 2 }],
  }),
  T('classic-menu', {
    cat: 'tweaks', title: 'Menu do botão direito completo', restart: 'explorer', tags: ['Praticidade'],
    desc: 'Volta o menu de contexto do Windows 10, com todas as opções, sem precisar clicar em "Mostrar mais opções".',
    reg: [],
    on: `New-Key '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32'; Set-ItemProperty -LiteralPath '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32' -Name '(default)' -Value '' -Force; Write-Output 'ok'`,
    off: `Remove-Item -Path '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}' -Recurse -Force -ErrorAction SilentlyContinue; Write-Output 'ok'`,
    probe: `if (Test-Path '${HKCU}\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}') { Write-Output '1' } else { Write-Output '0' }`,
    // GDZ: `WIN11` = `caps.build && caps.build < 22000 ? "Só existe no Windows 11." : null`
    block: (caps) => caps.build && caps.build < 22000 ? 'Só existe no Windows 11.' : null,
  }),
  T('dark', {
    cat: 'tweaks', title: 'Tema escuro', tags: ['Visual'],
    desc: 'Deixa o Windows e os apps compatíveis no modo escuro.',
    // Igual ao GDZ (tweak nº 28 de 33, categoria windows).
    // Havia sido removido aqui por engano: a varredura que disse "0 ocorrências" foi
    // feita no código OFUSCADO, onde a string está em RC4 e não aparece como texto.
    // Executando o bundle, o tweak está lá — com estes mesmos dois valores.
    reg: [
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'AppsUseLightTheme', type: 'DWord', on: 0, off: 1 },
      { path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'SystemUsesLightTheme', type: 'DWord', on: 0, off: 1 },
    ],
  }),
  T('task-view', {
    cat: 'tweaks', title: 'Esconder o botão Visão de Tarefas', tags: ['Aparência'],
    desc: 'Tira da barra o botão de áreas de trabalho virtuais. O atalho Win+Tab continua funcionando.',
    reg: [{ path: ADV, name: 'ShowTaskViewButton', type: 'DWord', on: 0, off: 1 }],
  }),
  T('taskbar-left', {
    cat: 'tweaks', title: 'Barra de tarefas à esquerda', tags: ['Visual'],
    desc: 'Botão Iniciar e ícones no canto esquerdo, como no Windows 10.',
    note: 'Só existe no Windows 11.',
    cap: 'win11',
    reg: [{ path: ADV, name: 'TaskbarAl', type: 'DWord', on: 0, off: 1 }],
    // GDZ: `WIN11` — mesma trava do classic-menu, com o texto dele.
    block: (caps) => caps.build && caps.build < 22000 ? 'Só existe no Windows 11.' : null,
  }),
  T('search-icon', {
    cat: 'tweaks', title: 'Pesquisa da barra só como ícone', tags: ['Aparência'],
    desc: 'Troca a caixa de pesquisa larga por uma lupa e libera espaço na barra de tarefas.',
    reg: [{ path: HKCU + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Search', name: 'SearchboxTaskbarMode', type: 'DWord', on: 1, off: 2 }],
  }),
  T('bsod-detail', {
    cat: 'tweaks', title: 'Tela azul com detalhes do erro', tags: ['Diagnóstico'],
    desc: 'Se o PC der tela azul, ela mostra o código e o arquivo que causou o erro. É a pista para achar o culpado (driver de vídeo, overclock, memória...).',
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
# $u = powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null   # nao duplicar plano: cada clique criava uma copia
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
  // 'Efeitos Visuais Off' REMOVIDO: o GDZ não tem esse ajuste.
  //
  // Medido: o Explorer IGNORA VisualFXSetting — a chave mudava mas nada na tela
  // mudava. O ajuste não fazia nem o bem nem o mal, MAS o desfazer gravava 0
  // (padrão) por cima do 3 ("melhor aparência") que o dono tinha escolhido,
  // perdendo a configuração dele sem aviso.
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
    desc: 'Desliga fax, registro remoto, mapas offline e leitor de digital.',
    note: 'Não use se você entra no Windows pela digital ou usa digital para senhas.',
    svcs: [
'Fax', 'RemoteRegistry', 'MapsBroker', 'WbioSrvc'],
    detect: `$all = @(
'Fax','RemoteRegistry','MapsBroker','WbioSrvc'); $d = 0; foreach ($n in $all) { $s = Get-Service -Name $n -ErrorAction SilentlyContinue; if ($s -and $s.StartType -eq 'Disabled') { $d++ } }; if ($d -ge 4) { Write-Output '1' } else { Write-Output '0' }`,
    // O Spooler (impressora) saiu desta lista: num PC com impressora o cliente perdia
    // a impressão sem perceber. Fax e os outros continuam.
    revert: `Svc 'Fax' 'Manual'; Svc 'RemoteRegistry' 'Disabled'; Svc 'MapsBroker' 'Automatic'; Svc 'WbioSrvc' 'Manual'; Write-Output 'ok'`,
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
  // ══════════════════════════════════════════════════════════════════════
  // '720p Boost Ativo' REMOVIDO
  //
  // A struct DEVMODE era declarada com 6 inteiros (24 bytes); a real tem 220.
  // EnumDisplaySettings escrevia 196 bytes fora do objeto gerenciado e o
  // ChangeDisplaySettings recebia uma struct com dmFields e dmPelsWidth nos
  // offsets errados, sem CDS_TEST e sem rollback. Em notebook isso pode deixar a
  // tela preta. O backup ia para %TEMP% e já não existia (o "desfazer" respondia
  // ok sem fazer nada).
  //
  // Para voltar a existir, precisa ser reescrito com a struct completa, CDS_TEST
  // antes de aplicar, conferência do retorno e rollback automático em 15 s, e
  // testado num PC que não seja o do dono.
  // ══════════════════════════════════════════════════════════════════════
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
    desc: 'Faz o Windows cuidar do arquivo de paginação. Sem ele, jogos pesados fecham do nada e o Windows fica sem memória.',
    // VL: automatico de verdade.
    //
    // Gravar PagingFiles vazio NAO basta. Medido na maquina do dono: a chave ficou
    // vazia, o Windows passou a ler '?:\\pagefile.sys' e o pagefile.sys nunca foi
    // criado. Sem paginacao o Windows nao tem onde guardar memoria: o Explorer
    // travou ("Area de Trabalho nao esta respondendo") e programas cairam com oom.
    //
    // O automatico do Windows sao DUAS coisas juntas:
    //   1. Win32_ComputerSystem.AutomaticManagedPagefile = True
    //   2. PagingFiles vazio (o Windows calcula o tamanho)
    //
    // O `on` faz as duas. O `detect` so diz ligado quando as duas valem. O
    // `revert` grava um tamanho explicito razoavel em vez de deixar nulo.
    regs: [{ path: HKLM + '\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management', name: 'PagingFiles', type: 'MultiString', on: '', off: null }],
    on: `
      $mm = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management'
      try {
        $cs = Get-WmiObject Win32_ComputerSystem -EnableAllPrivileges -ErrorAction Stop
        if (-not $cs.AutomaticManagedPagefile) {
          $cs.AutomaticManagedPagefile = $true
          $cs.Put() | Out-Null
        }
      } catch { }
      Set-ItemProperty -LiteralPath $mm -Name PagingFiles -Value @() -Type MultiString -Force -ErrorAction SilentlyContinue
      Write-Output 'ok'`,
    detect: `
      $auto = $false
      try { $auto = [bool](Get-WmiObject Win32_ComputerSystem -ErrorAction Stop).AutomaticManagedPagefile } catch { }
      $v = Get-Val '${HKLM}\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'PagingFiles'
      $tem = $false
      if ($null -ne $v) { $tem = (@($v | Where-Object { $_ -ne $null -and ([string]$_).Trim() -ne '' }).Count -gt 0) }
      if ($auto -and -not $tem) { Write-Output '1' } else { Write-Output '0' }`,
    revert: `
      $mm = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management'
      Set-ItemProperty -LiteralPath $mm -Name PagingFiles -Value @('C:\pagefile.sys 2048 8192') -Type MultiString -Force -ErrorAction SilentlyContinue
      Write-Output 'ok'`,
  },
};

const ACTION_NAMES = Object.keys(ACTIONS);

// Ações "uma vez" (sem desfazer) e ferramentas
const ONCES = {
  'Otimização Rápida': {
    tag: 'desempenho', title: 'Otimização Rápida', btn: 'Otimizar',
    desc: 'Aplica de uma vez: plano de energia, Modo de Jogo, gravação em segundo plano desligada e aceleração do mouse desligada.',
    // Confirmação obrigatória.
    //
    // Um clique aplicava 7 mudanças no sistema sem aviso e sem um lugar único para
    // desfazer. O plano de energia em notebook na bateria é o mais arriscado:
    // processador em 100% sem boost esquenta e o Windows entra em throttling.
    confirm: true,
    run: `
      # Notebook na bateria? Usa o plano Equilibrado em vez de forçar desempenho.
      # Medido: em algumas máquinas o GUID do "Alto Desempenho" nem existe, e o
      # 8c5e7fda que usávamos aqui era um plano de terceiro ("Galdino Tech MAX FPS").
      $vlEhNotebookNaBateria = $false
      try {
        $bat = Get-CimInstance Win32_Battery -ErrorAction Stop
        if ($bat -and ($bat | Where-Object { $_.BatteryStatus -ne 2 })) { $vlEhNotebookNaBateria = $true }
      } catch { }
      $vlPlano = "381b4222-f694-41f0-9685-ff5bb260df2e"   # Equilibrado
      if (-not $vlEhNotebookNaBateria) {
        # procura o Alto Desempenho pelo NOME, não por GUID fixo
        $vlAlto = (powercfg /list | Select-String "Alto Desempenho|High performance" | Select-Object -First 1)
        if ($vlAlto) {
          $m = [regex]::Match($vlAlto.ToString(), "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
          if ($m.Success) { $vlPlano = $m.Groups[1].Value }
        }
      }
      powercfg /setactive $vlPlano
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
    // Reiniciar o Explorer é legítimo — é a própria finalidade desta ação. O risco do
    // P1-5 era outro: matar o shell de TODOS os usuários sem verificar. Aqui:
    //   - só reinicia se houver sessão interativa (o usuário está logado);
    //   - espera o processo realmente sair antes de subir de novo;
    //   - confirma que voltou; se não voltar, tenta de novo uma vez.
    // Escrever no HKCU não depende de elevation, então não é preciso rodar como admin
    // para isso funcionar.
    run: `
      $meu = Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId }
      if (-not $meu) { Write-Output 'sem-explorer'; exit 0 }
      $meu | Stop-Process -Force -ErrorAction SilentlyContinue
      $limite = (Get-Date).AddSeconds(10)
      while ((Get-Date) -lt $limite) {
        if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 300
      }
      Start-Sleep -Milliseconds 800
      Start-Process explorer.exe -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      $voltou = Get-Process -Name explorer -ErrorAction SilentlyContinue
      if (-not $voltou) { Start-Process explorer.exe -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
      if (Get-Process -Name explorer -ErrorAction SilentlyContinue) { Write-Output 'ok' } else { Write-Output 'falhou' }`,
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
  'restore-point': { title: 'Criar ponto de restauração', btn: 'Criar ponto', desc: 'Todo ajuste do VL já tem volta. O ponto de restauração é uma garantia extra do próprio Windows.', long: true, run: `
      $k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
      $old = (Get-ItemProperty -LiteralPath $k -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
      # O Windows aceita só um ponto a cada 24h. Sem esta liberação, o segundo
      # pedido do dia falha e o app respondia 'ok' do mesmo jeito — o cliente
      # achava que tinha ponto de restauração e não tinha.
      Set-ItemProperty -LiteralPath $k -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord -Force -ErrorAction SilentlyContinue
      try {
        Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction Stop
        Checkpoint-Computer -Description 'VL Optimizer' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
        Write-Output ('Ponto de restauração criado em ' + (Get-Date -Format 'dd/MM HH:mm') + '. Se algo der errado, use Restauração do Sistema no Windows.')
      } catch {
        throw ('O Windows não criou o ponto de restauração (' + $_.Exception.Message + '). Verifique se a Proteção do Sistema está ligada para o disco C:.')
      } finally {
        if ($null -eq $old) { Remove-ItemProperty -LiteralPath $k -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue }
        else { Set-ItemProperty -LiteralPath $k -Name SystemRestorePointCreationFrequency -Value $old -Type DWord -Force -ErrorAction SilentlyContinue }
      }`,
},
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
    $act = @((Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false -and $_.InterfaceDescription -notmatch 'VPN|Virtual|Hyper-V|VMware|VirtualBox|Loopback|TAP|TUN|Radmin|WireGuard|Tailscale' }) -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
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
      $idx = @((Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false -and $_.InterfaceDescription -notmatch 'VPN|Virtual|Hyper-V|VMware|VirtualBox|Loopback|TAP|TUN|Radmin|WireGuard|Tailscale' }) -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
      if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
      foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ResetServerAddresses -ErrorAction SilentlyContinue }
      Write-Output 'ok'`);
    return { success: r.ok, dns: 'auto' };
  }
  const list = srv.map((s) => `'${s}'`).join(',');
  const r = await ps(`
    $idx = @((Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Virtual -eq $false -and $_.InterfaceDescription -notmatch 'VPN|Virtual|Hyper-V|VMware|VirtualBox|Loopback|TAP|TUN|Radmin|WireGuard|Tailscale' }) -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex })
    if (-not $idx.Count) { $idx = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.InterfaceIndex }) }
    foreach ($i in $idx) { Set-DnsClientServerAddress -InterfaceIndex $i -ServerAddresses ${list} -ErrorAction SilentlyContinue }
    Write-Output 'ok'`);
  return { success: r.ok, dns: provider };
}

// ── Capacidades do PC ──
//
// A ficha do PC que o motor consulta para DECIDIR o que pode ser aplicado. É o
// `buildCaps` do GDZ (extraído de gdz-SEM-MANGLE.js, ver TIME/i2-bloqueios-FEITO.md),
// copiado literalmente: as regras de vendor/integrada/RTX/x3dDual/paths são as
// mesmas, porque é delas que as travas dependem.
//
// O que mudou em relação ao getCaps anterior:
//   - `obsExe` era um BOOLEANO (Test-Path de "C:\Program Files\obs-studio\...");
//     agora é o caminho ou null, achado pelo registro do OBS (HKLM\SOFTWARE\OBS
//     Studio). Antes, um OBS instalado em outro disco respondia "não encontrado".
//   - `steamPath`, `gpuIrq`, `nicLso`, `nicOpt`, `nvapi`, `rtxOld`, `gpuName` não
//     existiam — e sem eles as travas de steam-overlay, gpu-msi, lso, eee,
//     nic-intmod e dlss-rec não teriam o que consultar.
//   - `gpus` agora traz `{name, vendor, integrated}`, com o vendor vindo do
//     PNPDeviceID (VEN_10DE/VEN_1002/VEN_8086) e a integrada separada da dedicada.
//   - `x3dDual` usa a regex do GDZ `\b(7900X3D|7950X3D|9900X3D|9950X3D|7945HX3D)\b`,
//     que inclui o 7945HX3D de notebook.
const NIC_EEE = ['*EEE', 'EEE', 'AdvancedEEE', 'EEELinkAdvertisement', 'EnableGreenEthernet'];
const NIC_INTMOD = ['*InterruptModeration'];
const NIC_KW = [...NIC_EEE, ...NIC_INTMOD];
const NIC_CLASS = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e972-e325-11ce-bfc1-08002be10318}';

const capsQuote = (x) => "'" + String(x).replace(/'/g, "''") + "'";

// CAPS_PS do GDZ, copiado. Devolve o JSON bruto; quem tipa e sanitiza é o buildCaps.
const CAPS_PS = `
$ProgressPreference = 'SilentlyContinue'
$c = Get-CimInstance Win32_Processor | Select-Object -First 1
$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name = [string]$_.Name; pnp = [string]$_.PNPDeviceID } })
$cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$obsDir = (Get-ItemProperty 'HKLM:\\SOFTWARE\\OBS Studio' -ErrorAction SilentlyContinue).'(default)'
$obs = $null
if ($obsDir) { $obs = Join-Path $obsDir 'bin\\64bit\\obs64.exe'; if (-not (Test-Path -LiteralPath $obs)) { $obs = $null } }
# O Steam grava o caminho com barras ao contrário ("c:/program files (x86)/steam").
$steam = $null
$sp = [string](Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath
if ($sp) { $sp = ($sp -replace '/', '\\').TrimEnd('\\'); if (Test-Path -LiteralPath (Join-Path $sp 'steam.exe')) { $steam = $sp } }
# Placas de rede físicas que têm LSO: a opção existe quando o driver declara a palavra-chave em
# Ndi\\Params (o valor em si só aparece depois que alguém muda no Gerenciador de Dispositivos).
$lso = @()
# Economia de energia (EEE) e moderação de interrupção: guarda também o padrão de fábrica do
# driver (Ndi\\Params\\<nome>\\default), que é para onde o ajuste volta ao ser desligado.
$nicOpt = @()
$nicIds = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.InterfaceGuid })
foreach ($nk in @(Get-ChildItem -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e972-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue)) {
  $np = Get-ItemProperty -LiteralPath $nk.PSPath -Name NetCfgInstanceId -ErrorAction SilentlyContinue
  if (-not $np -or ($nicIds -notcontains [string]$np.NetCfgInstanceId)) { continue }
  if (Test-Path -LiteralPath "$($nk.PSPath)\\Ndi\\Params\\*LsoV2IPv4") {
    $lso += [ordered]@{ k = $nk.PSChildName; v6 = (Test-Path -LiteralPath "$($nk.PSPath)\\Ndi\\Params\\*LsoV2IPv6") }
  }
  foreach ($kw in @(${NIC_KW.map(capsQuote).join(',')})) {
    $kp = "$($nk.PSPath)\\Ndi\\Params\\$kw"
    if (Test-Path -LiteralPath $kp) {
      $nicOpt += [ordered]@{ k = $nk.PSChildName; n = $kw; d = [string](Get-ItemProperty -LiteralPath $kp -Name default -ErrorAction SilentlyContinue).default }
    }
  }
}
$o = [ordered]@{
  cpuName = [string]$c.Name; cpuVendor = [string]$c.Manufacturer
  gpus = $g; laptop = (@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0)
  build = [int]$cv.CurrentBuildNumber; ubr = [int]$cv.UBR; obsExe = $obs; steamPath = $steam
  discord = [bool]((Test-Path (Join-Path $env:LOCALAPPDATA 'Discord')) -or (Test-Path (Join-Path $env:APPDATA 'discord')))
  nicLso = @($lso); nicOpt = @($nicOpt)
  nvapi = (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\\nvapi64.dll'))
}
Write-Output (Json $o)`;

// buildCaps do GDZ, copiado. Os nomes _0x foram trocados por nomes legíveis; a
// lógica é a mesma linha por linha.
function buildCaps(entrada) {
  const s = (x) => (typeof x === 'string' ? x.trim() : '');
  const d = entrada || {};
  const cpuName = s(d.cpuName);
  const gpus = (Array.isArray(d.gpus) ? d.gpus : d.gpus ? [d.gpus] : [])
    .map((g) => {
      const pnp = s(g && g.pnp).toUpperCase();
      const vendor = pnp.includes('VEN_10DE') ? 'nvidia' : pnp.includes('VEN_1002') ? 'amd' : pnp.includes('VEN_8086') ? 'intel' : 'other';
      const name = s(g && g.name);
      const integrated = (vendor === 'intel' && !/\bArc\b/i.test(name)) ||
        (vendor === 'amd' && /Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+|Radeon \d{3}M\b/i.test(name));
      return { name, vendor, integrated, pnp };
    })
    .filter((g) => g.name && /^PCI\\/i.test(g.pnp));
  const temDiscreta = (v) => gpus.some((g) => g.vendor === v && !g.integrated);
  const dgpu = gpus.find((g) => !g.integrated && (g.vendor === 'nvidia' || g.vendor === 'amd')) || null;
  const pnpOk = dgpu && /^PCI\\VEN_[0-9A-F]{4}&DEV_[0-9A-F]{4}[^\\"'<>|?*]*\\[^\\"'<>|?*]+$/i.test(dgpu.pnp) ? dgpu.pnp : null;
  const steam = s(d.steamPath).replace(/\//g, '\\').replace(/\\+$/, '');
  const cpuVendorBruto = s(d.cpuVendor);
  const ehAmd = /AuthenticAMD/i.test(cpuVendorBruto) || /\bAMD\b|Ryzen/i.test(cpuName);
  const ehIntel = !ehAmd && (/GenuineIntel/i.test(cpuVendorBruto) || /Intel/i.test(cpuName));
  const obsBruto = s(d.obsExe);
  return {
    cpuName,
    cpuVendor: ehAmd ? 'amd' : ehIntel ? 'intel' : 'other',
    x3d: ehAmd && /X3D/i.test(cpuName),
    x3dDual: ehAmd && /\b(7900X3D|7950X3D|9900X3D|9950X3D|7945HX3D)\b/i.test(cpuName),
    intelHybrid: ehIntel && (/\b1[2-4]th Gen\b/i.test(cpuName) || /Core\(TM\) Ultra|Core Ultra/i.test(cpuName)),
    gpus: gpus.map(({ pnp, ...resto }) => resto),
    gpuIrq: pnpOk ? 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\' + pnpOk + '\\Device Parameters\\Interrupt Management' : null,
    gpuName: dgpu ? dgpu.name : null,
    steamPath: /^[A-Za-z]:\\[^"'<>|?*]{1,200}$/.test(steam) ? steam : null,
    nicLso: (Array.isArray(d.nicLso) ? d.nicLso : d.nicLso ? [d.nicLso] : [])
      .filter((x) => x && /^\d{4}$/.test(s(x.k)))
      .map((x) => ({ k: s(x.k), v6: x.v6 === true })),
    nicOpt: (Array.isArray(d.nicOpt) ? d.nicOpt : d.nicOpt ? [d.nicOpt] : [])
      .filter((x) => x && /^\d{4}$/.test(s(x.k)) && NIC_KW.includes(s(x.n)) && /^[01]?$/.test(s(x.d)))
      .map((x) => ({ k: s(x.k), n: s(x.n), d: s(x.d) || '1' })),
    discord: d.discord === true,
    nvidia: temDiscreta('nvidia'),
    rtx: gpus.some((g) => g.vendor === 'nvidia' && !g.integrated && /\bRTX\b/i.test(g.name)),
    rtxOld: gpus.some((g) => g.vendor === 'nvidia' && !g.integrated && /\bRTX\s*[23]0\d{2}\b/i.test(g.name)),
    nvapi: d.nvapi === true,
    amdGpu: temDiscreta('amd'),
    laptop: d.laptop === true,
    build: Number.isInteger(d.build) ? d.build : 0,
    ubr: Number.isInteger(d.ubr) ? d.ubr : 0,
    obsExe: /^[A-Za-z]:\\[^"<>|?*]+\\obs64\.exe$/i.test(obsBruto) ? obsBruto : null,
  };
}

async function getCaps() {
  const r = await ps(CAPS_PS, 60000);
  let bruto = null;
  if (r.ok && r.out) { try { bruto = JSON.parse(r.out); } catch (e) { bruto = null; } }
  // Sem leitura, `buildCaps({})` dá a ficha vazia (build 0, sem GPU) — é o que o
  // GDZ faz (`let CAPS = buildCaps({})`), e é o estado mais seguro: as travas
  // que dependem de recurso passam a bloquear em vez de liberar.
  return buildCaps(bruto || {});
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
function regsNoEstado(regs, atuais, want, tw) {
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
function regsNoEstado(regs, atuais, want, tw) {
  const faltando = [];
  regs.forEach((r, i) => {
    const a = atuais && atuais[i];
    const alvo = String(want ? r.on : r.off);
    if (!a) { faltando.push(r.name); return; }
    if (!a.existe) {
      // Valor ausente: o Windows usa o PADRÃO do tweak.
      //
      // Antes: ausente só valia quando `want === false` (desligar). Isso está certo
      // para `widgets` (padrao 0 -> ausente é DESLIGADO), mas inverte o `game-mode`
      // (padrao 1 -> ausente é LIGADO). Com a regra antiga, o game-mode nunca ficava
      // "no alvo" ao ligar, e desligar apagava o valor deixando o Windows ligado.
      //
      // Critério correto: a ausência, traduzida pelo padrão, dá o alvo pedido?
      if (tw && tw.padrao !== undefined) {
        if (String(tw.padrao) !== alvo) faltando.push(r.name);
        return;
      }
      // Sem padrão declarado, ausente só é resultado válido quando o catálogo manda
      // apagar o valor (o `off` é explícito) e estamos desligando.
      if (!(want === false && r.off !== undefined)) faltando.push(r.name);
      return;
    }
    if (a.texto !== alvo) faltando.push(r.name);
  });
  return faltando;
}

async function tweakNoAlvo(t, atuais, want) {
  const regs = tweakRegs(t);
  // Com registro, a prova é a LEITURA DO REGISTRO — não o probe.
  //
  // Antes havia saída antecipada `if (t.probe) return probeTweak(...) === want`: a
  // conferência de registro nunca valia para tweaks com probe, e o `padrao` (que diz o
  // que significa valor ausente) era ignorado. `game-mode` tem probe E reg E padrao — é
  // o único ajuste nesse caso, e era o que exibia o "liga e desliga".
  if (regs.length) return regsNoEstado(regs, atuais, want, t).length === 0;
  // Ajuste sem registro (powercfg, netsh): o probe é a única medida barata.
  return (await probeTweak(t)) === want;
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
async function backupDoAnterior(key, regs, svcs, anteriores, fotoExtra) {
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
  // A foto dos outros 7 tipos vai junto: é dela que o desfazer se serve.
  // Sem esta linha, o fotoSistema lia o estado antes de aplicar e o backup não
  // guardava nada — o ajuste de serviço/plano de energia ficava sem caminho de volta.
  if (Array.isArray(fotoExtra) && fotoExtra.length) st.fotoExtra = fotoExtra;
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
      // Try/Catch PRÓPRIO por probe.
      //
      // Sem isto, um probe que lança exceção (o do nic-intmod lançava ao converter
      // String[] em int) abortava o script todo via trap e TODOS os 8 voltavam
      // "desligado" — o cliente via a aceleração do mouse e o modo de jogo se
      // desligarem sozinhos poucos segundos depois de ligar.
      return `$__probes['${idx}'] = try { @( & { ${seguro} } ) -join ' ' } catch { '0' }`;
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
  // ATENCAO: o GUID acima é o do "Alto Desempenho" original do Windows, mas cada
  // máquina pode ter outro plano ocupando esse GUID (medido: numa das máquinas de
  // teste era "Galdino Tech MAX FPS", um plano de terceiro). Por isso o `run` desta
  // ação procura o plano PELO NOME antes de aplicar, e cai no Equilibrado em notebook
  // na bateria. Ver a ação 'Plano de Alta Performance' abaixo.
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
// ══════════════════════════════════════════════════════════════════════════
// TRAVA NO BACKEND — igual ao blockedActions do GDZ
//
// O `cap:` do catálogo (win11, rtx, x3dDual, obs) era só etiqueta de tela: a
// tela escondia o ajuste, mas o motor aplicava de qualquer jeito se alguém
// chamasse o canal direto. O GDZ recusa NO BACKEND, com erro.
//
// Aqui a mesma regra: se o ajuste exige um recurso que esta máquina não tem, o
// motor responde `success:false` e não toca em nada.
//
// ── O QUE O GDZ FAZ (extraído de gdz-SEM-MANGLE.js) ──
//
//   function blockedActions(caps) {
//     const blocked = {};
//     if (caps.x3dDual) { ...4 ações com o texto do CCD duplo... }
//     else { blocked["Modo X3D Correto"] = "Só para Ryzen 7900X3D, ..."; }
//     if (caps.build && caps.build < 22000) blocked["Jogos em Janela Otimizados"] = "Requer Windows 11.";
//     if (!caps.obsExe) blocked["OBS Prioritário"] = "OBS Studio não encontrado neste PC.";
//     Object.assign(blocked, tweakBlocks(caps));
//     return blocked;
//   }
//
// O mapa é `nomeDaAção → motivo`. É consumido em dois lugares no GDZ:
//   - run-action:  `if (hasOwn(blockedActions(caps), nome)) return { success:false, error: motivo }`
//   - tweak-set:   `const why = tweakBlocks(caps)[tweakAction(t)]; if (why) return { success:false, error: why }`
//   - get-caps:    devolve `{ ...caps, blocked }` — é o que a tela usa para apagar o botão.
//
// ── O QUE MUDOU AQUI ──
//
// Antes, o VL tinha só um `blockedActions(t)` que olhava a etiqueta `cap:` de UM
// ajuste e conhecia 3 recursos (win11/rtx/x3dDual). Faltavam: as 4 ações que
// brigam com X3D de dois CCDs, o X3D Dual liberando as outras, o `obs` virando
// `obsExe`, e o `tweakBlocks` inteiro (7 travas por hardware).
//
// `cap: 'win11'` também estava QUEBRADO: `getCaps()` nunca devolvia um campo
// `win11` — a trava `!caps.win11` era sempre verdadeira, então taskbar-left
// recusava em qualquer Windows, inclusive no 11.
// ══════════════════════════════════════════════════════════════════════════

// GDZ: `tweakAction = t => "Tweak: " + t.id`
const tweakAction = (t) => 'Tweak: ' + t.id;

// GDZ `tweakBlocks`: chama o `block(caps)` de cada TWEAK e guarda o motivo.
// `block` que devolve null/'' não entra.
function tweakBlocks(caps) {
  const blocked = {};
  for (const t of TWEAKS) {
    const motivo = typeof t.block === 'function' ? t.block(caps) : null;
    if (motivo) blocked[tweakAction(t)] = motivo;
  }
  return blocked;
}

// GDZ `blockedActions`. Mesmas regras, mesmos textos, mesma ordem (os dois
// `assign` no fim: X3D primeiro, depois os tweaks por cima).
function blockedActions(caps) {
  const blocked = {};
  if (caps.x3dDual) {
    const msg = 'Não use em Ryzen X3D de dois CCDs: o driver da AMD precisa do plano Equilibrado e da Game Bar para pôr o jogo nos núcleos com cache. Use o Modo X3D Correto.';
    for (const a of ['Plano de Alta Performance', 'Modo Máximo Desempenho', 'Game Bar Desativado', 'Game Bar Removido']) {
      blocked[a] = msg;
    }
  } else {
    blocked['Modo X3D Correto'] = 'Só para Ryzen 7900X3D, 7950X3D, 9900X3D e 9950X3D.';
  }
  // `build &&` é do GDZ: build 0 (leitura falhou) NÃO bloqueia.
  if (caps.build && caps.build < 22000) blocked['Jogos em Janela Otimizados'] = 'Requer Windows 11.';
  if (!caps.obsExe) blocked['OBS Prioritário'] = 'OBS Studio não encontrado neste PC.';
  Object.assign(blocked, tweakBlocks(caps));
  return blocked;
}

// O mapa inteiro, pronto para a tela (`get-caps` devolve `{...caps, blocked}`).
async function getBlocked() {
  let caps;
  try { caps = await getCaps(); } catch (e) { return {}; }
  return blockedActions(caps);
}

// A trava de UM ajuste, para o motor recusar antes de tocar em qualquer coisa.
// No GDZ a consulta é `tweakBlocks(caps)["Tweak: " + id]` dentro do `tweak-set`;
// aqui é o mesmo, com o `caps` que já foi lido uma vez nesta chamada.
function bloqueioDoTweak(caps, t) {
  const why = tweakBlocks(caps)[tweakAction(t)];
  if (why) return why;
  // O `cap:` continua valendo como atalho de fabricação do nosso catálogo, mas
  // agora lendo campos que o getCaps REALMENTE devolve (antes `caps.win11` nunca
  // existia). O motivo vem do mapa do GDZ, não de texto novo.
  if (!t.cap) return null;
  const nomes = { win11: 'Só existe no Windows 11.', rtx: null, x3dDual: null, obs: 'OBS Studio não encontrado neste PC.' };
  const doMapa = blockedActions(caps);
  if (t.cap === 'win11' && !(caps.build && caps.build >= 22000)) return nomes.win11;
  if (t.cap === 'rtx' && !caps.rtx) return 'Só para placas de vídeo NVIDIA RTX, que são as que têm DLSS.';
  if (t.cap === 'x3dDual' && !caps.x3dDual) return doMapa['Modo X3D Correto'];
  if (t.cap === 'obs' && !caps.obsExe) return nomes.obs;
  return null;
}

// Faixa de resolução que o app aceita. O GDZ usa a mesma (640..7680) e valida
// antes de chamar o driver. Serve para quem escrever um ajuste de resolução no
// futuro não repetir o erro do "720p Boost", que mandava uma DEVMODE truncada.
function safeRes(w, h) {
  const wi = Number(w), hi = Number(h);
  if (!Number.isFinite(wi) || !Number.isFinite(hi)) return null;
  if (wi < 640 || wi > 7680 || hi < 480 || hi > 4320) return null;
  return { w: Math.round(wi), h: Math.round(hi) };
}

async function applyTweak(id, want) {
  const t = tweakById(id);
  if (!t) return { success: false, error: 'ajuste desconhecido' };
  const key = 'tweak:' + id;
  // Trava no backend: recurso que esta máquina não tem não é aplicado.
  //
  // Mesmo caminho do GDZ `tweak-set`: lê a ficha do PC UMA vez e consulta
  // `tweakBlocks(caps)["Tweak: " + id]`. Sem a ficha, não bloqueia: um tropeço do
  // PowerShell não pode impedir o cliente de aplicar um ajuste que ele já pagou.
  let vlCaps = null;
  try { vlCaps = await getCaps(); } catch (e) { vlCaps = null; }
  if (vlCaps) {
    const vlBloqueio = bloqueioDoTweak(vlCaps, t);
    if (vlBloqueio) return { success: false, on: false, error: vlBloqueio };
  }
  const regs = tweakRegs(t);
  const svcs = t.svc || [];
  zeraErro(t);
  if (want) {
    // 1. Estado ANTES
    //
    // TRAVA DO GDZ: sem a foto do estado atual, NÃO aplica.
    //
    // O GDZ chama takeSnapshot() antes de qualquer tweak e faz `catch { return }`
    // — se não conseguiu ler o que havia antes, não mexe. O VL aplicava e só
    // depois tentava salvar, então um ajuste podia ficar aplicado sem caminho de
    // volta.
    let vlSemFotoNaoAplica = null;
    if (regs.length) {
      try {
        vlSemFotoNaoAplica = await lerAnterior(regs);
        if (!vlSemFotoNaoAplica || !Array.isArray(vlSemFotoNaoAplica.reg)) vlSemFotoNaoAplica = null;
      } catch (e) { vlSemFotoNaoAplica = null; }
      if (!vlSemFotoNaoAplica) {
        return { success: false, on: false, error: 'Nao consegui ler o estado atual do Windows para guardar a foto. Por seguranca, nada foi alterado.' };
      }
    }
    const antesLido = regs.length ? await lerAnterior(regs) : { reg: [], tipos: {} };
    const antes = antesLido.reg;
    // 2. Foto dos tipos que o registro não cobre.
    //
    // O `lerAnterior` acima só lê chaves de registro. O GDZ fotografa mais sete
    // tipos (svc, scheme, pwr, bcd, tcp, dns, drs) e, sem eles, um ajuste que mexe em
    // serviço ou no plano de energia fica aplicado sem o valor original em lugar nenhum.
    //
    // Esta chamada é ADITIVA: devolve a lista extra e não interfere no `lerAnterior`.
    // Se falhar (sem admin, por exemplo), volta vazia e o ajuste segue como antes.
    let fotoExtra = [];
    try {
      const querSvc = svcs.length > 0;
      const querPwr = t.pwr || null;
      const querBcd = t.bcd || null;
      const querTcp = t.tcp || null;
      const querDns = !!t.dns;
      if (querSvc || querPwr || querBcd || querTcp || querDns) {
        fotoExtra = await fotoSistema({
          svc: querSvc ? svcs : undefined,
          pwr: querPwr,
          bcd: querBcd,
          tcp: querTcp,
          dns: querDns,
        }, ps);
      }
    } catch (e) { fotoExtra = []; }
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
      //
      // `fotoExtra` entra aqui porque é o ÚNICO caminho que salva o backup depois de
      // aplicar: sem ele a foto dos outros 7 tipos era lida e jogada fora. A condição
      // também ganhou fotoExtra: um ajuste que só mexe em pwr/bcd/tcp/dns não tem reg
      // nem svc, e antes não passava por aqui — então nem a foto extra era salva.
      if (regs.length || svcs.length || (fotoExtra && fotoExtra.length)) {
        await backupDoAnterior(key, regs, svcs, antes, fotoExtra);
      }
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

  // Apagar o valor pode significar LIGADO.
  //
  // O backup de um ajuste que o usuário nunca tinha mexido registra "não existia", e
  // restaurar isso APAGA o valor. No `game-mode` (padrao: 1) valor ausente = Modo de
  // Jogo LIGADO — então o "desfazer" deixava o Windows ligado e a tela dizendo
  // desligado: era o "liga e volta a desligar" que o cliente viu.
  //
  // Medido antes desta correção: desligar -> AutoGameModeEnabled AUSENTE -> on=true.
  //
  // Aqui: quando o padrão do tweak é igual ao valor de LIGAR e diferente do valor de
  // desligar, apagar viraria "ligado" — nesse caso gravar o `off` explícito, que é
  // inequívoco.
  const apagarViraLigado = !!st && (st.reg || []).some((orig, i) => {
    const r = regs[i];
    if (!r || !orig) return false;
    return !orig.exists && t.padrao !== undefined
      && String(t.padrao) === String(r.on)
      && String(r.off) !== String(t.padrao);
  });

  if (st && !apagarViraLigado) {
    const rb = await restoreBackup(key);
    if (!rb.success) return { success: false, error: rb.error };
    // O restoreBackup já conferiu o registro. Aqui só falta o caso de item sem registro.
    restaurado = true;
  } else if (st && apagarViraLigado && regs.length) {
    // Mesma gravação do caso sem backup, mas o backup precisa ser descartado depois
    // (o estado anterior não pode ser restaurado sem virar "ligado").
    const lines = regs.map((r) => `Set-Val '${r.path}' '${r.name}' ${typeof r.off === 'string' ? `'${r.off}'` : r.off} '${r.type}'`);
    const r = await ps(lines.join('\n'), 60000);
    if (!r.ok) return { success: false, on: true, error: await erroDePermissao(r.err || 'falha') };
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
  // Depois de restaurar o backup de registro, restaurar os tipos extras.
  //
  // O `restoreBackup` acima só sabe voltar reg e svc. Os outros 7 tipos (scheme, pwr,
  // bcd, tcp, dns, drs) foram fotografados pelo fotoSistema e ficam em `st.fotoExtra`:
  // sem esta chamada o ajuste que mexe no plano de energia ou no TCP ficava aplicado
  // sem caminho de volta, e o cliente não tinha como reverter.
  //
  // Vem DEPOIS da cadeia de restore de propósito: o restore.ps1 reativa o plano de
  // energia no fim (powercfg /setacvalueindex só vale depois de /setactive), então
  // precisa rodar por último para não ser desfeito por uma troca de plano anterior.
  //
  // Falha aqui NÃO aborta o desfazer: o que é registro já voltou, e derrubar tudo por
  // causa de um item de DNS deixaria o pior dos mundos (metade desfeito e dito falho).
  const fotoExtra = (st && Array.isArray(st.fotoExtra)) ? st.fotoExtra : [];
  if (fotoExtra.length) {
    try {
      const rf = await desfazerFoto(fotoExtra, ps);
      // O desfazer só é "completo" se os extras também voltaram. Se algum falhou,
      // o ajuste continua contando como não desfeito — mas o que voltou, voltou.
      if (!rf.ok) { restaurado = false; }
    } catch (e) {}
  }
  // Mesma regra ao contrário: reler e só dizer que desfez se o estado real voltou.
  // Antes perguntava ao probeTweak, que responde "está ligado?" — e nos ajustes em que
  // "ligado" é o valor de fábrica (bing, bsod-detail) o desfazer dizia ter falhado com
  // o Windows já restaurado, e o backup era jogado fora.
  const depoisRev = regs.length ? await lerRegsAtuais(regs) : null;
  const noLugar = restaurado || (await tweakNoAlvo(t, depoisRev || [], false));
  if (noLugar) {
    // O restoreBackup apaga o seu próprio backup. O que sobrou é do caso t.off/regs
    // e do caso "apagar viraria ligado", onde o backup não é mais utilizável.
    if (!restaurado) descartaBackupOrfao(key);
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
  // TRAVA NO BACKEND — é o que o GDZ faz no `run-action`:
  //   const blocked = blockedActions(caps);
  //   if (hasOwn(blocked, nome)) return { success:false, error: blocked[nome] };
  //
  // Antes, o VL só travava o `applyTweak`. As 4 ações que brigam com Ryzen X3D de
  // dois CCDs rodavam por aqui de qualquer jeito: elas mudam de plano de energia
  // e desligam a Game Bar, que é exatamente o que o driver da AMD precisa para
  // pôr o jogo nos núcleos com cache. Por canal direto, o cliente com 7950X3D
  // derrubava a própria configuração.
  //
  // Fica ANTES do backup e de qualquer alteração: ação recusada não deixa lixo.
  let vlCaps = null;
  try { vlCaps = await getCaps(); } catch (e) { vlCaps = null; }
  if (vlCaps) {
    const vlBlocked = blockedActions(vlCaps);
    if (Object.prototype.hasOwnProperty.call(vlBlocked, name)) {
      return { success: false, error: vlBlocked[name] };
    }
  }
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
    // O check anterior pegava a PRIMEIRA placa de vídeo do sistema. Num notebook
    // ou num Ryzen com gráfico integrado essa é a iGPU, então o aviso de driver
    // velho podia sair para a placa errada. Este é o do GDZ: filtra por fabricante
    // real (NVIDIA/AMD/Intel), ignora a integrada, e confere o Resizable BAR pelo
    // nvidia-smi.
    run: `
      $level = 'ok'; $title = 'Placa de vídeo em ordem'; $lines = New-Object System.Collections.ArrayList
      foreach ($v in @(Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -match 'VEN_(10DE|1002|8086)' })) {
        $age = if ($v.DriverDate) { [int]((Get-Date) - $v.DriverDate).TotalDays } else { 0 }
        [void]$lines.Add("$($v.Name): driver $($v.DriverVersion)" + $(if ($v.DriverDate) { ' de ' + $v.DriverDate.ToString('dd/MM/yyyy') } else { '' }))
        $integrada = $v.Name -match 'Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+|Radeon \d{3}M\b'
        if ($v.PNPDeviceID -match 'VEN_(10DE|1002)' -and -not $integrada -and $age -gt 180) { $level = 'warn'; $title = 'Driver de vídeo desatualizado'; [void]$lines.Add("O driver tem $age dias. Drivers novos trazem correções e ganho de desempenho em jogos recentes.") }
      }
      $hags = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name HwSchMode -ErrorAction SilentlyContinue).HwSchMode
      [void]$lines.Add('Agendamento de GPU acelerado (HAGS): ' + $(if ($hags -eq 2) { 'ligado' } else { 'desligado. Ligue para usar o DLSS Frame Generation.' }))
      if ($hags -ne 2 -and $title -eq 'Placa de vídeo em ordem') { $level = 'warn'; $title = 'HAGS desligado' }
      $smi = @("$env:SystemRoot\System32\nvidia-smi.exe", "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
      if ($smi) {
        $q = & $smi -q -d MEMORY 2>$null | Out-String
        $m = [regex]::Match($q, '(?s)BAR1 Memory Usage\s+Total\s*:\s*(\d+)\s*MiB')
        if ($m.Success) {
          if ([int]$m.Groups[1].Value -gt 256) { [void]$lines.Add('Resizable BAR: ligado.') }
          else { $level = 'warn'; if ($title -eq 'Placa de vídeo em ordem') { $title = 'Resizable BAR desligado' }; [void]$lines.Add('Resizable BAR desligado: ative "Above 4G Decoding" e "Re-Size BAR" na BIOS (dá ganho em vários jogos).') }
        }
      }
      $o = @{ level = $level; title = $title; lines = $lines }; Write-Output (Json $o)`,
  },
  ram: {
    title: 'Memória',
    // O check anterior comparava com $m.Speed (o que o pente DECLARA) e calculava
    // $ch (BankLabel) sem nunca usar — então dual channel nunca era detectado. Este
    // é o do GDZ: geração DDR, velocidade do kit pelo PartNumber, canal único e 16 GB.
    run: `
      $lines = New-Object System.Collections.ArrayList
      $mods = @(Get-CimInstance Win32_PhysicalMemory)
      if (-not $mods.Count) { $o = @{ level = 'info'; title = 'Não foi possível ler a memória'; lines = @() }; Write-Output (Json $o); return }
      $cfg = [int](($mods | Measure-Object ConfiguredClockSpeed -Maximum).Maximum)
      $t = [int]$mods[0].SMBIOSMemoryType
      $gen = if ($t -eq 34) { 'DDR5' } elseif ($t -eq 26) { 'DDR4' } else { 'DDR' }
      $gb = [math]::Round((($mods | Measure-Object Capacity -Sum).Sum) / 1GB)
      $kit = 0
      foreach ($m in $mods) { foreach ($x in [regex]::Matches([string]$m.PartNumber, '(?<!\d)(\d{4})(?!\d)')) { $v = [int]$x.Groups[1].Value; if ($v -ge 2400 -and $v -le 9000 -and $v -gt $kit) { $kit = $v } } }
      [void]$lines.Add("$($mods.Count) pente(s) $gen, $gb GB no total, rodando a $cfg MT/s.")
      $level = 'ok'; $title = 'A memória está numa velocidade boa'
      if ($kit -gt $cfg + 100) {
        $level = 'warn'; $title = 'A RAM está abaixo da velocidade do kit'
        [void]$lines.Add("O modelo ($(([string]$mods[0].PartNumber).Trim())) indica $kit MT/s. Ative o XMP (Intel) ou EXPO (AMD) na BIOS.")
      } elseif (($gen -eq 'DDR4' -and $cfg -le 2666) -or ($gen -eq 'DDR5' -and $cfg -le 4800)) {
        $level = 'warn'; $title = 'A RAM está na velocidade básica'
        [void]$lines.Add('Se o seu kit for mais rápido, ative XMP/EXPO na BIOS. É o maior ganho de FPS em jogos limitados pelo processador.')
      }
      if ($mods.Count -eq 1) {
        $level = 'warn'; if ($title -like 'A memória*') { $title = 'Só um pente de memória' }
        [void]$lines.Add('Com um pente só a memória roda em canal único, o que custa FPS. Dois pentes iguais rodam em dual channel.')
      }
      if ($gb -lt 16) { [void]$lines.Add('Menos de 16 GB: jogos atuais e navegador aberto juntos podem faltar memória.') }
      $o = @{ level = $level; title = $title; lines = $lines }; Write-Output (Json $o)`,
  },
  amd: {
    title: 'Processador AMD',
    cap: 'amd',
    // O check anterior só olhava o serviço amd3dvcacheSvc — o que dava falso aviso
    // em TODO Ryzen que não é X3D. Este é o do GDZ: procura o driver de chipset
    // pelos dispositivos, e só cobra a configuração especial nos X3D de dois CCDs.
    run: `
      $lines = New-Object System.Collections.ArrayList
      $cpu = ([string](Get-CimInstance Win32_Processor | Select-Object -First 1).Name).Trim()
      [void]$lines.Add("Processador: $cpu")
      $dev = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'AMD (3D V-Cache|PPM Provisioning|GPIO|PSP|SMBus|I2C)' } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique)
      $level = 'ok'; $title = 'Driver de chipset AMD instalado'
      if ($dev.Count) { [void]$lines.Add('Encontrado: ' + ($dev -join ', ') + '.') }
      else { $level = 'warn'; $title = 'Driver de chipset AMD não encontrado'; [void]$lines.Add('Instale o driver de chipset em amd.com/support. Sem ele o Windows não usa direito os núcleos e os estados de energia do Ryzen.') }
      if ($cpu -match '7900X3D|7950X3D|9900X3D|9950X3D|7945HX3D') {
        if (-not (Get-Service amd3dvcacheSvc -ErrorAction SilentlyContinue)) { $level = 'warn'; [void]$lines.Add('Falta o serviço 3D V-Cache Optimizer (vem no driver de chipset). Sem ele o jogo pode rodar nos núcleos sem cache.') }
        if (-not (Get-AppxPackage -Name Microsoft.XboxGamingOverlay -ErrorAction SilentlyContinue)) { $level = 'warn'; [void]$lines.Add('O Xbox Game Bar não está instalado. Nos X3D de dois CCDs ele é usado para detectar o jogo.') }
        if ((Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' -Name AllowGameDVR -ErrorAction SilentlyContinue).AllowGameDVR -eq 0) { $level = 'warn'; [void]$lines.Add('Uma política está desligando a Game Bar.') }
        if ((powercfg /getactivescheme | Out-String) -notmatch '381b4222-f694-41f0-9685-ff5bb260df2e') { $level = 'warn'; [void]$lines.Add('O plano de energia não é o Equilibrado, que é o que o driver usa para estacionar o CCD sem cache.') }
        if ($level -eq 'warn') { $title = 'Seu Ryzen X3D não está configurado do jeito certo'; [void]$lines.Add('Use o card "Modo X3D Correto" para arrumar.') }
        else { [void]$lines.Add('Configuração X3D correta: Game Bar, plano Equilibrado e driver presentes.') }
      } else {
        [void]$lines.Add('Na BIOS: ative o EXPO (ou DOCP/XMP) da memória. PBO e Curve Optimizer dão mais desempenho se você souber ajustar.')
      }
      $o = @{ level = $level; title = $title; lines = $lines }; Write-Output (Json $o)`,
  },
  intel: {
    title: 'Processador Intel',
    cap: 'intel',
    // O check anterior só imprimia o microcode e devolvia 'ok' sempre — o cliente
    // lia "tudo certo" sem nada ter sido verificado. Este é o do GDZ: decodifica
    // o microcode, compara com o mínimo de cada geração e olha o Modo de Jogo.
    run: `
      $cpu = ([string](Get-CimInstance Win32_Processor | Select-Object -First 1).Name).Trim()
      $lines = New-Object System.Collections.ArrayList; [void]$lines.Add("Processador: $cpu")
      $rev = (Get-ItemProperty 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0' -Name 'Update Revision' -ErrorAction SilentlyContinue).'Update Revision'
      $mc = 0; if ($rev -and $rev.Length -ge 8) { $mc = [BitConverter]::ToUInt32([byte[]]$rev, 4) }
      if ($mc) { [void]$lines.Add(('Microcode: 0x{0:X}' -f $mc)) }
      $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
      $level = 'ok'; $title = 'Nada a corrigir no processador'
      if ($cpu -match 'i[579]-1[34]\d{3}(K|KF|KS|F|T)?\b' -and $cpu -notmatch '\d{4,5}(H|HX|U|P)\b') {
        if ($mc -and $mc -lt 0x12B) { $level = 'warn'; $title = 'Atualize a BIOS: microcode com risco de degradação'; [void]$lines.Add('Os Core 13ª/14ª geração precisam do microcode 0x12B ou mais novo para evitar a degradação do chip. Baixe a BIOS mais recente no site da sua placa-mãe.') }
        else { [void]$lines.Add('Microcode com a correção de degradação da Intel (0x12B ou mais novo).') }
      }
      if ($cpu -match 'Core\(TM\) Ultra [579] 2\d\d') {
        if ([int]$cv.CurrentBuildNumber -lt 26100 -or ([int]$cv.CurrentBuildNumber -eq 26100 -and [int]$cv.UBR -lt 2314)) { $level = 'warn'; $title = 'Atualize o Windows para o Core Ultra 200S'; [void]$lines.Add('A Intel exige o Windows 11 24H2 (build 26100.2314 ou mais novo) para o desempenho correto.') }
        if ($mc -and $mc -lt 0x114) { $level = 'warn'; $title = 'Atualize a BIOS do Core Ultra 200S'; [void]$lines.Add('A Intel corrigiu o desempenho em jogos no microcode 0x114. Atualize a BIOS.') }
      }
      if ($cpu -match '1[2-4]th Gen|Core\(TM\) Ultra') {
        $gm = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\GameBar' -Name AutoGameModeEnabled -ErrorAction SilentlyContinue).AutoGameModeEnabled
        if ($gm -eq 0) { $level = 'warn'; [void]$lines.Add('O Modo de Jogo está desligado. Nos Intel híbridos (P-cores e E-cores) ele ajuda o Windows a pôr o jogo nos núcleos rápidos.') }
        else { [void]$lines.Add('Processador híbrido: deixe o Windows escolher os núcleos. Desligar E-cores ou forçar afinidade não traz ganho.') }
      }
      $o = @{ level = $level; title = $title; lines = $lines }; Write-Output (Json $o)`,
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
  // travas de segurança (GDZ: blockedActions / tweakBlocks)
  getBlocked, blockedActions, tweakBlocks, tweakAction, buildCaps,
  // expostos para as medições (nao usados pelo app)
  servicosDoScript, confereServico, confereScript, resultadoPs, limpaSaida, mensagemDaFalha,
};
