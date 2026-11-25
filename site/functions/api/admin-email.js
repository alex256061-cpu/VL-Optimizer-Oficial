/**
 * admin-email.js — avisos de vencimento por e-mail.
 *
 * GET  /api/admin-email
 *   -> { ok, configurado, provedor, remetente, precisa, vencendo: [...], avisos: [...] }
 *
 * POST /api/admin-email
 *   { acao: "preview", modelo: "vence7" | "vence1" | "boasvindas" }
 *       -> assunto/html/texto (não envia nada; serve para o painel mostrar a prévia)
 *   { acao: "teste", email: "voce@email.com", modelo: "vence7" }
 *       -> envia um e-mail de teste para você (usa dados de exemplo)
 *   { acao: "enviar", email: "cliente@..." }
 *       -> envia o lembrete de vencimento para um cliente específico
 *   { acao: "lembretes" }
 *       -> roda a varredura de 7 dias e envia para todos os vencendo (com dedupe diário)
 *
 * Só administrador. Sem provedor configurado, devolve 503 com o que falta configurar.
 */

import { exigirAdmin, responder, metodoPermitido, lerCorpo, cabecalhosServico, registrarAuditoria } from './_admin.js';
import { montarEmail, enviar, emailConfigurado, rodarLembretes, listarAvisosRecentes } from './_email.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

async function perfisVencendo(base, svc) {
  try {
    const agora = Date.now();
    const limite = new Date(agora + 8 * 86400000).toISOString();
    const r = await fetch(
      base + '/rest/v1/profiles?select=id,email,name,plan,lifetime,license_expires_at' +
        '&plan=eq.pro&lifetime=eq.false&license_expires_at=not.is.null' +
        '&license_expires_at=gt.' + encodeURIComponent(new Date(agora).toISOString()) +
        '&license_expires_at=lt.' + encodeURIComponent(limite) +
        '&order=license_expires_at.asc&limit=200',
      { headers: cabecalhosServico(svc) }
    );
    if (!r.ok) return [];
    const lista = await r.json();
    if (!Array.isArray(lista)) return [];
    return lista.map((p) => ({
      email: p.email,
      nome: p.name,
      expira: p.license_expires_at,
      dias: Math.max(0, Math.ceil((new Date(p.license_expires_at).getTime() - agora) / 86400000)),
    }));
  } catch (e) {
    return [];
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const conf = emailConfigurado(env);
  const vencendo = await perfisVencendo(admin.base, admin.svc);
  let avisos = [];
  try { avisos = await listarAvisosRecentes(admin.base, admin.svc, 20); } catch (e) { avisos = []; }

  return responder({
    ok: true,
    configurado: conf.ok,
    provedor: conf.provedor,
    remetente: conf.remetente || null,
    precisa: conf.ok ? [] : conf.precisa,
    vencendo,
    avisos: avisos.map((a) => ({ email: a.email, modelo: a.modelo, enviado_em: a.enviado_em })).slice(0, 20),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const acao = String(corpo.acao || 'status').trim().toLowerCase();
  const { base, svc } = admin;

  if (acao === 'preview' || acao === 'modelos') {
    const modelo = String(corpo.modelo || 'vence7');
    const exemplo = {
      email: 'cliente@exemplo.com',
      name: 'Cliente Exemplo',
      license_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      plan: 'pro',
    };
    const mail = montarEmail(modelo, exemplo, env);
    return responder({ ok: true, modelo: mail.modelo, assunto: mail.assunto, html: mail.html, texto: mail.texto });
  }

  const conf = emailConfigurado(env);
  if (!conf.ok) {
    return responder({ ok: false, erro: 'E-mail não configurado. Falta: ' + conf.precisa.join(', ') + '.', precisa: conf.precisa }, 503);
  }

  if (acao === 'lembretes') {
    const r = await rodarLembretes(base, svc, env);
    await registrarAuditoria(base, svc, admin.perfil, 'email_lembretes', null, 'enviados=' + (r.enviados || 0) + ' pulados=' + (r.pulados || 0));
    return responder(r.ok ? r : Object.assign({ ok: false }, r), r.ok ? 200 : 502);
  }

  if (acao === 'teste' || acao === 'enviar') {
    const para = String(corpo.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(para)) return responder({ ok: false, erro: 'E-mail de destino inválido.' }, 400);

    let perfil = null;
    if (acao === 'enviar') {
      try {
        const r = await fetch(base + '/rest/v1/profiles?email=eq.' + encodeURIComponent(para) + '&select=id,email,name,plan,lifetime,license_expires_at&limit=1', {
          headers: cabecalhosServico(svc),
        });
        const lista = r.ok ? await r.json() : [];
        perfil = Array.isArray(lista) && lista.length ? lista[0] : null;
        if (!perfil) return responder({ ok: false, erro: 'Nenhuma conta com este e-mail.' }, 404);
      } catch (e) {
        return responder({ ok: false, erro: 'Não consegui ler a conta agora.' }, 502);
      }
    } else {
      perfil = {
        email: para,
        name: 'Teste',
        plan: 'pro',
        license_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    }

    const mail = montarEmail(acao === 'teste' ? String(corpo.modelo || 'vence7') : 'vence7', perfil, env);
    const envio = await enviar(env, para, mail.assunto, mail.html, mail.texto);
    if (!envio.ok) return responder({ ok: false, erro: envio.erro }, 502);
    await registrarAuditoria(base, svc, admin.perfil, acao === 'teste' ? 'email_teste' : 'email_manual', para, mail.assunto);
    return responder({ ok: true, enviado: true, para, assunto: mail.assunto, provedor: envio.provedor });
  }

  return responder({ ok: false, erro: 'Ação desconhecida.' }, 400);
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use GET ou POST.' }, 405);
}
