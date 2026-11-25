/**
 * admin-vendas-recentes.js — alimenta o aviso de "nova venda" no painel.
 *
 * GET /api/admin-vendas-recentes?desde=2026-11-25T00:00:00.000Z
 *   -> { ok, agora, itens: [{email, plano, valor, criado_em, pagamento_id}] }
 *
 * O painel chama de tempos em tempos e mostra um aviso quando aparece venda nova.
 * Só administrador.
 */

import { exigirAdmin, responder, metodoPermitido, cabecalhosServico } from './_admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const url = new URL(request.url);
  const desdeBruto = String(url.searchParams.get('desde') || '');
  const desde = Date.parse(desdeBruto);
  const corte = Number.isFinite(desde) ? new Date(desde).toISOString() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { base, svc } = admin;
  try {
    const r = await fetch(
      base + '/rest/v1/vendas?criado_em=gt.' + encodeURIComponent(corte) +
        '&select=id,pagamento_id,email,plano,valor,metodo,status,criado_em&order=criado_em.desc&limit=20',
      { headers: cabecalhosServico(svc) }
    );
    if (!r.ok) {
      return responder({ ok: false, erro: 'Não consegui ler as vendas (' + r.status + ').' }, 502);
    }
    const itens = await r.json();
    return responder({ ok: true, agora: new Date().toISOString(), desde: corte, itens: Array.isArray(itens) ? itens : [] });
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui ler as vendas agora.' }, 502);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return responder({ ok: false, erro: 'Use GET.' }, 405);
}
