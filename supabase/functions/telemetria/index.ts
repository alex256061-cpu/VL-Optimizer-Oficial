// ══════════════════════════════════════════════════════════════════════════
// Edge Function: telemetria — recebe o que o telemetria.js manda
//
// O GDZ tem três endpoints em api.gdzfps.com:
//   POST /app/telemetry  { fps[], hardware? }   -> 200 (ok), 400 (lote inválido)
//   POST /app/events     { events[] }           -> 200
//   POST /app/consent    { telemetry: true }    -> 200
//
// O app (telemetria.js) foi portado fielmente e fala nesses mesmos caminhos.
// O supabase.js traduz a rota para esta função:
//   /app/telemetry -> /functions/v1/telemetria/telemetry
//   /app/events    -> /functions/v1/telemetria/events
//   /app/consent   -> /functions/v1/telemetria/consent
//
// Sem esta função o app recebia 404, a fila enchia até 500 e parava — o dado
// ficava preso no disco do cliente.
//
// AUTENTICAÇÃO: o access_token do Supabase (o mesmo da licença). O `uid` vem
// SEMPRE do token, nunca do corpo — o app não escolhe em nome de quem grava.
//
// LIMITES (defesa em profundidade): o app já corta, mas o servidor confere de
// novo, porque o corpo pode chegar de qualquer lugar.
// ══════════════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Usuario = { id: string; email: string | null };

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });
}

function env(...nomes: string[]): string {
  for (const n of nomes) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return '';
}

function restUrl(caminho: string): string {
  const base = env('SB_URL', 'SUPABASE_URL').replace(/\/$/, '');
  return base + '/rest/v1/' + caminho;
}

async function usuarioDoToken(token: string): Promise<Usuario | null> {
  const url = env('SB_URL', 'SUPABASE_URL').replace(/\/$/, '');
  const anon = env('SB_ANON_KEY', 'SUPABASE_ANON_KEY');
  if (!url) return null;
  try {
    const r = await fetch(url + '/auth/v1/user', {
      headers: { apikey: anon, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || typeof u.id !== 'string' || !u.id) return null;
    return { id: u.id, email: typeof u.email === 'string' ? u.email : null };
  } catch (_e) {
    return null;
  }
}

async function inserir(tabela: string, linhas: unknown[]): Promise<boolean> {
  const chave = env('SB_SERVICE_ROLE_KEY');
  if (!chave || !linhas.length) return false;
  const r = await fetch(restUrl(tabela), {
    method: 'POST',
    headers: {
      apikey: chave,
      Authorization: 'Bearer ' + chave,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(linhas),
  });
  return r.ok;
}

/// Insere ou atualiza um hardware por hash. O app reenvia quando o hash muda.
async function upsertHardware(linha: Record<string, unknown>): Promise<boolean> {
  const chave = env('SB_SERVICE_ROLE_KEY');
  if (!chave) return false;
  const r = await fetch(restUrl('telemetria_hardware?on_conflict=hw_hash'), {
    method: 'POST',
    headers: {
      apikey: chave,
      Authorization: 'Bearer ' + chave,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(linha),
  });
  return r.ok;
}

// ── saneamento (o app já corta; aqui confere de novo) ──────────────────
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};
const txt = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const uuid = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
};

/// Converte um item de FPS do app na linha da tabela.
function linhaFps(uid: string, item: Record<string, unknown>) {
  const clientId = uuid(item.clientId);
  if (!clientId) return null; // sem id não dá para remover da fila depois
  return {
    user_id: uid,
    client_id: clientId,
    pair_id: uuid(item.pairId),
    phase: ['before', 'after', 'manual'].includes(String(item.phase)) ? String(item.phase) : 'manual',
    game: txt(item.game, 64),
    duration_s: num(item.durationS, 5, 120),
    fps_avg: num(item.fpsAvg, 0, 10000),
    low_1: num(item.low1, 0, 10000),
    low_01: num(item.low01, 0, 10000),
    frametime_avg: num(item.frametimeAvg, 0, 10000),
    frames: num(item.frames, 0, 100000000),
    optimizations: Array.isArray(item.optimizations)
      ? item.optimizations.filter((x) => typeof x === 'string').slice(0, 80).map((x) => String(x).slice(0, 64))
      : [],
    app_version: txt(item.appVersion, 32),
    captured_at: typeof item.capturedAt === 'string' ? item.capturedAt.slice(0, 40) : null,
  };
}

/// Converte o snapshot de hardware do app na linha da tabela.
function linhaHardware(uid: string, hw: Record<string, unknown>, hash: string) {
  const d = (hw.details && typeof hw.details === 'object' ? hw.details : {}) as Record<string, unknown>;
  return {
    hw_hash: hash.slice(0, 64),
    user_id: uid,
    cpu_name: txt(hw.cpuName, 96),
    cpu_vendor: txt(hw.cpuVendor, 16),
    x3d: hw.x3d === true,
    intel_hybrid: hw.intelHybrid === true,
    gpu_name: txt(hw.gpuName, 96),
    gpu_vendor: txt(hw.gpuVendor, 16),
    ram_gb: num(hw.ramGb, 1, 4096),
    laptop: hw.laptop === true,
    os_build: txt(hw.osBuild, 32),
    // detalhes (as mesmas faixas do hardwareDetails do GDZ)
    cpu_cores: num(d.cpuCores, 1, 256),
    cpu_threads: num(d.cpuThreads, 1, 512),
    cpu_max_ghz: num(d.cpuMaxGhz, 0.5, 10),
    gpu_vram_gb: num(d.gpuVramGb, 0, 512),
    gpu_driver: txt(d.gpuDriver, 32),
    gpu_count: num(d.gpuCount, 0, 8),
    ram_speed_mhz: num(d.ramSpeedMhz, 1, 20000),
    ram_modules: num(d.ramModules, 1, 32),
    disk_type: ['NVMe', 'SSD', 'HDD'].includes(String(d.diskType)) ? String(d.diskType) : null,
    disk_gb: num(d.diskGb, 1, 100000),
    board: txt(d.board, 96),
    windows: txt(d.windows, 64),
    power_plan: txt(d.powerPlan, 64),
    screen_w: num(d.screenW, 0, 20000),
    screen_h: num(d.screenH, 0, 20000),
    refresh_hz: num(d.refreshHz, 1, 1000),
    displays: num(d.displays, 1, 16),
    updated_at: new Date().toISOString(),
  };
}

// Os mesmos nomes de evento do funil do GDZ (PLAN_EVENTS).
const PLAN_EVENTS = ['upsell_view', 'upsell_click', 'offer_view', 'offer_click', 'referral_copy'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método não suportado' }, 405);

  try {
    // 1. quem está mandando. O id vem DO TOKEN, nunca do corpo.
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'sem sessão' }, 401);
    const user = await usuarioDoToken(token);
    if (!user) return json({ error: 'sessão inválida ou expirada' }, 401);

    // 2. qual endpoint: /functions/v1/telemetria/<x>
    const partes = new URL(req.url).pathname.split('/').filter(Boolean);
    const acao = partes[partes.length - 1] || '';

    let corpo: Record<string, unknown> = {};
    try { corpo = ((await req.json()) || {}) as Record<string, unknown>; } catch (_e) { corpo = {}; }

    // ── /consent ──────────────────────────────────────────────────────
    if (acao === 'consent') {
      // O app manda { telemetry: true } antes do primeiro lote de FPS. Aqui só
      // registra; quem decide mandar é o cliente (settings.telemetryConsent).
      await inserir('telemetria_consentimento', [{
        user_id: user.id,
        telemetry: corpo.telemetry === true,
        at: new Date().toISOString(),
      }]);
      return json({ ok: true });
    }

    // ── /telemetry ────────────────────────────────────────────────────
    if (acao === 'telemetry') {
      const fps = Array.isArray(corpo.fps) ? (corpo.fps as Record<string, unknown>[]).slice(0, 50) : [];
      const hw = corpo.hardware && typeof corpo.hardware === 'object' ? (corpo.hardware as Record<string, unknown>) : null;

      if (!fps.length && !hw) return json({ error: 'lote vazio' }, 400);

      const linhas = fps.map((i) => linhaFps(user.id, i)).filter((x) => x !== null);
      // Se NENHUM item tinha clientId, o lote é inválido: devolver 400 é o que faz o
      // app descartar em vez de reenviar para sempre (mesmo contrato do GDZ).
      if (fps.length && !linhas.length) return json({ error: 'lote inválido' }, 400);

      if (linhas.length) {
        const ok = await inserir('telemetria_fps', linhas);
        if (!ok) return json({ error: 'não foi possível gravar' }, 500);
      }

      if (hw) {
        // hash calculado no servidor: o app manda o snapshot, o servidor decide o id.
        const json2 = JSON.stringify(hw);
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json2));
        const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
        const okHw = await upsertHardware(linhaHardware(user.id, hw, hash));
        if (!okHw) return json({ error: 'não foi possível gravar o hardware' }, 500);
      }

      return json({ ok: true, fps: linhas.length });
    }

    // ── /events ───────────────────────────────────────────────────────
    if (acao === 'events') {
      const eventos = Array.isArray(corpo.events) ? (corpo.events as Record<string, unknown>[]).slice(0, 30) : [];
      const linhas = eventos
        .filter((e) => e && PLAN_EVENTS.includes(String(e.type)))
        .map((e) => ({
          user_id: user.id,
          type: String(e.type),
          trigger: txt(e.trigger, 64),
          at: typeof e.at === 'number' ? new Date(e.at).toISOString() : new Date().toISOString(),
        }));
      if (!linhas.length) return json({ ok: true, events: 0 });
      await inserir('eventos_plano', linhas);
      return json({ ok: true, events: linhas.length });
    }

    return json({ error: 'rota desconhecida: ' + acao }, 404);
  } catch (e) {
    return json({ error: 'falha interna', detalhe: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
