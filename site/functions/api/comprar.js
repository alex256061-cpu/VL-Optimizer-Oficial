/**
 * functions/api/comprar.js — DESATIVADO (v1.4.81).
 *
 * Era o checkout antigo, por preferência de pagamento do Mercado Pago. Hoje o site
 * usa /api/pix (PIX na própria tela, com a compra vinculada à conta logada).
 *
 * Por que desativar: o endpoint antigo criava preferências de pagamento SEM sessão,
 * sem limite de uso e com CORS aberto ("*"). Qualquer script podia gerar preferências
 * em massa na conta do Mercado Pago. Nenhuma página do site usava este caminho mais.
 *
 * Fica respondendo 410 (Gone) para deixar claro que foi removido de propósito.
 */

const resposta = (status) =>
  new Response(
    JSON.stringify({
      ok: false,
      erro: 'Este endpoint foi desativado. Use o checkout de PIX no site.',
    }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );

export async function onRequestPost() { return resposta(410); }
export async function onRequestGet() { return resposta(410); }
export async function onRequestOptions() { return new Response(null, { status: 204 }); }
