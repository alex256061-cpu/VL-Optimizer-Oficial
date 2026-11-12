/**
 * functions/api/pix.js — cria o PIX na tela do nosso site.
 *
 * Igual ao que a referência faz ("Gerando o Pix…" no botão, QR na própria tela): usa a API de
 * Pagamentos do Mercado Pago (POST /v1/payments) com o método 'pix'. A resposta traz:
 *   point_of_interaction.transaction_data.qr_code          -> o "copia e cola"
 *   point_of_interaction.transaction_data.qr_code_base64   -> a imagem do QR
 *
 * A chave de acesso fica só aqui no servidor.
 *
 * Uso:  POST /api/pix  { "plano": "lifetime", "email": "..." }
 *       -> { id, valor, qr, qrBase64, expira }
 */

const PLANOS = {
  mensal: { dias: 30, valor: 40.0, descricao: 'VL Optimizer - Mensal (30 dias)' },
  vitalicio: { dias: null, valor: 99.0, descricao: 'VL Optimizer - Vitalicio' },
  monthly: { dias: 30, valor: 40.0, descricao: 'VL Optimizer - Mensal (30 dias)' },
  lifetime: { dias: null, valor: 99.0, descricao: 'VL Optimizer - Vitalicio' },
  // plano de teste: R$ 0,01, para conferir o fluxo sem pagar valor cheio
  teste: { dias: 1, valor: 0.01, descricao: 'VL Optimizer - Teste' },
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const responder = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: cors });

export async function onRequestPost({ request, env }) {
  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return responder({ erro: 'Corpo inválido.' }, 400);
  }

  const chavePlano = String(corpo.plano || '').toLowerCase();
  const plano = PLANOS[chavePlano];
  if (!plano) return responder({ erro: 'Plano desconhecido.' }, 400);

  if (!env.MP_ACCESS_TOKEN) {
    return responder({ erro: 'Pagamento ainda não configurado. Fale no Discord.' }, 503);
  }

  const email = String(corpo.email || '').trim();
  const site = (env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/$/, '');

  // O Mercado Pago exige um e-mail do pagador para criar o PIX.
  // Sem e-mail informado, usamos um genérico que o webhook troca depois.
  const emailPagador = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : 'comprador@vl-optimizer.com';

  const pagamento = {
    transaction_amount: plano.valor,
    description: plano.descricao,
    payment_method_id: 'pix',
    payer: { email: emailPagador },
    external_reference: email || 'sem-email',
    notification_url: site + '/api/webhook',
    metadata: { plano: chavePlano, email, dias: plano.dias },
  };

  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'vl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
      },
      body: JSON.stringify(pagamento),
    });

    const dados = await r.json();

    if (!r.ok) {
      return responder({ erro: 'Não foi possível gerar o PIX.', detalhe: dados }, 502);
    }

    const tx = (dados.point_of_interaction && dados.point_of_interaction.transaction_data) || {};

    return responder({
      id: dados.id,
      valor: plano.valor,
      qr: tx.qr_code || '',                       // copia e cola
      qrBase64: tx.qr_code_base64 || '',          // imagem pronta
      expira: dados.date_of_expiration || null,
      plano: chavePlano,
    });
  } catch (e) {
    return responder({ erro: 'Falha de conexão com o Mercado Pago.' }, 502);
  }
}

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
