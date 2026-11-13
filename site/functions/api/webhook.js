/**
 * functions/api/webhook.js — recebe o aviso do Mercado Pago e libera o plano.
 *
 * Fluxo:
 *   1. Cliente paga no Mercado Pago (PIX ou cartão)
 *   2. O Mercado Pago chama esta URL
 *   3. Aqui confirmamos o pagamento na API do MP (nunca confiamos no corpo do aviso)
 *   4. Se estiver aprovado, chamamos liberar_plano() no Supabase
 *
 * Segurança: o corpo do webhook pode ser forjado por qualquer pessoa. Por isso a confirmação
 * sempre é feita consultando o Mercado Pago com o nosso token.
 *
 * Variáveis de ambiente:
 *   MP_ACCESS_TOKEN     token do Mercado Pago
 *   SUPABASE_URL        https://wsmropvlmnyegpvmyndn.supabase.co
 *   SUPABASE_SERVICE    chave service_role (pode executar liberar_plano)
 */

export async function onRequestPost({ request, env }) {
  const responder = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  let aviso = {};
  try {
    aviso = await request.json();
  } catch (e) {
    // o Mercado Pago às vezes manda como query string
    const u = new URL(request.url);
    aviso = { type: u.searchParams.get('type'), data: { id: u.searchParams.get('data.id') } };
  }

  const tipo = aviso.type || aviso.topic || '';
  const idPagamento = aviso?.data?.id || aviso?.id;

  // só tratamos aviso de pagamento
  if (!/payment/.test(String(tipo)) || !idPagamento) {
    return responder({ ok: true, ignorado: tipo || 'sem tipo' });
  }

  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE) {
    return responder({ ok: false, erro: 'Webhook sem configuração.' }, 503);
  }

  // 1. confirmar o pagamento direto no Mercado Pago
  let pagamento;
  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + idPagamento, {
      headers: { Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN },
    });
    pagamento = await r.json();
    if (!r.ok) return responder({ ok: false, erro: 'Pagamento não encontrado.' }, 404);
  } catch (e) {
    return responder({ ok: false, erro: 'Falha ao consultar o Mercado Pago.' }, 502);
  }

  // 2. só libera se estiver aprovado
  if (pagamento.status !== 'approved') {
    return responder({ ok: true, status: pagamento.status, liberado: false });
  }

  // 3. descobrir quem comprou e qual plano
  const email = pagamento?.payer?.email || pagamento?.metadata?.email;
  const plano = String(pagamento?.metadata?.plano || '').toLowerCase();
  const dias = pagamento?.metadata?.dias;

  if (!email) {
    return responder({ ok: false, erro: 'Pagamento sem e-mail do comprador.' }, 422);
  }

  // 4. liberar no Supabase pela função liberar_plano
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const planoNormalizado = /mensal|monthly|30/.test(plano) ? 30 : /vital|lifetime/.test(plano) ? null : dias;

  try {
    const r = await fetch(base + '/rest/v1/rpc/liberar_plano', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_alvo: email,
        dias: planoNormalizado,
        recursos: ['*'],
        pcs: 1,
      }),
    });

    const texto = await r.text();
    if (!r.ok) return responder({ ok: false, erro: 'Falha ao liberar plano.', detalhe: texto }, 502);

    // grava a venda para o painel
    try {
      await fetch(base + '/rest/v1/rpc/registrar_venda', {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_pagamento: String(idPagamento),
          p_email: email,
          p_plano: /mensal|monthly|30/.test(plano) ? 'mensal' : 'vitalicio',
          p_valor: Number(pagamento.transaction_amount || 0),
          p_dias: planoNormalizado === null ? null : Number(planoNormalizado),
          p_metodo: pagamento.payment_method_id || 'pix',
        }),
      });
    } catch (e) { }

    return responder({
      ok: true,
      liberado: true,
      email,
      dias: planoNormalizado === null ? 'vitalício' : planoNormalizado + ' dias',
      pagamento: idPagamento,
    });
  } catch (e) {
    return responder({ ok: false, erro: 'Falha de conexão com o banco.' }, 502);
  }
}

// o Mercado Pago às vezes manda GET para validar a URL
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, servico: 'webhook VL Optimizer' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
