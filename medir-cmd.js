// Medicao de travadas replicando o metodo do GDZ, lido do codigo dele:
//
//   execFile(PresentMon, [args..., FPS_SESSION], { windowsHide: true, timeout: 5000 }, () => {})
//
// O que isso significa na pratica:
//   - PresentMon em fluxo continuo (--output_stdout), sem --timed e sem --terminate_after_timed
//   - o processo e MORTO com timeout de 5 segundos
//   - os frametimes ficam em memoria, em JavaScript, e a analise e feita depois
//
// Motivo de 5 segundos: pedir 15 segundos com o Lossless ativo enche o buffer circular de eventos
// ETW e o PresentMon descarta tudo (medido: 244.000 eventos perdidos). Em rajadas curtas o buffer
// nao estoura e os dados chegam completos.
//
// As flags sao exatamente as do GDZ:
//   --output_stdout  --no_console_stats  --session_name  --no_track_input  --no_track_gpu
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const I = path.join(process.env.LOCALAPPDATA, 'Programs', 'VL Optimizer', 'resources', 'app');
const PM = path.join(I, 'bin', 'PresentMon.exe');
const LOSS = require(path.join(I, 'lossless-official.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RAJADA_MS = 5000;   // igual ao timeout que o GDZ passa ao execFile
const RAJADAS = 6;        // 6 x 5s = 30s de amostra acumulada

function gtaPid() {
  try {
    const o = execFileSync('tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq GTA5.exe'], { encoding: 'utf8', windowsHide: true });
    const m = o.match(/"[^"]+","(\d+)"/);
    return m ? Number(m[1]) : null;
  } catch (e) { return null; }
}

function escalar() {
  const ps = `
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public static class F {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$p = Get-Process -Name GTA5 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($p) { [F]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 700 }
[F]::keybd_event(0x11,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
[F]::keybd_event(0x12,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
[F]::keybd_event(0x53,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120
[F]::keybd_event(0x53,0,2,[UIntPtr]::Zero)
[F]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[F]::keybd_event(0x11,0,2,[UIntPtr]::Zero)
`;
  const f = path.join(os.tmpdir(), 'vl-esc2.ps1');
  fs.writeFileSync(f, ps, 'utf8');
  try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', windowsHide: true, timeout: 20000 }); } catch (e) { }
}

// Uma rajada: abre o PresentMon, coleta as linhas do PID alvo e mata em RAJADA_MS.
function umaRajada(pid) {
  return new Promise((resolve) => {
    const child = spawn(PM, [
      '--output_stdout',
      '--no_console_stats',
      '--stop_existing_session',
      '--session_name', 'VLFPS',
      '--no_track_input',
      '--no_track_gpu',
    ], { windowsHide: true });

    const ms = [];
    let buffer = '';
    let headerIdx = -1, pidIdx = -1;
    let err = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const cols = line.split(',');
        if (headerIdx < 0) {
          headerIdx = cols.indexOf('MsBetweenPresents');
          pidIdx = cols.indexOf('ProcessID');
          continue;
        }
        if (headerIdx < 0) continue;
        if (Number(cols[pidIdx]) !== pid) continue;
        const v = parseFloat(cols[headerIdx]);
        if (Number.isFinite(v) && v > 0) ms.push(v);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => err += d);

    // Este e o ponto central: encerra apos 5s, igual ao timeout do execFile no GDZ.
    // O encerramento e GRACIOSO: matar com SIGKILL deixa a sessao ETW aberta, e depois de
    // algumas vezes o Windows passa a recusar novas sessoes com "error code 1450"
    // (ERROR_NO_SYSTEM_RESOURCES). Foi o que aconteceu durante os testes.
    setTimeout(() => {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T'], { windowsHide: true, timeout: 8000 });
      } catch (e) {
        try { child.kill(); } catch (e2) { }
      }
      setTimeout(() => {
        // Se ainda nao saiu, forca e depois limpa a sessao para nao travar as proximas.
        try { child.kill(); } catch (e) { }
        try {
          execFileSync('logman', ['stop', 'VLFPS', '-ets'], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
        } catch (e) { }
        const perdidos = (err.match(/(\d+) ETW events were lost/) || [])[1] || '0';
        resolve({ ms, perdidos });
      }, 1200);
    }, RAJADA_MS);
  });
}

function analisar(todos, perdidos, rajadasOk) {
  if (todos.length < 50) return { erro: 'poucos quadros: ' + todos.length };
  const s = [...todos].sort((a, b) => a - b);
  const mediana = s[Math.floor(s.length / 2)];
  const media = todos.reduce((a, b) => a + b, 0) / todos.length;
  const p99 = s[Math.floor(s.length * 0.99)];
  const p999 = s[Math.floor(s.length * 0.999)];
  const lentos = todos.filter((v) => v > mediana * 2);
  let seq = 0, maiorSeq = 0;
  for (const v of todos) { if (v > mediana * 2) { seq++; if (seq > maiorSeq) maiorSeq = seq; } else seq = 0; }
  return {
    quadros: todos.length,
    fps: Math.round((1000 / media) * 10) / 10,
    mediana: Math.round(mediana * 100) / 100,
    low1: Math.round((1000 / p99) * 10) / 10,
    low01: Math.round((1000 / p999) * 10) / 10,
    pior: Math.round(s[s.length - 1] * 100) / 100,
    lentos: lentos.length,
    pct: Math.round((lentos.length / todos.length) * 1000) / 10,
    sequencia: maiorSeq,
    perdidos,
    rajadasOk,
  };
}

async function medirCenario(nome) {
  const pid = gtaPid();
  if (!pid) return { erro: 'GTA fechado' };
  let todos = [];
  let perdidos = 0;
  let ok = 0;
  process.stdout.write('    rajadas: ');
  for (let r = 0; r < RAJADAS; r++) {
    const { ms, perdidos: perd } = await umaRajada(pid);
    todos = todos.concat(ms);
    perdidos += Number(perd) || 0;
    if (ms.length > 0) ok++;
    process.stdout.write(ms.length > 0 ? '.' : 'x');
    await sleep(700);
  }
  process.stdout.write('  (');
  process.stdout.write('' + ok + '/' + RAJADAS + ' com dados)\n');
  return analisar(todos, perdidos, ok);
}

function mostrar(r, titulo) {
  console.log('  ' + titulo);
  if (r.erro) { console.log('    FALHOU: ' + r.erro + '\n'); return; }
  console.log('    quadros ......... ' + r.quadros);
  console.log('    FPS medio ....... ' + r.fps);
  console.log('    mediana ......... ' + r.mediana + ' ms');
  console.log('    pior quadro ..... ' + r.pior + ' ms');
  console.log('    1% low .......... ' + r.low1 + ' FPS');
  console.log('    0.1% low ........ ' + r.low01 + ' FPS');
  console.log('    QUADROS LENTOS .. ' + r.lentos + '  (' + r.pct + '%)');
  console.log('    ENGASGO MAX ..... ' + r.sequencia + ' quadros seguidos');
  console.log('    perdidos ........ ' + r.perdidos);
  console.log('');
}

(async () => {
  if (!gtaPid()) { console.log('Abra o GTA no gameplay.'); return; }
  console.log('GTA pid ' + gtaPid() + '   metodo: ' + RAJADAS + ' rajadas de ' + (RAJADA_MS / 1000) + 's (igual ao timeout do GDZ)');
  console.log('');

  console.log('[A] LS1 1.5x + GERACAO DE QUADROS (LSFG3 2x, alvo 100)');
  LOSS.stop(); await sleep(2500);
  LOSS.writeSettings({ scaleType: 'ls1', scaleFactor: 1.5, sharpness: 0, frameGeneration: 'lsfg3', multiplier: 2, targetFps: 100, syncMode: 'standard', captureApi: 'dxgi' });
  LOSS.launch(); await sleep(7000); escalar(); await sleep(3000);
  const a = await medirCenario('A');
  mostrar(a, 'COM geracao de quadros');
  console.log('');

  console.log('[B] LS1 1.5x SEM geracao de quadros');
  LOSS.stop(); await sleep(2500);
  LOSS.writeSettings({ scaleType: 'ls1', scaleFactor: 1.5, sharpness: 0, frameGeneration: 'off', syncMode: 'standard', captureApi: 'dxgi' });
  LOSS.launch(); await sleep(7000); escalar(); await sleep(3000);
  const b = await medirCenario('B');
  mostrar(b, 'SEM geracao de quadros');

  if (!a.erro && !b.erro) {
    console.log('COMPARACAO');
    console.log('  FPS:     A ' + a.fps + '  vs  B ' + b.fps);
    console.log('  1% low:  A ' + a.low1 + '  vs  B ' + b.low1);
    console.log('  lentos:  A ' + a.lentos + ' (' + a.pct + '%)  vs  B ' + b.lentos + ' (' + b.pct + '%)');
    console.log('  engasgo: A ' + a.sequencia + '  vs  B ' + b.sequencia);
  }
})();
