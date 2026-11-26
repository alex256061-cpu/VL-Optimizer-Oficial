/**
 * _venda.js — libera uma compra aprovada, com ou sem conta existente.
 *
 * Problema que isso resolve: antes, o webhook/pix-status chamava liberar_plano()
 * e, se o comprador NÃO tivesse conta (ou o e-mail viesse vazio), a função devolvia
 * "usuario nao encontrado" e o pagamento era aprovado sem liberar nada.
 *
 * Agora:
 *   1. exige e-mail válido
 *   2. grava/corrige a venda no painel
 *   3. se a conta não existe, cria a conta (senha aleatória, e-mail confirmado)
 *   4. libera o plano
 *   5. manda e-mail "crie sua senha" para o comprador (quando o provedor está configurado)
 *   6. registra tudo na auditoria
 */

import { cabecalhosServico, authAdmin, registrarAuditoria } from './_admin.js';
import { emailConfigurado, enviar, montarEmailRecuperacao } from './_email.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function emailCompradorValido(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  // Mercado Pago mascara o pagador de PIX anônimo como "XXXXXXXXXXX"
  if (/^x{5,}$/i.test(e)) return false;
  if (e === 'sem-email') return false;
  return true;
}

function diasDoPlano(plano, dias) {
  const p = String(plano || '').toLowerCase();
  if (/vital|lifetime/.test(p)) return null;
  if (/mensal|monthly/.test(p)) return 30;
  const n = Number(dias);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function acharUsuarioPorEmail(base, svc, email) {
  try {
    for (let page = 1; page <= 10; page++) {
      const r = await fetch(base + '/auth/v1/admin/users?page=' + page + '&per_page=200', {
        headers: cabecalhosServico(svc),
      });
      if (!r.ok) return null;
      const j = await r.json();
      const lista = Array.isArray(j.users) ? j.users : [];
      const achou = lista.find((u) => String(u.email || '').toLowerCase() === email);
      if (achou) return achou;
      if (lista.length < 200) return null;
    }
  } catch (e) { }
  return null;
}

/**
 * @returns {Promise<{ok:boolean, erro?:string, email?:string, plano?:string, dias?:number|null,
 *                    contaCriada?:boolean, avisoEmail?:boolean, jaEraPro?:boolean}>}
 */
export async function processarAprovado({ base, svc, env }, dados) {
  const email = String(dados && dados.email || '').trim().toLowerCase();
  if (!emailCompradorValido(email)) {
    return { ok: false, erro: 'E-mail do comprador inválido. Sem ele não dá para liberar a compra.' };
  }
  const pagamentoId = String(dados.pagamentoId || '');
  const plano = /vital|lifetime/i.test(String(dados.plano || '')) ? 'vitalicio' : 'mensal';
  const dias = diasDoPlano(dados.plano, dados.dias);
  const valor = Number(dados.valor || 0);
  const metodo = String(dados.metodo || 'pix');
  const cab = cabecalhosServico(svc);

  // 1) grava a venda (idempotente no pagamento_id) e corrige o e-mail se já existia
  if (pagamentoId) {
    try {
      await fetch(base + '/rest/v1/rpc/registrar_venda', {
        method: 'POST',
        headers: cab,
        body: JSON.stringify({ p_pagamento: pagamentoId, p_email: email, p_plano: plano, p_valor: valor, p_dias: dias, p_metodo: metodo }),
      });
      await fetch(base + '/rest/v1/vendas?pagamento_id=eq.' + encodeURIComponent(pagamentoId), {
        method: 'PATCH',
        headers: cab,
        body: JSON.stringify({ email, plano, valor, dias, metodo }),
      });
    } catch (e) { }
  }

  // 2) conta existe?
  let userId = null;
  let contaCriada = false;
  let jaEraPro = false;
  try {
    const rp = await fetch(base + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email) + '&select=id,email,plan,lifetime', { headers: cab });
    const lista = rp.ok ? await rp.json() : [];
    if (Array.isArray(lista) && lista.length) {
      userId = lista[0].id;
      jaEraPro = lista[0].plan === 'pro';
    }
  } catch (e) { }

  if (userId && jaEraPro) {
    // já liberado antes (webhook + pix-status podem chegar os dois): não manda e-mail de novo
    return { ok: true, email, plano, dias, contaCriada: false, avisoEmail: false, jaEraPro: true };
  }

  if (!userId) {
    // 3) cria a conta (e-mail confirmado) — o trigger handle_new_user cria o profile
    const senha = 'VL' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + '!9A';
    let criou = false;
    try {
      const r = await authAdmin(base, svc, 'POST', 'users', {
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { origem: 'compra-vl' },
      });
      if (r.ok) {
        const u = await r.json();
        userId = u.id;
        contaCriada = true;
        criou = true;
      }
    } catch (e) { }

    if (!criou) {
      // conta já existia (e-mail duplicado) — procura o id
      const u = await acharUsuarioPorEmail(base, svc, email);
      if (u) userId = u.id;
    }
    if (!userId) return { ok: false, erro: 'Não consegui criar/localizar a conta deste e-mail.' };

    // garante o profile (se o trigger não tiver rodado por algum motivo)
    try {
      const rp = await fetch(base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(userId) + '&select=id', { headers: cab });
      const lista = rp.ok ? await rp.json() : [];
      if (!Array.isArray(lista) || !lista.length) {
        await fetch(base + '/rest/v1/profiles', {
          method: 'POST',
          headers: { ...cab, Prefer: 'resolution=ignore-duplicates' },
          body: JSON.stringify({ id: userId, email, name: email.split('@')[0] }),
        });
      }
    } catch (e) { }
  }

  // 4) libera o plano
  let liberou = false;
  try {
    const r = await fetch(base + '/rest/v1/rpc/liberar_plano', {
      method: 'POST',
      headers: cab,
      body: JSON.stringify({ email_alvo: email, dias, recursos: ['*'], pcs: 1 }),
    });
    const texto = r.ok ? await r.text() : '';
    if (r.ok && !/nao encontrado/i.test(texto)) liberou = true;
    else return { ok: false, erro: 'O banco não liberou o plano: ' + String(texto).slice(0, 120) };
  } catch (e) {
    return { ok: false, erro: 'Falha de conexão com o banco.' };
  }

  // 5) conta nova -> manda e-mail para criar a senha
  let avisoEmail = false;
  if (contaCriada && emailConfigurado(env).ok) {
    try {
      const site = String(env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/+$/, '');
      const rg = await fetch(base + '/auth/v1/admin/generate_link', {
        method: 'POST',
        headers: cab,
        body: JSON.stringify({ type: 'recovery', email, options: { redirect_to: site + '/redefinir' } }),
      });
      const gerado = rg.ok ? await rg.json() : null;
      const link = gerado && gerado.action_link;
      if (link) {
        const mail = montarEmailRecuperacao(link, email.split('@')[0], env);
        const envio = await enviar(env, email, mail.assunto, mail.html, mail.texto);
        avisoEmail = !!envio.ok;
      }
    } catch (e) { }
  }

  // 6) auditoria
  try {
    const tarefa = registrarAuditoria(base, svc, { id: 'sistema', email: 'sistema@venda' },
      contaCriada ? 'compra_conta_criada' : 'compra_liberada', email,
      'pag=' + pagamentoId + ' plano=' + plano + ' valor=' + valor + (avisoEmail ? ' aviso_email=ok' : ''));
    // sem context aqui: best-effort
    await tarefa;
  } catch (e) { }

  return { ok: !!liberou, email, plano, dias, contaCriada, avisoEmail };
}
