/**
 * admin-alterar-email.js — troca o e-mail de login de um cliente (suporte).
 *
 * POST /api/admin-alterar-email  { "email_atual": "antigo@...", "email_novo": "novo@..." }
 *
 * Usa a Auth Admin API (o e-mail é o login) e atualiza profiles.email para o painel
 * continuar consistente. Fica registrado na auditoria (email_alterado).
 * Só administrador.
 */

import { exigirAdmin, cabecalhosServico, authAdmin, responder, metodoPermitido, lerCorpo, registrarAuditoria } from './_admin.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const atual = String(corpo.email_atual || '').trim().toLowerCase();
  const novo = String(corpo.email_novo || '').trim().toLowerCase();
  if (!EMAIL_RE.test(atual)) return responder({ ok: false, erro: 'E-mail atual inválido.' }, 400);
  if (!EMAIL_RE.test(novo)) return responder({ ok: false, erro: 'E-mail novo inválido.' }, 400);
  if (atual === novo) return responder({ ok: false, erro: 'O e-mail novo é igual ao atual.' }, 400);

  const { base, svc } = admin;
  const sb = (caminho) => fetch(base + '/rest/v1/' + caminho, { headers: cabecalhosServico(svc) }).then((r) => (r.ok ? r.json() : []));

  let perfil = null;
  try {
    const lista = await sb('profiles?email=eq.' + encodeURIComponent(atual) + '&select=id,email,name,is_admin&limit=1');
    perfil = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui ler a conta agora.' }, 502);
  }
  if (!perfil) {
    // tenta sem diferenciar maiúsculas
    try {
      const lista = await sb('profiles?email=ilike.' + encodeURIComponent(atual) + '&select=id,email,name,is_admin&limit=1');
      perfil = Array.isArray(lista) && lista.length ? lista[0] : null;
    } catch (e) { }
  }
  if (!perfil) return responder({ ok: false, erro: 'Nenhuma conta com o e-mail atual.' }, 404);

  // e-mail novo não pode já existir
  try {
    const existe = await sb('profiles?email=eq.' + encodeURIComponent(novo) + '&select=id&limit=1');
    if (Array.isArray(existe) && existe.length) {
      return responder({ ok: false, erro: 'Já existe uma conta com o e-mail novo.' }, 409);
    }
  } catch (e) { }

  try {
    const r = await authAdmin(base, svc, 'PUT', 'users/' + encodeURIComponent(perfil.id), { email: novo, email_confirm: true });
    if (!r.ok) {
      const txt = await r.text();
      console.error('admin-alterar-email falhou:', r.status, txt.slice(0, 300));
      return responder({ ok: false, erro: 'O Supabase recusou a troca de e-mail (' + r.status + '). Se a conta tiver e-mail pendente, confirme antes.' }, 502);
    }
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui falar com o Auth agora.' }, 502);
  }

  // mantém profiles.email igual ao login
  try {
    await fetch(base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(perfil.id), {
      method: 'PATCH',
      headers: cabecalhosServico(svc),
      body: JSON.stringify({ email: novo, updated_at: new Date().toISOString() }),
    });
  } catch (e) { }

  {
    const tarefa = registrarAuditoria(base, svc, admin.perfil, 'email_alterado', novo, perfil.email + ' -> ' + novo);
    if (context.waitUntil) context.waitUntil(tarefa); else await tarefa;
  }

  return responder({ ok: true, email_atual: perfil.email, email_novo: novo });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use POST.' }, 405);
}
