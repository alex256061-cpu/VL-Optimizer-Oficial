import { limite, ipDe } from './_limite.js';

/**
 * functions/api/pix-status.js — verifica se o PIX foi pago e libera o plano.
 *
 * O site fica perguntando de 3 em 3 segundos. Quando o Mercado Pago diz que o pagamento
 * está aprovado, esta função libera o plano no Supabase e devolve liberado: true.
 *
 * É a mesma ideia do webhook, mas puxada pela tela: funciona mesmo se o webhook atrasar, e
 * o cliente não precisa atualizar a página para ver o acesso liberado.
 *
 * Uso:  GET /api/pix-status?id=123456
 *       -> { status: 'approved' | 'pending' | ..., liberado: true|false }
 */

export async function onRequestGet({ request, env }) {
  // A tela verifica a cada 3s; 200 por 10 min cobre várias abas sem permitir varredura
  // de ids de pagamento.
  const bloqueio = limite('status:' + ipDe(request), 200, 10 * 60 * 1000);
  if (bloqueio) {
    return new Response(JSON.stringify({ erro: bloqueio.erro }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const responder = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d+$/.test(String(id))) return responder({ erro: 'Id inválido.' }, 400);

  if (!env.MP_ACCESS_TOKEN) return responder({ erro: 'Pagamento não configurado.' }, 503);

  // 1. consultar o pagamento no Mercado Pago
  let pag;
  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
      headers: { Authorization: 'Bearer ' + env.MP_ACCESS_TOKEN },
    });
    pag = await r.json();
    if (!r.ok) return responder({ erro: 'Pagamento não encontrado.' }, 404);
  } catch (e) {
    return responder({ erro: 'Falha ao consultar o Mercado Pago.' }, 502);
  }

  const status = pag.status || 'pending';

  if (status !== 'approved') {
    return responder({ status, liberado: false });
  }

  // 2. já liberado? evita liberar duas vezes (o webhook pode ter chegado antes)
  const meta = pag.metadata || {};
  const email = meta.email || pag.external_reference || '';
  if (!email || email === 'sem-email') {
    return responder({ status, liberado: false, erro: 'Pagamento sem e-mail do comprador.' });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE) {
    return responder({ status, liberado: false, erro: 'Banco não configurado.' });
  }

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const emailLimpo = String(email).trim();

  // 3. ler o plano atual do perfil
  let jaOk = false;
  try {
    const r = await fetch(
      base + '/rest/v1/profiles?select=plan,lifetime,license_expires_at&email=eq.' + encodeURIComponent(emailLimpo),
      {
        headers: {
          apikey: env.SUPABASE_SERVICE,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE,
          'Content-Type': 'application/json',
        },
      }
    );
    const lista = await r.json();
    const p = Array.isArray(lista) && lista[0];
    if (p && p.plan === 'pro') jaOk = true;
  } catch (e) { }

  if (jaOk) {
    return responder({ status, liberado: true, email: emailLimpo });
  }

  // 4. liberar
  const dias = meta.dias === undefined ? null : meta.dias;
  try {
    const r = await fetch(base + '/rest/v1/rpc/liberar_plano', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_alvo: emailLimpo,
        dias: dias === null || dias === undefined ? null : Number(dias),
        recursos: ['*'],
        pcs: 1,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return responder({ status, liberado: false, erro: 'Falha ao liberar: ' + t.slice(0, 120) });
    }

    // 3.1 gravar a venda para o painel (falha aqui não impede a liberação)
    let valorVenda = 0;
    let planoVenda = 'mensal';
    try {
      valorVenda = Number(pag.transaction_amount || 0);
      planoVenda = pag.metadata && pag.metadata.plano ? String(pag.metadata.plano) : (dias ? 'mensal' : 'vitalicio');
      await fetch(base + '/rest/v1/rpc/registrar_venda', {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE,
          Authorization: 'Bearer ' + env.SUPABASE_SERVICE,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_pagamento: String(pag.id || id),
          p_email: emailLimpo,
          p_plano: planoVenda,
          p_valor: valorVenda,
          p_dias: dias === null || dias === undefined ? null : Number(dias),
          p_metodo: pag.payment_method_id || 'pix',
        }),
      });
    } catch (e) { }

    return responder({
      status,
      liberado: true,
      email: emailLimpo,
      dias: dias === null || dias === undefined ? 'vitalício' : Number(dias) + ' dias',
      venda: valorVenda,
    });
  } catch (e) {
    return responder({ status, liberado: false, erro: 'Falha de conexão com o banco.' }, 502);
  }
}
