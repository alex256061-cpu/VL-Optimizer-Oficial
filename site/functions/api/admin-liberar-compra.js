/**
 * admin-liberar-compra.js — libera manualmente uma compra (suporte).
 *
 * POST /api/admin-liberar-compra
 *   { "pagamentoId": "191672880352", "email": "comprador@email.com" }
 *     -> busca o pagamento aprovado no Mercado Pago, cria a conta se não existir,
 *        libera o plano, corrige o e-mail da venda e manda o link para criar senha.
 *
 * Também aceita modo de teste (só admin):
 *   { "simular": true, "email": "...", "plano": "mensal", "dias": 30, "valor": 40 }
 *     -> usa um pagamento_id fictício "TESTE-..." para validar o fluxo sem cobrar.
 *
 * Serve para recuperar compras antigas que foram aprovadas sem conta (como o PIX
 * anônimo, em que o Mercado Pago mascara o pagador como XXXXXXXXXXX).
 */

import { exigirAdmin, responder, metodoPermitido, lerCorpo, registrarAuditoria } from './_admin.js';
import { processarAprovado, emailCompradorValido } from './_venda.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const { base, svc } = admin;
  const email = String(corpo.email || '').trim().toLowerCase();
  const simular = corpo.simular === true;

  if (!emailCompradorValido(email)) {
    return responder({ ok: false, erro: 'Informe um e-mail válido do comprador.' }, 400);
  }

  let dados;
  if (simular) {
    dados = {
      pagamentoId: 'TESTE-' + Date.now(),
      email,
      plano: String(corpo.plano || 'mensal'),
      dias: corpo.dias === undefined ? 30 : corpo.dias,
      valor: Number(corpo.valor || 0),
      metodo: 'teste',
    };
  } else {
    const id = String(corpo.pagamentoId || '').replace(/\D/g, '');
    if (!id) return responder({ ok: false, erro: 'Informe o id do pagamento.' }, 400);
    if (!env.MP_ACCESS_TOKEN) return responder({ ok: false, erro: 'MP_ACCESS_TOKEN ausente.' }, 503);

    let pag;
    try {
      const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
        headers: { Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN, Accept: 'application/json' },
      });
      pag = await r.json();
      if (!r.ok) return responder({ ok: false, erro: 'Pagamento não encontrado no Mercado Pago (' + r.status + ').' }, 404);
    } catch (e) {
      return responder({ ok: false, erro: 'Não consegui consultar o Mercado Pago.' }, 502);
    }
    if (pag.status !== 'approved') {
      return responder({ ok: false, erro: 'Este pagamento não está aprovado (status: ' + pag.status + ').' }, 409);
    }

    const meta = pag.metadata || {};
    dados = {
      pagamentoId: String(pag.id),
      email,
      plano: meta.plano || (String(pag.description || '').toLowerCase().includes('vital') ? 'vitalicio' : 'mensal'),
      dias: meta.dias,
      valor: pag.transaction_amount,
      metodo: pag.payment_method_id || 'pix',
    };
  }

  const r = await processarAprovado({ base, svc, env }, dados);

  try {
    await registrarAuditoria(base, svc, admin.perfil, simular ? 'teste_liberar_compra' : 'compra_liberada_manual', email,
      (simular ? 'SIMULACAO' : 'pag=' + dados.pagamentoId) + ' plano=' + dados.plano + ' ok=' + (!!r.ok));
  } catch (e) { }

  if (!r.ok) return responder({ ok: false, erro: r.erro || 'Não foi possível liberar.' }, 422);

  return responder({
    ok: true,
    simular,
    email: r.email,
    plano: r.plano,
    dias: r.dias === null ? 'vitalício' : r.dias,
    conta_criada: !!r.contaCriada,
    aviso_email: !!r.avisoEmail,
    ja_era_pro: !!r.jaEraPro,
    pagamento: simular ? null : dados.pagamentoId,
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use POST.' }, 405);
}
