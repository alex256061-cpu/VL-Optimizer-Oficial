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

import { limite, ipDe } from './_limite.js';

const PLANOS = {
  mensal: { dias: 30, valor: 40.0, descricao: 'VL Optimizer - Mensal (30 dias)' },
  vitalicio: { dias: null, valor: 99.0, descricao: 'VL Optimizer - Vitalicio' },
  monthly: { dias: 30, valor: 40.0, descricao: 'VL Optimizer - Mensal (30 dias)' },
  lifetime: { dias: null, valor: 99.0, descricao: 'VL Optimizer - Vitalicio' },
};

// CORS restrito: só o próprio site cria pagamentos. Aberto para "*", qualquer página poderia
// gerar PIX em nome do cliente. A origem vem de SITE_URL.
function corsDe(env) {
  const origem = (env && env.SITE_URL) ? env.SITE_URL.replace(/\/$/, '') : 'https://vl-optimizer.pages.dev';
  return {
    'Access-Control-Allow-Origin': origem,
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

// O responder precisa do env para montar o cabeçalho CORS com a origem certa.
function responder(env, obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsDe(env) });
}

export async function onRequestPost({ request, env }) {
  // Limite por IP: no máximo 8 PIX criados por 10 minutos. Sem isso, um script pode
  // gerar pagamentos em massa — o Mercado Pago bloqueia a conta por abuso.
  const bloqueio = limite('pix:' + ipDe(request), 8, 10 * 60 * 1000);
  if (bloqueio) {
    return responder(env, { erro: bloqueio.erro, espere: bloqueio.restante }, 429);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return responder(env, { erro: 'Corpo inválido.' }, 400);
  }

  const chavePlano = String(corpo.plano || '').toLowerCase();
  const plano = PLANOS[chavePlano];
  if (!plano) return responder(env, { erro: 'Plano desconhecido.' }, 400);

  if (!env.MP_ACCESS_TOKEN) {
    return responder(env, { erro: 'Pagamento ainda não configurado. Fale no Discord.' }, 503);
  }

  const email = String(corpo.email || '').trim().slice(0, 120);

  // O e-mail é usado para liberar o plano depois do pagamento: se vier malformado,
  // o cliente paga e não recebe. Recusamos antes de criar o PIX.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return responder(env, { erro: 'E-mail inválido.' }, 400);
  }
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
      // O detalhe do Mercado Pago pode trazer dados internos: fica no log da Function,
      // não na resposta para o navegador do cliente.
      console.error('MP pix falhou:', JSON.stringify(dados).slice(0, 500));
      return responder(env, { erro: 'Não foi possível gerar o PIX. Tente de novo ou fale no Discord.' }, 502);
    }

    const tx = (dados.point_of_interaction && dados.point_of_interaction.transaction_data) || {};

    return responder(env, {
      id: dados.id,
      valor: plano.valor,
      qr: tx.qr_code || '',                       // copia e cola
      qrBase64: tx.qr_code_base64 || '',          // imagem pronta
      expira: dados.date_of_expiration || null,
      plano: chavePlano,
    });
  } catch (e) {
    return responder(env, { erro: 'Falha de conexão com o Mercado Pago.' }, 502);
  }
}

export async function onRequestOptions({ env }) {
  const o = corsDe(env);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': o['Access-Control-Allow-Origin'],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
