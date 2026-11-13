/**
 * functions/api/comprar.js — cria o pagamento no Mercado Pago.
 *
 * Por que um servidor: a chave de acesso do Mercado Pago não pode ficar no navegador. Quem
 * chama a API do MP é esta Function, no servidor da Cloudflare; o navegador só recebe o link
 * de pagamento pronto.
 *
 * Roda no plano gratuito da Cloudflare Pages (Functions incluídas).
 *
 * Variáveis de ambiente (Cloudflare Pages → Settings → Environment variables):
 *   MP_ACCESS_TOKEN   token de produção ou de teste do Mercado Pago
 *   SITE_URL          https://vl-optimizer.pages.dev
 *   SUPABASE_URL      https://wsmropvlmnyegpvmyndn.supabase.co
 *   SUPABASE_SERVICE  chave service_role (para gravar o pagamento; NUNCA no navegador)
 *
 * Uso no site:
 *   POST /api/comprar  { "plano": "monthly" | "lifetime", "email": "..." }
 *   resposta: { "url": "https://www.mercadopago.com.br/checkout/...", "id": "..." }
 */

const PLANOS = {
  mensal: { dias: 30, valor: 40.0, titulo: 'VL Optimizer — Mensal (30 dias)' },
  vitalicio: { dias: null, valor: 99.0, titulo: 'VL Optimizer — Vitalício' },
  // apelidos em inglês, usados pelo data-buy do site
  monthly: { dias: 30, valor: 40.0, titulo: 'VL Optimizer — Mensal (30 dias)' },
  lifetime: { dias: null, valor: 99.0, titulo: 'VL Optimizer — Vitalício' },
};

export async function onRequestPost({ request, env }) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ erro: 'Corpo inválido.' }), { status: 400, headers: cors });
  }

  const plano = PLANOS[String(corpo.plano || '').toLowerCase()];
  if (!plano) {
    return new Response(JSON.stringify({ erro: 'Plano desconhecido.' }), { status: 400, headers: cors });
  }

  const email = String(corpo.email || '').trim().slice(0, 120);

  // O e-mail define para quem o plano é liberado. Malformado = cliente paga e não recebe.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return new Response(JSON.stringify({ erro: 'E-mail inválido.' }), { status: 400, headers: cors });
  }

  const site = (env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/$/, '');

  if (!env.MP_ACCESS_TOKEN) {
    return new Response(
      JSON.stringify({ erro: 'Pagamento ainda não configurado. Fale no Discord.' }),
      { status: 503, headers: cors }
    );
  }

  // link de retorno: depois de pagar, volta para a conta
  const volta = site + '/conta?pago=1';

  const preferencia = {
    items: [
      {
        title: plano.titulo,
        quantity: 1,
        unit_price: plano.valor,
        currency_id: 'BRL',
      },
    ],
    payer: email ? { email } : undefined,
    back_urls: { success: volta, pending: volta, failure: site + '/#precos' },
    auto_return: 'approved',
    // o webhook recebe o id do pagamento e libera o plano
    notification_url: site + '/api/webhook',
    // guarda plano e e-mail para o webhook saber o que liberar
    metadata: { plano: String(corpo.plano).toLowerCase(), email, dias: plano.dias },
    statement_descriptor: 'VL OPTIMIZER',
    payment_methods: {
      // PIX e cartão de crédito (até 12x), como no site da referência
      excluded_payment_types: [{ id: 'ticket' }],
      installments: 12,
    },
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferencia),
    });

    const dados = await r.json();

    if (!r.ok) {
      return new Response(
        JSON.stringify({ erro: 'Não foi possível criar o pagamento.', detalhe: dados }),
        { status: 502, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({
        url: dados.init_point,          // checkout em produção
        sandbox: dados.sandbox_init_point,
        id: dados.id,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ erro: 'Falha de conexão com o Mercado Pago.' }),
      { status: 502, headers: cors }
    );
  }
}

// pré-voo do navegador
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
