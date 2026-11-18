// telemetria.js — fila e envio de FPS/hardware + funil de plano.
//
// PORTADO DO GDZ, literal. Fonte: gdz-SEM-MANGLE.js
//   const TELEMETRY_MAX_QUEUE = 500;
//   const TELEMETRY_BATCH = 50;
//   const TELEMETRY_FLUSH_MS = 300000;
//   const FPS_PAIR_WINDOW_MS = 86400000;
//   function fpsTelemetryItem / enqueueFpsTelemetry / flushTelemetry /
//   hardwareSnapshot / hardwareDetails / displayDetails / flushPlanEvents
//
// Diferença obrigatória de transporte: o GDZ fala com api.gdzfps.com. Aqui os
// dados vão para o Supabase, no mesmo projeto da licença (decisão do dono: "tudo
// bem ficar no supabase"). Por isso a telemetria tem tabela própria:
//
//   supabase/functions/telemetria   — Edge Function que recebe o lote
//   public.telemetria_fps           — uma linha por item de FPS
//   public.telemetria_hardware      — uma linha por PC (upsert pelo hash)
//   public.eventos_plano            — funil de plano (upsell_view, offer_click...)
//
// O CONTEÚDO do que sai é o do GDZ, campo por campo. Se algum campo do GDZ não
// fizer sentido aqui, ele fica com o mesmo nome e valor — nada é inventado e nada
// é removido sem estar anotado.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Constantes do GDZ ────────────────────────────────────────────────────
const TELEMETRY_MAX_QUEUE = 500;
const TELEMETRY_BATCH = 50;
const TELEMETRY_FLUSH_MS = 300000; // 5 min
const FPS_PAIR_WINDOW_MS = 86400000; // 24 h: janela para casar "antes" e "depois"

// O GDZ devolve null quando o valor não é número. Aqui a string vazia virava 0
// (Number('') === 0), e um null de medição chegava ao servidor como 0.
const round = (v, casas) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, casas);
  return Math.round(n * f) / f;
};

// ── Estado do módulo ─────────────────────────────────────────────────────
let deps = null; // { dataDir, settings, saveSettings, apiCall, getCaps, screen, appVersion, backups }
let telemetryPath = null;
let telemetryFlushing = false;
let telemetryConsentSynced = false;
let planEventsTimer = null;
const planEvents = [];

function configurar(d) {
  deps = d;
  telemetryPath = path.join(d.dataDir, 'telemetry-queue.json');
  try { fs.mkdirSync(d.dataDir, { recursive: true }); } catch (e) { }
}

// ── Fila ─────────────────────────────────────────────────────────────────
function loadTelemetryQueue() {
  try {
    const j = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function saveTelemetryQueue(lista) {
  try {
    fs.writeFileSync(telemetryPath, JSON.stringify(lista.slice(-TELEMETRY_MAX_QUEUE)));
  } catch (e) { }
}

// ── Hardware ─────────────────────────────────────────────────────────────
let _hwDetails = null;

/// Lê os detalhes de hardware. Igual ao GDZ: um script PowerShell só, com todos
/// os limites numéricos e os cortes de texto aplicados depois, no Node.
function hardwareDetails() {
  if (!_hwDetails) {
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1',
      '$gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -and [string]$_.PNPDeviceID -match "^PCI" })',
      '$main = $gpus | Where-Object { $_.Name -notmatch "Intel\\(R\\) (UHD|HD|Iris)|Radeon\\(TM\\) Graphics|AMD Radeon Graphics" } | Select-Object -First 1',
      'if (-not $main) { $main = $gpus | Select-Object -First 1 }',
      '$vram = 0',
      'Get-ItemProperty "HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*" | Where-Object { [string]$_.MatchingDeviceId -match "^pci" } | ForEach-Object { $q = $_.HardwareInformation.qwMemorySize; if ($q -and [long]$q -gt $vram) { $vram = [long]$q } }',
      'if ($vram -eq 0 -and $main.AdapterRAM) { $vram = [long]$main.AdapterRAM }',
      '$mem = @(Get-CimInstance Win32_PhysicalMemory)',
      '$ramMhz = 0; if ($mem.Count) { $ramMhz = if ($mem[0].ConfiguredClockSpeed) { $mem[0].ConfiguredClockSpeed } else { $mem[0].Speed } }',
      '$os = Get-CimInstance Win32_OperatingSystem',
      '$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1',
      '$d = Get-Partition -DriveLetter $env:SystemDrive.Substring(0,1) | Get-Disk',
      '$pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$d.Number } | Select-Object -First 1',
      '$plan = [string](powercfg /getactivescheme)',
      '$plan = if ($plan -match "\\((.+)\\)\\s*$") { $Matches[1] } else { "" }',
      '[pscustomobject]@{ cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; mhz = $cpu.MaxClockSpeed;',
      '  driver = [string]$main.DriverVersion; gpuCount = $gpus.Count; vram = $vram; ramMhz = $ramMhz; ramModules = $mem.Count;',
      '  media = [string]$pd.MediaType; bus = [string]$pd.BusType; diskBytes = $d.Size;',
      '  board = ([string]"$($bb.Manufacturer) $($bb.Product)").Trim(); windows = [string]$os.Caption; plan = $plan } | ConvertTo-Json -Compress',
    ].join('\n');

    _hwDetails = Promise.resolve(deps.ps(script, 25000))
      .then((saida) => {
        const h = JSON.parse(String(saida || '').trim() || '{}');
        // O GDZ aplica os mesmos limites: número só vale dentro da faixa, senão null.
        const num = (v, min, max) => {
          const n = +v;
          return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
        };
        const txt = (v, max) => {
          const s = String(v || '').replace(/\s+/g, ' ').trim();
          return s ? s.slice(0, max) : null;
        };
        const disco = h.bus === 'NVMe' ? 'NVMe' : h.media === 'SSD' ? 'SSD' : h.media === 'HDD' ? 'HDD' : null;
        return {
          cpuCores: num(h.cores, 1, 256),
          cpuThreads: num(h.threads, 1, 512),
          cpuMaxGhz: h.mhz > 500 ? Math.round(h.mhz / 100) / 10 : null,
          gpuVramGb: h.vram > 104857600 ? Math.round(h.vram / 1073741824) : null,
          gpuDriver: txt(h.driver, 32),
          gpuCount: num(h.gpuCount, 0, 8),
          ramSpeedMhz: num(h.ramMhz, 1, 20000),
          ramModules: num(h.ramModules, 1, 32),
          diskType: disco,
          diskGb: h.diskBytes > 0 ? num(h.diskBytes / 1000000000, 1, 100000) : null,
          board: txt(h.board, 96),
          windows: txt(String(h.windows || '').replace(/^Microsoft\s+/i, ''), 64),
          powerPlan: txt(h.plan, 64),
        };
      })
      .catch(() => ({}));
  }
  return _hwDetails;
}

/// O que vai no campo `hardware` do POST. Igual ao GDZ.
async function hardwareSnapshot() {
  const caps = await Promise.resolve(deps.getCaps()).catch(() => null);
  if (!caps) return null;

  const [det, disp] = await Promise.all([hardwareDetails(), Promise.resolve(displayDetails())]);
  const detalhes = Object.assign({}, det, disp);

  const principal = (caps.gpus || []).find((g) => !g.integrated) || (caps.gpus || [])[0] || null;

  return {
    cpuName: caps.cpuName ? String(caps.cpuName).trim().slice(0, 96) : null,
    cpuVendor: ['amd', 'intel'].includes(caps.cpuVendor) ? caps.cpuVendor : 'other',
    x3d: !!caps.x3d,
    intelHybrid: !!caps.intelHybrid,
    gpuName: principal ? String(principal.name).trim().slice(0, 96) : null,
    gpuVendor: principal && ['nvidia', 'amd', 'intel'].includes(principal.vendor) ? principal.vendor : 'other',
    ramGb: Math.max(1, Math.round(os.totalmem() / 1073741824)),
    laptop: !!caps.laptop,
    osBuild: caps.build ? caps.build + '.' + (caps.ubr || 0) : os.release().slice(0, 32),
    details: detalhes,
  };
}

/// Resolução, Hz e quantidade de monitores, quando o Electron deixa ler.
function displayDetails() {
  try {
    const tela = deps.screen;
    if (!tela) return {};
    const p = tela.getPrimaryDisplay();
    return {
      screenW: Math.round(p.size.width * p.scaleFactor),
      screenH: Math.round(p.size.height * p.scaleFactor),
      refreshHz: p.displayFrequency >= 20 ? Math.round(p.displayFrequency) : null,
      displays: tela.getAllDisplays().length,
    };
  } catch (e) {
    return {};
  }
}

// ── Item de FPS ──────────────────────────────────────────────────────────
/// Monta o item de telemetria de uma medição. Igual ao GDZ, campo por campo.
///
/// `fase` é 'a' (antes) ou 'b' (depois). No "antes" cria um pairId novo; no
/// "depois" casa com o "antes" do MESMO jogo medido há menos de 24h.
function fpsTelemetryItem(fase, medicao) {
  let phase = 'manual';
  let pairId = null;

  if (fase === 'a') {
    phase = 'before';
    pairId = crypto.randomUUID();
    medicao.pairId = pairId;
  } else {
    const antes = deps.settings().fpsSessions && deps.settings().fpsSessions.a;
    if (antes && antes.pairId && antes.name === medicao.name && medicao.at - antes.at < FPS_PAIR_WINDOW_MS) {
      phase = 'after';
      pairId = antes.pairId;
    }
  }

  const otimizacoes = Object.keys((deps.backups() || {}).entries || {});

  return {
    clientId: crypto.randomUUID(),
    pairId,
    phase,
    game: String(medicao.name || 'desconhecido').slice(0, 64),
    durationS: Math.min(120, Math.max(5, Math.round(medicao.secs || 5))),
    fpsAvg: round(medicao.fps, 2),
    low1: round(medicao.low1, 2),
    low01: round(medicao.low01, 2),
    frametimeAvg: round(medicao.frametime, 3),
    frames: Math.round(medicao.frames || 0),
    optimizations: otimizacoes.slice(0, 80).map((k) => k.slice(0, 64)),
    appVersion: deps.appVersion(),
    capturedAt: new Date(medicao.at).toISOString(),
  };
}

/// Guarda a medição na fila, se o consentimento estiver ligado e a medição servir.
///
/// Só entra medição com média de pelo menos 1 FPS e 30 quadros: medição curta
/// demais sujaria a estatística. Mesma regra do GDZ.
function enqueueFpsTelemetry(fase, medicao) {
  const item = fpsTelemetryItem(fase, medicao);
  if (!telemetryOn() || !(item.fpsAvg >= 1) || !(item.frames >= 30)) return;
  const fila = loadTelemetryQueue();
  fila.push(item);
  saveTelemetryQueue(fila);
}

/// O consentimento governa a FILA de FPS. Igual ao GDZ: settings.telemetryConsent
/// precisa ser exatamente true.
function telemetryOn() {
  return deps.settings().telemetryConsent === true;
}

// ── Envio ────────────────────────────────────────────────────────────────
/// Envia um lote. Mesma ordem, mesmos códigos de resposta do GDZ:
///   200 -> remove os enviados da fila e grava o hash do hardware
///   400 -> descarta o lote (o servidor recusou o conteúdo; reenviar não resolve)
///   outro -> mantém para a próxima
async function flushTelemetry() {
  // deps.usuario() pode devolver Promise (no main.js é conta.usuario(), que é
  // assíncrono). Usado direto como booleano, uma Promise é sempre verdadeira e a
  // guarda nunca bloqueava.
  const u = await Promise.resolve(deps.usuario());
  if (telemetryFlushing || !u) return;
  const sessao = await Promise.resolve(deps.sessaoAtual());
  if (!sessao || sessao.offline) return;

  telemetryFlushing = true;
  try {
    const hw = await hardwareSnapshot();
    const hash = hw ? crypto.createHash('sha256').update(JSON.stringify(hw)).digest('hex') : null;
    const mudouHardware = hw && hash !== deps.settings().telemetryHwHash;

    let fila = telemetryOn() ? loadTelemetryQueue() : [];
    if (!fila.length && !mudouHardware) return;

    // Antes de mandar FPS, avisa o servidor que o consentimento foi dado.
    if (fila.length && !telemetryConsentSynced) {
      const r = await deps.apiCall('POST', '/app/consent', { telemetry: true });
      if (!r || r.status !== 200) return;
      telemetryConsentSynced = true;
    }

    const lote = fila.slice(0, TELEMETRY_BATCH);
    const corpo = Object.assign(
      { fps: lote },
      mudouHardware ? { hardware: hw } : {}
    );

    const r = await deps.apiCall('POST', '/app/telemetry', corpo);

    if (r && r.status === 200) {
      const enviados = new Set(lote.map((i) => i.clientId));
      fila = loadTelemetryQueue().filter((i) => !enviados.has(i.clientId));
      saveTelemetryQueue(fila);
      if (mudouHardware) {
        deps.setSetting('telemetryHwHash', hash);
      }
    } else if (r && r.status === 400) {
      const recusados = new Set(lote.map((i) => i.clientId));
      saveTelemetryQueue(loadTelemetryQueue().filter((i) => !recusados.has(i.clientId)));
    }
  } catch (e) {
  } finally {
    telemetryFlushing = false;
  }
}

/// Liga o envio periódico. O GDZ usa setInterval(...).unref() a cada 5 min.
function iniciar() {
  const t = setInterval(() => { flushTelemetry().catch(() => { }); }, TELEMETRY_FLUSH_MS);
  if (t.unref) t.unref();
  return t;
}

/// Desligar o consentimento apaga a fila (o GDZ faz o mesmo).
function apagarFila() {
  saveTelemetryQueue([]);
}

// ── Funil de plano ───────────────────────────────────────────────────────
/// Guarda um evento do funil (upsell_view, upsell_click, offer_view,
/// offer_click, referral_copy — os mesmos nomes do GDZ).
// Eventos que o funil aceita — os mesmos do GDZ (PLAN_EVENTS). O nome vem do
// renderer e ia direto para o servidor: qualquer texto (até marcação) entrava.
const PLAN_EVENTS = ['upsell_view', 'upsell_click', 'offer_view', 'offer_click', 'referral_copy'];

/// Guarda um evento do funil. Formato do GDZ: { type, trigger }. O envio em lote
/// espera 15 s (o GDZ usa 15000) e manda no máximo 30 de uma vez.
function planEvent(tipo, trigger) {
  const nome = String(tipo || '').trim().toLowerCase();
  if (!PLAN_EVENTS.includes(nome)) return;
  const item = { type: nome, at: Date.now() };
  if (trigger !== null && trigger !== undefined) item.trigger = String(trigger).slice(0, 64);
  planEvents.push(item);
  if (planEvents.length > 200) planEvents.splice(0, planEvents.length - 200);
  if (!planEventsTimer) {
    planEventsTimer = setTimeout(() => { flushPlanEvents().catch(() => { }); }, 15000);
    if (planEventsTimer.unref) planEventsTimer.unref();
  }
}

/// Manda até 30 eventos de uma vez. Igual ao GDZ.
async function flushPlanEvents() {
  planEventsTimer = null;

  // PRIMEIRO confirma que tem para onde mandar e que tem o que mandar.
  //
  // Antes o splice(0,30) vinha antes deste teste: com a sessão ainda null (acontece
  // logo depois de abrir o app, porque deps.usuario() é assíncrono aqui), os
  // eventos eram retirados da fila e descartados sem nenhum envio.
  // O GDZ tem o mesmo formato, mas lá o currentUser é síncrono e já existe.
  if (!planEvents.length) return;
  const u = await Promise.resolve(deps.usuario()).catch(() => null);
  if (!u) return;
  const sessao = await Promise.resolve(deps.sessaoAtual()).catch(() => null);
  if (!sessao || sessao.offline) return;

  const lote = planEvents.splice(0, 30);

  try {
    const r = await deps.apiCall('POST', '/app/events', { events: lote });
    // 400 = o servidor recusou o conteúdo (evento com nome fora da lista, por
    // exemplo). Descartar é o certo: reenviar não resolve.
    // Qualquer outra falha devolve o lote para a fila, para tentar de novo.
    if (r && r.status === 400) return;
    if (!r || r.status === 0 || r.status >= 500) planEvents.unshift(...lote);
  } catch (e) {
    planEvents.unshift(...lote);
  }
}

module.exports = {
  // constantes (expostas para teste)
  TELEMETRY_MAX_QUEUE, TELEMETRY_BATCH, TELEMETRY_FLUSH_MS, FPS_PAIR_WINDOW_MS,
  // ciclo de vida
  configurar, iniciar, apagarFila,
  // fila
  loadTelemetryQueue, saveTelemetryQueue,
  // hardware
  hardwareSnapshot, hardwareDetails, displayDetails,
  // fps
  fpsTelemetryItem, enqueueFpsTelemetry, telemetryOn, flushTelemetry,
  // funil
  planEvent, flushPlanEvents,
};
