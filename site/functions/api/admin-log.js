/**
 * admin-log.js — registro de auditoria do painel (quem fez o quê, quando).
 *
 * GET  /api/admin-log?limite=60      -> { ok, itens: [{ quando, admin, acao, alvo, detalhe }] }
 * POST /api/admin-log {acao, alvo, detalhe} -> registra uma ação
 *
 * Sem tabela nova: as linhas ficam em objetos JSON num bucket privado do Storage
 * (auditoria/AAAA-...json). Só administrador lê e escreve.
 */

import { exigirAdmin, responder, metodoPermitido, lerCorpo, storageListar, storageLer, registrarAuditoria } from './_admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const url = new URL(request.url);
  let limite = Number(url.searchParams.get('limite') || 60);
  if (!Number.isFinite(limite)) limite = 60;
  limite = Math.min(120, Math.max(1, Math.round(limite)));

  const { base, svc } = admin;
  const objetos = await storageListar(base, svc, 'auditoria', '', limite);
  const lidos = await Promise.all(
    objetos.slice(0, limite).map(async (o) => {
      const d = await storageLer(base, svc, 'auditoria', o.name);
      if (!d) return null;
      return {
        quando: d.quando || (o.created_at || null),
        admin: d.admin || '—',
        acao: d.acao || '—',
        alvo: d.alvo || null,
        detalhe: d.detalhe || null,
      };
    })
  );
  const itens = lidos.filter(Boolean).sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
  return responder({ ok: true, itens, limite });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const acao = String(corpo.acao || '').trim().slice(0, 80);
  if (!acao) return responder({ ok: false, erro: 'Informe a ação.' }, 400);

  const ok = await registrarAuditoria(admin.base, admin.svc, admin.perfil, acao, corpo.alvo, corpo.detalhe);
  return responder({ ok: !!ok });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use GET ou POST.' }, 405);
}
