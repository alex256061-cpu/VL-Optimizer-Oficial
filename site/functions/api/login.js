/**
 * functions/api/login.js — login do site/app pelo SERVIDOR (Cloudflare Function).
 *
 * Por que existe: o bloqueio de "8 tentativas erradas em 15 minutos" era feito por uma
 * função do Supabase chamada direto pelo navegador:
 *   - qualquer pessoa (sem login) conseguia chamar limpar_falhas_login e apagar o bloqueio;
 *   - também conseguia registrar falhas em massa (spam na tabela / travar login de alguém).
 *
 * Agora o site e o app mandam e-mail/senha para cá. Esta Function:
 *   1. limita por IP (e por e-mail, na memória da instância);
 *   2. consulta o bloqueio no banco (login_bloqueado) usando a service key — nunca no cliente;
 *   3. confere a senha no Supabase Auth (GoTrue);
 *   4. se erro de credencial, registra a falha (registrar_falha_login) no servidor;
 *   5. se deu certo, limpa as falhas e devolve a sessão.
 *
 * Sem as variáveis de ambiente configuradas, responde 503 (nada é liberado no escuro).
 * A resposta de erro é sempre genérica para não revelar se o e-mail existe.
 */

import { limite, ipDe } from './_limite.js';

const SUPABASE_FALLBACK = 'https://wsmropvlmnyegpvmyndn.supabase.co';
// Chave pública por natureza (é a mesma que o site já entrega no navegador).
const ANON_FALLBACK = 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function saida(env, obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Mesmo site usa o endpoint. App Electron (processo principal) não sofre CORS.
      'Access-Control-Allow-Origin': String(env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/+$/, ''),
      'Vary': 'Origin',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = ipDe(request);
  const bloqueioIp = limite('login-ip:' + ip, 25, 10 * 60 * 1000);
  if (bloqueioIp) return saida(env, { ok: false, erro: bloqueioIp.erro }, 429);

  let corpo;
  try { corpo = await request.json(); } catch (e) { corpo = null; }
  if (!corpo || typeof corpo !== 'object') {
    return saida(env, { ok: false, erro: 'Não foi possível ler os dados do login.' }, 400);
  }

  const email = String(corpo.email || '').trim().toLowerCase();
  const senha = String(corpo.senha || '');
  if (!EMAIL_RE.test(email) || email.length > 200 || !senha || senha.length > 200) {
    // Mensagem genérica: não confirma se o e-mail existe ou é válido.
    return saida(env, { ok: false, erro: 'E-mail ou senha incorretos.' }, 401);
  }

  const bloqueioEmail = limite('login-email:' + email, 15, 15 * 60 * 1000);
  if (bloqueioEmail) return saida(env, { ok: false, erro: bloqueioEmail.erro, bloqueado: true }, 429);

  const base = String(env.SUPABASE_URL || SUPABASE_FALLBACK).replace(/\/+$/, '');
  const svc = String(env.SUPABASE_SERVICE || '');
  if (!svc) return saida(env, { ok: false, erro: 'Login indisponível agora. Tente mais tarde.' }, 503);
  const anon = String(env.SUPABASE_ANON || ANON_FALLBACK);
  const cabSvc = { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' };

  // 1. bloqueio persistido no banco (só o servidor consulta)
  try {
    const rb = await fetch(base + '/rest/v1/rpc/login_bloqueado', {
      method: 'POST', headers: cabSvc, body: JSON.stringify({ p_email: email }),
    });
    const jb = rb.ok ? await rb.json().catch(() => null) : null;
    if (jb && jb.bloqueado) {
      return saida(env, {
        ok: false,
        erro: jb.mensagem || 'Muitas tentativas. Tente de novo em alguns minutos.',
        bloqueado: true,
      }, 429);
    }
  } catch (e) { /* banco fora: segue para o GoTrue, que também tem limite próprio */ }

  // 2. confere a senha no Supabase Auth
  let r;
  let dados = null;
  try {
    r = await fetch(base + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    const txt = await r.text();
    try { dados = txt ? JSON.parse(txt) : null; } catch (e) { dados = null; }
  } catch (e) {
    return saida(env, { ok: false, erro: 'Sem conexão com o servidor. Tente de novo.' }, 502);
  }

  if (!r.ok) {
    const msg = String((dados && (dados.error_description || dados.msg || dados.message)) || '').toLowerCase();

    // Só registra falha de credencial; 5xx/429 do GoTrue não são "tentativa errada".
    if (r.status < 500 && r.status !== 429) {
      const reg = fetch(base + '/rest/v1/rpc/registrar_falha_login', {
        method: 'POST', headers: cabSvc, body: JSON.stringify({ p_email: email, p_ip: ip }),
      }).catch(() => { });
      try { if (context.waitUntil) context.waitUntil(reg); else await reg; } catch (e) { }
    }

    if (msg.includes('email not confirmed')) {
      return saida(env, { ok: false, erro: 'Confirme seu e-mail antes de entrar.' }, 401);
    }
    if (r.status === 429) {
      return saida(env, { ok: false, erro: 'Muitas tentativas. Espere um minuto e tente de novo.' }, 429);
    }
    return saida(env, { ok: false, erro: 'E-mail ou senha incorretos.' }, 401);
  }

  if (!dados || !dados.access_token) {
    return saida(env, { ok: false, erro: 'Não foi possível entrar agora. Tente de novo.' }, 502);
  }

  // 3. deu certo: limpa as falhas (best-effort; não atrasa a resposta)
  try {
    const limpar = fetch(base + '/rest/v1/rpc/limpar_falhas_login', {
      method: 'POST', headers: cabSvc, body: JSON.stringify({ p_email: email }),
    }).catch(() => { });
    if (context.waitUntil) context.waitUntil(limpar); else await limpar;
  } catch (e) { }

  return saida(env, {
    ok: true,
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    expires_in: dados.expires_in || 3600,
    token_type: dados.token_type || 'bearer',
    user: dados.user || null,
  });
}

export async function onRequestOptions({ env }) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': String(env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/+$/, ''),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, erro: 'Use POST.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Allow': 'POST, OPTIONS' },
  });
}
