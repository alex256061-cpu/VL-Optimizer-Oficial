import { processarAprovado, emailCompradorValido } from './_venda.js';

/**
 * functions/api/webhook.js — recebe o aviso do Mercado Pago e libera o plano.
 *
 * O corpo do webhook pode ser forjado, por isso sempre confirmamos o pagamento
 * consultando o Mercado Pago com o nosso token.
 *
 * A liberação agora é feita por processarAprovado() (_venda.js): grava a venda,
 * cria a conta do comprador se ainda não existir e envia o e-mail para definir senha.
 */

export async function onRequestPost({ request, env }) {
  const responder = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  let aviso = {};
  try {
    aviso = await request.json();
  } catch (e) {
    const u = new URL(request.url);
    aviso = { type: u.searchParams.get('type'), data: { id: u.searchParams.get('data.id') } };
  }

  const tipo = aviso.type || aviso.topic || '';
  const idPagamento = aviso?.data?.id || aviso?.id;

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

  if (pagamento.status !== 'approved') {
    return responder({ ok: true, status: pagamento.status, liberado: false });
  }

  // 2. e-mail do comprador: prefere o que o site mandou (metadata) e depois o pagador
  const meta = pagamento.metadata || {};
  const email = String(meta.email || (pagamento.payer && pagamento.payer.email) || pagamento.external_reference || '').trim();

  if (!emailCompradorValido(email)) {
    return responder({
      ok: false,
      erro: 'Pagamento aprovado sem e-mail válido do comprador. Use o painel (Liberar compra) para liberar manualmente.',
    }, 422);
  }

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const r = await processarAprovado({ base, svc: env.SUPABASE_SERVICE, env }, {
    pagamentoId: String(idPagamento),
    email,
    plano: meta.plano,
    dias: meta.dias,
    valor: pagamento.transaction_amount,
    metodo: pagamento.payment_method_id || 'pix',
  });

  if (!r.ok) return responder({ ok: false, erro: r.erro || 'Falha ao liberar.', pagamento: idPagamento }, 502);

  return responder({
    ok: true,
    liberado: true,
    email,
    conta_criada: !!r.contaCriada,
    aviso_email: !!r.avisoEmail,
    dias: r.dias === null ? 'vitalício' : r.dias + ' dias',
    pagamento: idPagamento,
  });
}

// o Mercado Pago às vezes manda GET para validar a URL
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, servico: 'webhook VL Optimizer' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
