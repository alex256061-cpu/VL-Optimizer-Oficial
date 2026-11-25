/**
 * admin-pix-pendentes.js — PIX gerados e ainda não pagos.
 *
 * GET /api/admin-pix-pendentes?dias=7
 *   -> { ok, dias, lista: [{ id, status, valor, email, plano, criado, descricao }], total, quantidade }
 *
 * As cobranças pendentes NÃO ficam no nosso banco (só a venda aprovada é gravada em
 * vendas). Elas existem no Mercado Pago, então consultamos a API deles aqui com a
 * chave secreta que fica só no servidor.
 *
 * Só administrador logado.
 */

import { exigirAdmin, responder, metodoPermitido } from './_admin.js';

const isoInicio = (dias) => {
  const d = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  return d.toISOString();
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueioMetodo = metodoPermitido(request, ['GET']);
  if (bloqueioMetodo) return bloqueioMetodo;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const token = String(env.MP_ACCESS_TOKEN || '').trim();
  if (!token) {
    return responder({ ok: false, erro: 'Mercado Pago não configurado (MP_ACCESS_TOKEN ausente).' }, 503);
  }

  const url = new URL(request.url);
  let dias = Number(url.searchParams.get('dias') || 7);
  if (!Number.isFinite(dias)) dias = 7;
  dias = Math.min(60, Math.max(1, Math.round(dias)));

  // Formato aceito pelo /v1/payments/search: sort=date_created + criteria=desc.
  // O filtro de data é feito aqui (o range da API exige formato de data com offset e
  // já nos custou um 400). Traz as últimas 60 e filtra em memória.
  const qs = new URLSearchParams();
  qs.set('sort', 'date_created');
  qs.set('criteria', 'desc');
  qs.set('limit', '60');

  let dados = null;
  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/search?' + qs.toString(), {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('MP payments/search falhou:', r.status, txt.slice(0, 300));
      return responder({ ok: false, erro: 'O Mercado Pago recusou a consulta (' + r.status + ').' }, 502);
    }
    dados = await r.json();
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui falar com o Mercado Pago agora.' }, 502);
  }

  const resultados = Array.isArray(dados && dados.results) ? dados.results : [];
  const desde = Date.now() - dias * 24 * 60 * 60 * 1000;
  const PENDENTES = new Set(['pending', 'in_process', 'authorized', 'in_mediation']);
  const lista = resultados
    .filter((p) => {
      const quando = Date.parse(p.date_created || '');
      return Number.isFinite(quando) ? quando >= desde : true;
    })
    .filter((p) => PENDENTES.has(String(p.status || '').toLowerCase()))
    .map((p) => {
      const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata : {};
      const plano = meta.plano || (String(p.description || '').toLowerCase().includes('vital') ? 'vitalicio' : 'mensal');
      return {
        id: p.id,
        status: p.status,
        valor: Number(p.transaction_amount || 0),
        email: (p.payer && p.payer.email) || p.external_reference || '',
        plano,
        dias: meta.dias == null ? null : meta.dias,
        criado: p.date_created || null,
        descricao: p.description || '',
        metodo: p.payment_method_id || 'pix',
      };
    })
    .filter((p) => p.email && !/@comprador\.vl-optimizer\.com$/i.test(p.email));

  const total = lista.reduce((s, p) => s + Number(p.valor || 0), 0);

  return responder({
    ok: true,
    dias,
    quantidade: lista.length,
    total: Math.round(total * 100) / 100,
    lista: lista.slice(0, 30),
    atualizado_em: new Date().toISOString(),
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return responder({ ok: false, erro: 'Use GET.' }, 405);
}
