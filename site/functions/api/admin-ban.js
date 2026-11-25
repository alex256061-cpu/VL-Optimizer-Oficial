/**
 * admin-ban.js — suspender / reativar uma conta.
 *
 * POST /api/admin-ban  { "email": "cliente@...", "acao": "banir" | "desbanir", "motivo": "..." }
 *
 * Usa o ban nativo do Supabase Auth (ban_duration), então o login fica bloqueado
 * no site E no app — sem precisar de coluna nova no banco. O motivo fica em
 * user_metadata (aparece no histórico do cliente).
 */

import { exigirAdmin, responder, metodoPermitido, lerCorpo, cabecalhosServico, authAdmin, registrarAuditoria } from './_admin.js';

const BAN = '876000h'; // ~100 anos

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const email = String(corpo.email || '').trim().toLowerCase();
  const acao = String(corpo.acao || '').trim().toLowerCase();
  const motivo = String(corpo.motivo || '').trim().slice(0, 300);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return responder({ ok: false, erro: 'E-mail inválido.' }, 400);
  if (!['banir', 'desbanir'].includes(acao)) return responder({ ok: false, erro: 'Ação inválida (banir ou desbanir).' }, 400);
  if (acao === 'banir' && !motivo) return responder({ ok: false, erro: 'Informe o motivo da suspensão.' }, 400);

  const { base, svc } = admin;

  let perfil = null;
  try {
    const r = await fetch(base + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email) + '&select=id,email,name,is_admin&limit=1', {
      headers: cabecalhosServico(svc),
    });
    const lista = r.ok ? await r.json() : [];
    perfil = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui ler a conta agora.' }, 502);
  }
  if (!perfil) return responder({ ok: false, erro: 'Nenhuma conta com este e-mail.' }, 404);
  if (perfil.is_admin) return responder({ ok: false, erro: 'Não é possível suspender uma conta de administrador.' }, 409);

  const patch = acao === 'banir'
    ? { ban_duration: BAN, user_metadata: { ban_reason: motivo, banned_at: new Date().toISOString(), banned_by: admin.perfil.email } }
    : { ban_duration: 'none', user_metadata: { ban_reason: null, banned_at: null, banned_by: null } };

  try {
    const r = await authAdmin(base, svc, 'PUT', 'users/' + encodeURIComponent(perfil.id), patch);
    if (!r.ok) {
      const txt = await r.text();
      console.error('admin-ban falhou:', r.status, txt.slice(0, 300));
      return responder({ ok: false, erro: 'O Supabase recusou a alteração (' + r.status + ').' }, 502);
    }
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui falar com o Auth agora.' }, 502);
  }

  {
    const tarefa = registrarAuditoria(base, svc, admin.perfil, acao === 'banir' ? 'conta_suspensa' : 'conta_reativada', email, motivo || null);
    if (context.waitUntil) context.waitUntil(tarefa); else await tarefa;
  }

  return responder({ ok: true, acao, email, motivo: acao === 'banir' ? motivo : null });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use POST.' }, 405);
}
