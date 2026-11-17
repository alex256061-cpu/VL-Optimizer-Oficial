// ══════════════════════════════════════════════════════════════════════════
// Edge Function: entitlement — assina a LICENÇA do VL (Ed25519)
//
// O QUE ESTA FUNÇÃO RESOLVE
//   O app confiava só no HTTPS do Supabase. O `offlineUntil` (quanto tempo o app
//   funciona sem internet) era calculado no PC e gravado no auth.bin. O auth.bin é
//   cifrado com o safeStorage (DPAPI), mas quem já está na conta do Windows consegue
//   abrir o arquivo e mudar a data — ou seja, licença de graça.
//
//   O GDZ não deixa: o servidor devolve um payload ASSINADO com Ed25519 contendo
//   `offlineUntil`, e o app confere com uma chave pública embutida no .exe
//   (C:\VLTemp\TIME\t6-scaling.md §verifyEntitlement / §refreshEntitlement).
//
//   Esta função faz o papel do servidor do GDZ. Ela NÃO mudou o banco nem o login.
//
// CONTRATO (o que o app espera)
//
//   POST /functions/v1/entitlement
//     header  Authorization: Bearer <access_token do Supabase>
//     body    { segredo, hwid }            (todos opcionais na serialização)
//
//   200 { entitlement: "payloadB64url.assinaturaB64url",   <- IGUAL ao GDZ
//         payload: "payloadB64url",
//         assinatura: "assinaturaB64url",
//         claims: { ... } }                               (só para o dono ver no log)
//   401 sessão inválida / expirada
//   403 segredo errado (LICENÇA assinada é recusada ANTES de assinar)
//   404 plano não encontrado
//   503 chave privada não configurada (o app cai no modo de hoje, sem assinatura)
//
// CLAIMS (contrato completo, t6-scaling.md §userFromClaims)
//   v (1), uid, did, email, plan, features[], licenseExpiresAt, lifetime, pcBound,
//   offlineUntil, latestVersion, minVersion, reason
//
//   Aqui `uid` é o id do usuário no Supabase (uuid, texto) e não um inteiro como no
//   GDZ: o nosso banco não tem id numérico. O cliente exige `v === 1` e `uid` não
//   vazio — a checagem é no validador do app (entidade-licenca.js), não inventei um
//   inteiro que não existe.
//
// POR QUE NÃO BASTA "CODIGO = USUÁRIO LOGADO"
//   O cadastro é aberto. Com uma regra dessas, qualquer pessoa cria uma conta e recebe
//   uma licença assinada vitalícia. O `segredo` (um blob opaco embutido no app, tipo a
//   apiKey do GDZ) é o que dá a garantia de que a assinatura só sai para quem tem o
//   CLIENTE. Ele é conferido contra o sha256 guardado no banco — o banco não guarda o
//   segredo em si. Vazou? Troca o hash no SQL Editor e publica outro build; as licenças
//   já emitidas continuam valendo (a chave privada não mudou).
//
// O QUE **NÃO** MUDOU (compatibilidade — armadilha 2 do briefing)
//   Nenhuma RPC do banco mudou de contrato. O app 1.4.35 nem chama esta função: para ele
//   nada existe. O app novo chama, verifica e guarda; se a função não existir (404/503,
//   deploy não feito), ele se comporta exatamente como hoje.
//
// VARIÁVEIS DE AMBIENTE (secrets do projeto)
//   VL_ENTITLEMENT_PRIVATE_KEY  base64 do Ed25519 PKCS8 DER  (obrigatório)
//   SB_URL                      a URL do projeto             (injetado pelo Supabase)
//   SB_SERVICE_ROLE_KEY         a service role               (injetado pelo Supabase)
//   VL_OFFLINE_DIAS             dias de licença offline (padrão 7, igual ao app)
//   VL_MIN_VERSION              opcional: vira a claim minVersion
// ══════════════════════════════════════════════════════════════════════════

// Só a biblioteca padrão do Deno: nada de `npm:` nem de URL remota. O deploy é um
// `supabase functions deploy entitlement` e não depende de rede na build.
import { encodeBase64Url } from 'jsr:@std/encoding@1.0.5/base64url';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const J = { 'Content-Type': 'application/json', ...CORS };

// A mesma tolerância que o app usa para "o relógio não pode voltar": aqui ela é usada
// ao contrário — a licença offline nunca nasce de uma base no futuro.
const DIAS_PADRAO = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: J });
}

// ── chave privada do secret ──────────────────────────────────────────────
// Guardada em cache no escopo do isolate: o secret não muda sem novo deploy.
let chavePrivada: CryptoKey | null = null;
let chaveErro: string | null = null;

async function carregarChave(): Promise<CryptoKey> {
  if (chavePrivada) return chavePrivada;
  if (chaveErro) throw new Error(chaveErro);

  const b64 = (Deno.env.get('VL_ENTITLEMENT_PRIVATE_KEY') || '').trim();
  if (!b64) {
    chaveErro = 'VL_ENTITLEMENT_PRIVATE_KEY não configurada';
    throw new Error(chaveErro);
  }
  try {
    // É o PKCS8 DER em base64, exatamente o que ferramentas/chave-entitlement.js grava.
    const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    chavePrivada = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
    return chavePrivada;
  } catch (e) {
    chaveErro = 'VL_ENTITLEMENT_PRIVATE_KEY inválida: ' + (e as Error).message;
    throw new Error(chaveErro);
  }
}

// ── sha256 hex (para conferir o segredo contra o hash do banco) ──────────
async function sha256Hex(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Comparação em tempo constante: o segredo é uma senha; comparar com === vaza o
// tamanho do prefixo certo pelo tempo de resposta.
function igualSeguro(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ── quem é o usuário: o MESMO GoTrue que o app já usa ────────────────────
type Usuario = { id: string; email: string | null };

async function usuarioDoToken(token: string): Promise<Usuario | null> {
  const url = (Deno.env.get('SB_URL') || '').replace(/\/$/, '');
  const anon = Deno.env.get('SB_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
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

// ── REST com a service role ──────────────────────────────────────────────
function restUrl(caminho: string): string {
  const url = (Deno.env.get('SB_URL') || '').replace(/\/$/, '');
  return url + '/rest/v1/' + caminho;
}

async function rest(caminho: string): Promise<unknown[]> {
  const chave = Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
  const r = await fetch(restUrl(caminho), {
    headers: { apikey: chave, Authorization: 'Bearer ' + chave, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error('REST ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

type Perfil = {
  plan: string;
  features: string[] | null;
  lifetime: boolean;
  license_expires_at: string | null;
  max_devices: number;
};

// Mesma avaliação que `perfil()` e `verificar_pc` fazem hoje: plano 'pro' E não vencido.
// `features` de plano vencido/gratuito é ['painel'], igual ao app.
function avaliar(p: Perfil) {
  const expMs = p.license_expires_at ? Date.parse(p.license_expires_at) : NaN;
  const vencida = Number.isFinite(expMs) && expMs <= Date.now();
  const planoValido = p.plan === 'pro' && !vencida;
  return {
    planoValido,
    vencida,
    plan: planoValido ? 'pro' : 'free',
    features: planoValido && Array.isArray(p.features) && p.features.length ? p.features.slice() : ['painel'],
    lifetime: !!p.lifetime,
    expMs: Number.isFinite(expMs) ? expMs : null,
  };
}

// ── o payload que vai assinado ───────────────────────────────────────────
// offlineUntil = min(agora + N dias, validade). É a MESMA conta que o app fazia em
// `offlineUntilDe` — a diferença é quem assina agora.
//
// Regras:
//   - plano não válido -> offlineUntil 0 (= sem modo offline). O app só usa o ramo
//     offline com licença 'pro' em dia; é o que o GDZ faz ao não emitir offlineUntil
//     para quem não tem licença.
//   - lifetime / sem validade -> teto infinito, então dá agora + N dias.
//   - validade curta -> nunca passa da validade (licença de 3 dias não vira 7).
function montarClaims(
  u: Usuario,
  a: ReturnType<typeof avaliar>,
  did: string | null,
  versao: { latest: string | null; min: string | null },
) {
  const agora = Date.now();
  const dias = Number(Deno.env.get('VL_OFFLINE_DIAS') || DIAS_PADRAO);
  const N = Number.isFinite(dias) && dias > 0 ? dias : DIAS_PADRAO;

  let offlineUntil = 0;
  if (a.planoValido) {
    const teto = a.lifetime || a.expMs === null ? Infinity : a.expMs;
    offlineUntil = Math.min(agora + N * DIA_MS, teto);
  }

  return {
    v: 1,
    uid: u.id,                                  // uuid do Supabase (string), não int
    did,                                        // HWID que o app mandou
    email: u.email,
    plan: a.plan,
    features: a.features,
    licenseExpiresAt: a.lifetime ? null : (a.expMs !== null ? new Date(a.expMs).toISOString() : null),
    lifetime: a.lifetime,
    pcBound: false,                             // o verificar_pc é quem decide isso
    offlineUntil,
    latestVersion: versao.latest,
    minVersion: versao.min,
    // Campo do GDZ que o app dele lê; mantido para o contrato ficar completo.
    reason: a.vencida ? 'expired' : null,
    // Instante da emissão: serve para saber / registrar quando a licença foi renovada.
    iat: agora,
  };
}

async function assinarClaims(claims: Record<string, unknown>) {
  const corpo = new TextEncoder().encode(JSON.stringify(claims));
  const chave = await carregarChave();
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', chave, corpo));
  const payload = encodeBase64Url(corpo);
  const assinatura = encodeBase64Url(sig);
  // O formato do GDZ: dois segmentos separados por UM ponto (não é JWT de 3 partes).
  return { payload, assinatura, entitlement: payload + '.' + assinatura };
}

// ── handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'método não suportado' }, 405);
  }

  try {
    // 1. autenticação. O token é o access_token do Supabase que o app já tem.
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'sem sessão' }, 401);

    const user = await usuarioDoToken(token);
    if (!user) return json({ error: 'sessão inválida ou expirada' }, 401);

    // 2. corpo (GET não manda corpo; o app manda para casar o segredo e o HWID)
    let corpo: Record<string, unknown> = {};
    if (req.method === 'POST') {
      try { corpo = (await req.json()) || {}; } catch (_e) { corpo = {}; }
    }
    const segredo = typeof corpo.segredo === 'string' ? corpo.segredo : '';
    const did = typeof corpo.hwid === 'string' ? corpo.hwid.slice(0, 128) : null;

    // 3. segredo do cliente. Falha ANTES de tocar na chave privada.
    if (!segredo) return json({ error: 'app sem credencial de licença' }, 403);
    const cfg = await rest('entitlement_config?id=eq.1&select=segredo_sha256').catch(() => []) as { segredo_sha256: string }[];
    const esperado = cfg && cfg[0] ? String(cfg[0].segredo_sha256 || '') : '';
    if (!esperado) {
      // Sem o SQL aplicado não dá para conferir nada: recuse em vez de assinar de graça.
      return json({ error: 'entitlement não configurado no banco (rode entitlement-SQL.sql)' }, 503);
    }
    if (!igualSeguro(await sha256Hex(segredo), esperado.toLowerCase())) {
      return json({ error: 'app não autorizado' }, 403);
    }

    // 4. o perfil: plano, features, validade, lifetime
    const perfis = await rest(
      'profiles?id=eq.' + encodeURIComponent(user.id) +
      '&select=plan,features,lifetime,license_expires_at,max_devices',
    ) as Perfil[];
    if (!perfis || !perfis[0]) return json({ error: 'perfil não encontrado' }, 404);

    const a = avaliar(perfis[0]);

    // 5. versão mínima anunciada (opcional; sem secret fica null, como no GDZ)
    const versao = {
      latest: null as string | null,
      min: normalizaVersao(Deno.env.get('VL_MIN_VERSION')),
    };

    // 6. assina
    const claims = montarClaims(user, a, did, versao);
    let emitida;
    try {
      emitida = await assinarClaims(claims);
    } catch (e) {
      // Sem chave não há licença assinada. 503 é o sinal para o app usar o modo de hoje
      // (sem quebrar ninguém), não para recusar a sessão.
      console.error('[entitlement] chave:', (e as Error).message);
      return json({ error: 'assinatura não configurada' }, 503);
    }

    return json({
      entitlement: emitida.entitlement,   // formato do GDZ
      payload: emitida.payload,           // formato que o briefing pediu
      assinatura: emitida.assinatura,
      claims,                             // conveniência (o app NÃO confia neste campo)
    }, 200);
  } catch (e) {
    console.error('[entitlement] falha:', (e as Error).message);
    // 5xx: o app trata como "servidor fora" e segue pelo modo offline, como hoje.
    return json({ error: 'falha interna' }, 500);
  }
});

function normalizaVersao(v: string | null): string | null {
  const s = String(v || '').trim();
  return /^\d+\.\d+\.\d+/.test(s) ? s : null;
}
