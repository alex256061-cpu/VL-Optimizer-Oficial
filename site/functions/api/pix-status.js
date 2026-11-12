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

    return responder({
      status,
      liberado: true,
      email: emailLimpo,
      dias: dias === null || dias === undefined ? 'vitalício' : Number(dias) + ' dias',
    });
  } catch (e) {
    return responder({ status, liberado: false, erro: 'Falha de conexão com o banco.' }, 502);
  }
}
