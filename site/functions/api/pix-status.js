import { limite, ipDe } from './_limite.js';
import { processarAprovado, emailCompradorValido } from './_venda.js';

/**
 * functions/api/pix-status.js — verifica se o PIX foi pago e libera o plano.
 *
 * A tela pergunta de 3 em 3 segundos. Quando o Mercado Pago diz que está aprovado,
 * chamamos processarAprovado(), que:
 *   - grava a venda
 *   - se o comprador não tem conta, cria a conta com o e-mail informado
 *   - libera o plano
 *   - manda o e-mail "crie sua senha" (quando o provedor está configurado)
 *
 * Uso: GET /api/pix-status?id=123456
 *   -> { status, liberado: true|false, email?, conta_criada?, aviso_email? }
 */

export async function onRequestGet({ request, env }) {
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
  if (status !== 'approved') return responder({ status, liberado: false });

  const meta = pag.metadata || {};
  const email = String(meta.email || pag.external_reference || '').trim();

  // 2. sem e-mail válido não tem como liberar (pagador anônimo do PIX)
  if (!emailCompradorValido(email)) {
    return responder({
      status,
      liberado: false,
      erro: 'Este pagamento foi feito sem um e-mail válido. Fale com o suporte no Discord para liberar a compra.',
    });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE) {
    return responder({ status, liberado: false, erro: 'Banco não configurado.' }, 503);
  }
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const svc = env.SUPABASE_SERVICE;

  // 3. já está liberado? (webhook pode ter chegado antes) — evita e-mail repetido
  try {
    const r = await fetch(
      base + '/rest/v1/profiles?select=plan&email=eq.' + encodeURIComponent(email),
      { headers: { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' } }
    );
    const lista = r.ok ? await r.json() : [];
    if (Array.isArray(lista) && lista[0] && lista[0].plan === 'pro') {
      return responder({ status, liberado: true, email, conta_criada: false });
    }
  } catch (e) { }

  // 4. libera (cria conta se precisar) e grava a venda
  const r = await processarAprovado({ base, svc, env }, {
    pagamentoId: String(id),
    email,
    plano: meta.plano,
    dias: meta.dias,
    valor: pag.transaction_amount,
    metodo: pag.payment_method_id || 'pix',
  });

  if (!r.ok) {
    return responder({ status, liberado: false, email, erro: r.erro || 'Não consegui liberar a compra.' });
  }

  return responder({
    status,
    liberado: true,
    email,
    conta_criada: !!r.contaCriada,
    aviso_email: !!r.avisoEmail,
    dias: r.dias === null ? 'vitalício' : r.dias + ' dias',
  });
}
