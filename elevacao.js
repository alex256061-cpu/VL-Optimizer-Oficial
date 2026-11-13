// elevacao.js — abertura elevada sem UAC, via tarefa agendada do Windows.
//
// Como o GDZ Optimizer faz (verificado em 13/11/2026, extraindo o app.asar dele):
//
//   Task "GDZ Optimizer" (raiz, RunLevel HighestAvailable, LogonType InteractiveToken)
//     Trigger   LogonTrigger (ao entrar no Windows)
//     Action    "<instalado>\GDZ Optimizer.exe" --autostart
//     Settings  MultipleInstances=IgnoreNew · ExecutionTimeLimit=PT0S
//               DisallowStartIfOnBatteries=false · AllowDemandStart=true
//
//   Ele monta isso em PowerShell dentro do app:
//     $t = New-ScheduledTaskTrigger -AtLogOn
//     $p = New-ScheduledTaskPrincipal -UserId ... -LogonType Interactive -RunLevel Highest
//     $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries ...
//     Register-ScheduledTask -TaskName 'GDZ Optimizer' -Action $a -Trigger $t -Principal $p -Settings $s
//
// Por que dispensa UAC: o Windows confia no Agendador de Tarefas. Quem dispara a tarefa
// (schtasks /run, atalho, ou o gatilho de logon) recebe o token elevado do próprio
// Windows, sem passar pelo pedido de consentimento do UAC.
//
// REGRA IMPORTANTE (medida nesta máquina): criar uma tarefa com RunLevel Highest exige
// admin UMA vez. Register-ScheduledTask devolve "Acesso negado" (0x80070005) tanto com
// RunLevel Highest quanto com Limited quando o processo não está elevado. Por isso a
// tarefa é criada pelo INSTALADOR (que já pede elevação) e, de reserva, uma única vez
// na primeira abertura elevada que o usuário autorizar.
//
// Depois de criada, toda abertura passa pela tarefa: nada de UAC nunca mais.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const core = require('./engine');

const TASK_NAME = 'VLOptimizer';

// Marca que veio de execução elevada: impede o ciclo app -> tarefa -> app.
const ELEVATED_FLAG = '--elevated-from-task';

// Códigos do schtasks quando a tarefa já está rodando (MultipleInstances=IgnoreNew).
const JA_RODANDO = [0x41301, 267009];

const run = (file, args, timeout = 30000) => new Promise((resolve) => {
  try {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: (stdout || '').toString().trim(),
        err: (stderr || '').toString().trim(),
        code: err && typeof err.code === 'number' ? err.code : (err ? -1 : 0),
      });
    });
  } catch (e) {
    resolve({ ok: false, out: '', err: String((e && e.message) || e), code: -1 });
  }
});

// ────────────────────────────── estado ──────────────────────────────

const E = {};

// True quando o processo atual já está com token de administrador.
E.isAdmin = async () => {
  const r = await core.ps(`Write-Output ([bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)))`);
  return /true/i.test(r.out);
};

// True quando este processo foi iniciado pela tarefa agendada.
E.veioDaTarefa = () => process.argv.includes(ELEVATED_FLAG);

// A task é só para Windows empacotado: em dev (electron .) o alvo seria o proprio
// electron.exe e a tarefa apontaria para o caminho errado.
E.suportado = () => process.platform === 'win32' && process.defaultApp !== true;

// Caminho do executável que a tarefa deve abrir.
function exeAlvo() {
  return process.execPath;
}

function pastaAlvo() {
  return path.dirname(process.execPath);
}

// ────────────────────────────── leitura ──────────────────────────────

// Lê a tarefa sem PowerShell (schtasks é bem mais rápido) e devolve o que importa.
// Nunca lança: tarefa ausente devolve exists:false.
E.status = async () => {
  const vazio = { exists: false, ready: false, runLevel: null, exe: null, args: null, atLogOn: false, ours: false };
  if (!E.suportado()) return vazio;

  const q = await run('schtasks', ['/query', '/tn', TASK_NAME, '/xml']);
  if (!q.ok) return vazio;

  const xml = q.out;
  const runLevel = /<RunLevel>([^<]+)<\/RunLevel>/i.exec(xml);
  const command = /<Command>([^<]+)<\/Command>/i.exec(xml);
  const args = /<Arguments>([^<]*)<\/Arguments>/i.exec(xml);
  const atLogOn = /<LogonTrigger>/i.test(xml);

  const limpar = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const exe = command ? limpar(command[1]).replace(/^"|"$/g, '') : null;
  const esperado = exeAlvo();
  const ours = !!exe && path.resolve(exe).toLowerCase() === path.resolve(esperado).toLowerCase();

  return {
    exists: true,
    // "ready": a tarefa existe, aponta para ESTE executável e pede elevação.
    ready: ours && /highest/i.test(runLevel ? runLevel[1] : ''),
    runLevel: runLevel ? limpar(runLevel[1]) : null,
    exe,
    args: args ? limpar(args[1]) : null,
    atLogOn,
    ours,
  };
};

// Só a pergunta "dá para abrir elevado sem UAC?", que é o que o app precisa decidir.
E.pronta = async () => {
  try { const s = await E.status(); return !!(s.exists && s.ready); } catch (e) { return false; }
};

// ────────────────────────────── criação (pede UAC uma vez) ──────────────────────────────

// O XML da tarefa. Mesmo formato que o GDZ registra (conferido com Export-ScheduledTask).
// RunLevel HighestAvailable + InteractiveToken = roda elevada, sem senha, pela sessão do dono.
function xmlTarefa(opts) {
  const comAutostart = !!(opts && opts.autostart);
  const exe = exeAlvo();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const args = '"' + ELEVATED_FLAG + '"';
  const triggers = comAutostart
    ? '\n    <LogonTrigger>\n      <Enabled>true</Enabled>\n      <UserId>' + esc(os.userInfo().username) + '</UserId>\n    </LogonTrigger>'
    : '';
  return '<?xml version="1.0" encoding="UTF-16"?>\n' +
    '<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n' +
    '  <RegistrationInfo>\n    <URI>\\' + TASK_NAME + '</URI>\n    <Description>Abre o VL Optimizer com direitos de administrador, sem pedir UAC.</Description>\n  </RegistrationInfo>\n' +
    '  <Principals>\n' +
    '    <Principal id="Author">\n' +
    '      <UserId>' + esc(os.userInfo().username) + '</UserId>\n' +
    '      <LogonType>InteractiveToken</LogonType>\n' +
    '      <RunLevel>HighestAvailable</RunLevel>\n' +
    '    </Principal>\n' +
    '  </Principals>\n' +
    '  <Settings>\n' +
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n' +
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n' +
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n' +
    '    <AllowHardTerminate>true</AllowHardTerminate>\n' +
    '    <StartWhenAvailable>false</StartWhenAvailable>\n' +
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\n' +
    '    <IdleSettings>\n      <StopOnIdleEnd>false</StopOnIdleEnd>\n      <RestartOnIdle>false</RestartOnIdle>\n    </IdleSettings>\n' +
    '    <AllowStartOnDemand>true</AllowStartOnDemand>\n' +
    '    <Enabled>true</Enabled>\n' +
    '    <Hidden>false</Hidden>\n' +
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>\n' +
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\n' +
    '    <Priority>4</Priority>\n' +
    '    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>\n' +
    '  </Settings>\n' +
    '  <Actions Context="Author">\n' +
    '    <Exec>\n' +
    '      <Command>"' + esc(exe) + '"</Command>\n' +
    '      <Arguments>' + esc(args) + '</Arguments>\n' +
    '      <WorkingDirectory>' + esc(pastaAlvo()) + '</WorkingDirectory>\n' +
    '    </Exec>\n' +
    '  </Actions>\n' +
    (triggers ? '  <Triggers>' + triggers + '\n  </Triggers>\n' : '') +
    '</Task>\n';
}

// Registra a tarefa. PRECISA estar elevado (o instalador está).
// Caminho escolhido: grava o XML num arquivo e usa `schtasks /create /xml`. Assim não
// monta script PowerShell nenhum — nada de interpolação de $ que já mordeu antes.
E.registrar = async (opts) => {
  if (!E.suportado()) return { success: false, error: 'Recurso disponível apenas na versão instalada.' };
  const dir = process.env.LOCALAPPDATA || os.tmpdir();
  const arquivo = path.join(dir, 'VLOptimizer-task-' + process.pid + '.xml');
  try {
    // schtasks lê o XML em UTF-16 quando declarado assim; gravamos UTF-16LE com BOM.
    fs.writeFileSync(arquivo, '\ufeff' + xmlTarefa(opts), 'utf16le');
  } catch (e) {
    return { success: false, error: 'Não consegui gravar o XML da tarefa: ' + e.message };
  }
  const r = await run('schtasks', ['/create', '/tn', TASK_NAME, '/xml', arquivo, '/f'], 60000);
  try { fs.unlinkSync(arquivo); } catch (e) {}

  if (!r.ok) {
    const negado = /acesso negado|access is denied|0x80070005/i.test(r.out + ' ' + r.err);
    return {
      success: false,
      needsAdmin: negado,
      error: negado ? 'O Windows só deixa criar esta tarefa com administrador.' : (r.err || r.out || 'falha ao criar a tarefa'),
    };
  }
  return { success: true, exists: true };
};

// Cria a tarefa pedindo UAC UMA vez. É o plano B do instalador: usado quando a
// instalação foi feita por outro meio e a tarefa não existe.
E.registrarComUAC = async (opts) => {
  if (!E.suportado()) return { success: false, error: 'Recurso disponível apenas na versão instalada.' };

  // O XML vai num arquivo (nada de $ no meio de template literal) e um único
  // Start-Process -Verb RunAs pede o consentimento uma vez.
  const dir = process.env.LOCALAPPDATA || os.tmpdir();
  const xmlFile = path.join(dir, 'VLOptimizer-task-' + Date.now() + '.xml');
  try {
    fs.writeFileSync(xmlFile, '\ufeff' + xmlTarefa(opts), 'utf16le');
  } catch (e) {
    return { success: false, error: 'Não consegui gravar o XML da tarefa: ' + e.message };
  }

  // Script em arquivo .ps1 separado: sem interpolação de JS, validável com ParseFile.
  // Ele só chama o schtasks com o XML; $LASTEXITCODE decide o sucesso.
  const ps1 = path.join(dir, 'VLOptimizer-registrar-' + Date.now() + '.ps1');
  const linha = (s) => s + '\r\n';
  const cmd = [
    'param([Parameter(Mandatory=$true)][string]$Xml)',
    '$ErrorActionPreference = \'Continue\'',
    'try {',
    '  $saida = & schtasks.exe /create /tn \'VLOptimizer\' /xml $Xml /f 2>&1',
    '  if ($LASTEXITCODE -eq 0) { exit 0 }',
    '  Write-Output ("FALHOU: " + ($saida -join " "))',
    '  exit 3',
    '} catch {',
    '  Write-Output ("ERRO: " + $_.Exception.Message)',
    '  exit 4',
    '}',
    '',
  ].map(linha).join('');
  try {
    fs.writeFileSync(ps1, cmd, 'utf8');
  } catch (e) {
    return { success: false, error: 'Não consegui gravar o script: ' + e.message };
  }

  // Um único Start-Process -Verb RunAs: aqui é o ÚNICO lugar do app que mostra UAC.
  // O script que roda elevado é escrito em -EncodedCommand (base64), então não há
  // aspas nem $ atravessando camadas de shell.
  const interno = [
    "$ErrorActionPreference = 'Stop'",
    "$r = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$env:VL_TASK_PS1,'-Xml',$env:VL_TASK_XML)",
  ].join('\r\n');
  const encoded = Buffer.from(interno, 'utf16le').toString('base64');

  const r = await new Promise((resolve) => {
    try {
      execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
        windowsHide: true,
        timeout: 180000,
        env: { ...process.env, VL_TASK_PS1: ps1, VL_TASK_XML: xmlFile },
      }, (err) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 }));
    } catch (e) {
      resolve({ ok: false, code: -1 });
    }
  });

  try { fs.unlinkSync(ps1); } catch (e) {}
  try { fs.unlinkSync(xmlFile); } catch (e) {}

  if (!r.ok) return { success: false, canceled: true, error: 'Permissão de administrador recusada.' };

  // O UAC não bloqueia a espera: confere se a tarefa nasceu antes de dizer que deu certo.
  for (let i = 0; i < 20; i++) {
    const st = await E.status();
    if (st.exists && st.ready) return { success: true, exists: true };
    await new Promise((res) => setTimeout(res, 250));
  }
  return { success: false, error: 'A tarefa não foi criada.' };
};

// Remove a tarefa (precisa de admin). Usado no desinstalador e no autostart off.
E.remover = async () => {
  if (!E.suportado()) return { success: false };
  const r = await run('schtasks', ['/delete', '/tn', TASK_NAME, '/f']);
  return { success: r.ok };
};

// ────────────────────────────── abrir elevado ──────────────────────────────

// Dispara a tarefa: o Windows sobe o app com token elevado, SEM UAC.
// Devolve { started: true } quando o Agendador aceitou o pedido.
E.abrirPelaTarefa = async () => {
  if (!E.suportado()) return { started: false, reason: 'nao-suportado' };
  const r = await run('schtasks', ['/run', '/tn', TASK_NAME], 30000);
  if (r.ok) return { started: true };
  if (JA_RODANDO.includes(r.code) || /já está em execução|already running|266011/i.test(r.out + ' ' + r.err)) {
    return { started: true, jaRodando: true };
  }
  return { started: false, reason: 'falhou', error: r.err || r.out };
};

// Abre elevado do jeito que der:
//   1. tarefa agendada  -> sem UAC (caminho normal depois da primeira vez)
//   2. Start-Process -Verb RunAs -> UAC pedido uma única vez, e cria a tarefa
//      para as próximas aberturas não pedirem mais nada.
E.abrirElevado = async (opts) => {
  const st = await E.status();
  if (st.exists && st.ready) {
    const r = await E.abrirPelaTarefa();
    if (r.started) return { success: true, via: 'tarefa', uac: false };
    // Tarefa existe mas falhou: cai no plano B (não fica sem abrir).
  }

  // Sem tarefa útil: cria (UAC uma vez) e já abre pela tarefa.
  const reg = await E.registrarComUAC(opts);
  if (reg.success) {
    const r2 = await E.abrirPelaTarefa();
    if (r2.started) return { success: true, via: 'tarefa', uac: true, criada: true };
    return { success: false, error: 'A tarefa foi criada mas o app não abriu. Abra pelo atalho.' };
  }
  return { success: false, error: reg.error || 'Não consegui abrir como administrador.' };
};

// Compatibilidade: mesma função do antigo features.elevate, agora de tarefa.
E.elevate = () => E.abrirElevado().then((r) => r.success);

// ────────────────────────────── autostart elevado ──────────────────────────────

// Liga/desliga o gatilho de logon da tarefa, sem recriar nada e sem UAC.
// schtasks /change /disable|/enable funciona sem admin para a própria tarefa.
E.autostartAtivo = async () => {
  const s = await E.status();
  return !!(s.exists && s.atLogOn);
};

E.autostartSet = async (ligar) => {
  if (!E.suportado()) return { success: false, error: 'Disponível apenas na versão instalada.' };
  const st = await E.status();
  if (!st.exists) {
    // Sem tarefa: cria com o gatilho pedido (pede UAC uma vez).
    const r = await E.registrarComUAC({ autostart: !!ligar });
    return r.success ? { success: true, on: !!ligar, criada: true } : r;
  }
  // Com tarefa: troca só o gatilho, sem admin.
  const acao = ligar ? '/enable' : '/disable';
  const r = await run('schtasks', ['/change', '/tn', TASK_NAME, acao]);
  if (!r.ok) return { success: false, error: r.err || r.out || 'falha ao alterar a tarefa' };
  return { success: true, on: !!ligar };
};

module.exports = E;
