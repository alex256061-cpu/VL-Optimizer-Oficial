/**
 * admin-mp-pagamento.js — consulta um pagamento no Mercado Pago (só admin).
 * Uso: GET /api/admin-mp-pagamento?id=191672880352
 * Serve para descobrir o e-mail real do pagador e diagnosticar vendas.
 */

import { exigirAdmin, responder, metodoPermitido } from './_admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const token = String(env.MP_ACCESS_TOKEN || '').trim();
  if (!token) return responder({ ok: false, erro: 'MP_ACCESS_TOKEN ausente.' }, 503);

  const id = String(new URL(request.url).searchParams.get('id') || '').replace(/\D/g, '');
  if (!id) return responder({ ok: false, erro: 'Informe o id do pagamento.' }, 400);

  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (!r.ok) return responder({ ok: false, erro: 'Mercado Pago recusou (' + r.status + ').', detalhe: String(txt).slice(0, 300) }, 502);

    const meta = (j && j.metadata) || {};
    return responder({
      ok: true,
      pagamento: {
        id: j.id,
        status: j.status,
        status_detail: j.status_detail,
        valor: j.transaction_amount,
        metodo: j.payment_method_id,
        criado: j.date_created,
        aprovado: j.date_approved,
        descricao: j.description,
        external_reference: j.external_reference || null,
        payer_email: (j.payer && j.payer.email) || null,
        payer_nome: (j.payer && (j.payer.first_name || j.payer.last_name)) ? String(j.payer.first_name || '') + ' ' + String(j.payer.last_name || '') : null,
        metadata_plano: meta.plano || null,
        metadata_email: meta.email || null,
        metadata_dias: meta.dias == null ? null : meta.dias,
        // dados de cartão/pix não são expostos aqui
      },
    });
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui falar com o Mercado Pago.' }, 502);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return responder({ ok: false, erro: 'Use GET.' }, 405);
}
