/**
 * recuperar-por-chave.js — "esqueci meu e-mail, só tenho a chave".
 *
 * POST /api/recuperar-por-chave   { "codigo": "VL-XXXX-XXXX-XXXX", "acao": "buscar" | "enviar" }
 *
 * A chave serve APENAS para localizar a conta: aqui mostramos o e-mail mascarado
 * (m***a@gmail.com) e, se a pessoa pedir, disparamos o link de redefinição de senha
 * para o e-mail cadastrado. Sem acesso à caixa de e-mail ninguém entra — a chave
 * sozinha não vira login (evita que uma chave vazada/repassada tome a conta).
 *
 * Proteções: valida formato, limite por IP, limite por chave e não revela o e-mail
 * completo em nenhuma resposta.
 */

import { responder, metodoPermitido, lerCorpo, cabecalhosServico } from './_admin.js';
import { emailConfigurado, enviar, montarEmailRecuperacao } from './_email.js';
import { limite, ipDe } from './_limite.js';

const CODIGO_RE = /^VL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const normalizar = (v) =>
  String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();

function mascarar(email) {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const local = e.slice(0, at);
  const dominio = e.slice(at);
  if (local.length <= 2) return local[0] + '***' + dominio;
  return local[0] + '***' + local[local.length - 1] + dominio;
}

const dataBR = (iso) => {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return '—'; }
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['POST']);
  if (bloqueio) return bloqueio;

  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const svc = String(env.SUPABASE_SERVICE || '');
  if (!base || !svc) return responder({ ok: false, erro: 'Banco não configurado.' }, 500);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const acao = String(corpo.acao || 'buscar').trim().toLowerCase();
  if (!['buscar', 'enviar'].includes(acao)) return responder({ ok: false, erro: 'Ação inválida.' }, 400);

  const codigo = normalizar(corpo.codigo);
  if (!CODIGO_RE.test(codigo)) {
    return responder({ ok: false, erro: 'Código inválido. O formato é VL-XXXX-XXXX-XXXX.' }, 400);
  }

  // limites: busca 10/10min por IP; envio 4/10min por IP e 2/10min por chave
  const ip = ipDe(request);
  const b1 = limite('recup-b:' + ip, 10, 10 * 60 * 1000);
  if (b1) return responder({ ok: false, erro: b1.erro }, 429);
  if (acao === 'enviar') {
    const b2 = limite('recup-e:' + ip, 4, 10 * 60 * 1000);
    if (b2) return responder({ ok: false, erro: b2.erro }, 429);
    const b3 = limite('recup-e:' + codigo, 2, 10 * 60 * 1000);
    if (b3) return responder({ ok: false, erro: 'Já pedimos o link para esta chave agora. Aguarde alguns minutos.' }, 429);
  }

  // 1) acha a chave e o dono
  let chave = null;
  try {
    const r = await fetch(
      base + '/rest/v1/chaves?codigo=eq.' + encodeURIComponent(codigo) + '&select=codigo,plano,dias,usado_por,usado_em,cancelada&limit=1',
      { headers: cabecalhosServico(svc) }
    );
    const lista = r.ok ? await r.json() : [];
    chave = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui consultar agora. Tente de novo.' }, 502);
  }
  if (!chave || chave.cancelada || !chave.usado_por) {
    return responder({ ok: false, erro: 'Não encontrei uma conta com essa chave. Confira o código ou fale com o suporte no Discord.' }, 404);
  }

  // 2) perfil do dono
  let perfil = null;
  try {
    const r = await fetch(
      base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(chave.usado_por) + '&select=id,email,name,plan,lifetime,license_expires_at&limit=1',
      { headers: cabecalhosServico(svc) }
    );
    const lista = r.ok ? await r.json() : [];
    perfil = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui consultar agora. Tente de novo.' }, 502);
  }
  if (!perfil || !perfil.email) {
    return responder({ ok: false, erro: 'Não encontrei o e-mail desta conta. Fale com o suporte no Discord.' }, 404);
  }

  const mascarado = mascarar(perfil.email);

  if (acao === 'buscar') {
    return responder({
      ok: true,
      email_mascarado: mascarado,
      nome: perfil.name || null,
      plano: perfil.lifetime ? 'vitalicio' : (perfil.plan === 'pro' ? 'pro' : 'free'),
      vence_em: perfil.lifetime ? null : perfil.license_expires_at,
      pode_enviar: true,
    });
  }

  // 3) envia o link de redefinição para o e-mail cadastrado (nunca para outro endereço)
  //    Com Brevo/Resend configurado, geramos o link e mandamos o nosso e-mail.
  //    Sem provedor, usamos o e-mail padrão do Supabase Auth (recover).
  const site = String(env.SITE_URL || 'https://vl-optimizer.pages.dev').replace(/\/+$/, '');
  const conf = emailConfigurado(env);
  let enviado = false;

  if (conf.ok) {
    try {
      const rg = await fetch(base + '/auth/v1/admin/generate_link', {
        method: 'POST',
        headers: cabecalhosServico(svc),
        body: JSON.stringify({ type: 'recovery', email: perfil.email, options: { redirect_to: site + '/redefinir' } }),
      });
      const gerado = rg.ok ? await rg.json() : null;
      const link = gerado && gerado.action_link;
      if (link) {
        const mail = montarEmailRecuperacao(link, perfil.name, env);
        const r = await enviar(env, perfil.email, mail.assunto, mail.html, mail.texto);
        enviado = !!r.ok;
        if (!r.ok) console.error('envio do link (provedor) falhou:', r.erro);
      } else if (!rg.ok) {
        console.error('generate_link falhou:', rg.status, (await rg.text()).slice(0, 200));
      }
    } catch (e) {
      console.error('caminho do provedor falhou:', e && e.message);
    }
  }

  if (!enviado) {
    try {
      const r = await fetch(base + '/auth/v1/recover', {
        method: 'POST',
        headers: { apikey: svc, Authorization: 'Bearer ' + svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: perfil.email, redirect_to: site + '/redefinir' }),
      });
      enviado = r.ok;
      if (!r.ok) {
        const txt = await r.text();
        console.error('recover falhou:', r.status, txt.slice(0, 200));
      }
    } catch (e) {
      enviado = false;
    }
  }

  if (!enviado) {
    return responder({ ok: false, erro: 'Não consegui enviar o link agora. Tente de novo em alguns minutos ou fale com o suporte no Discord.' }, 502);
  }

  return responder({
    ok: true,
    enviado: true,
    email_mascarado: mascarado,
    vence_em: perfil.lifetime ? null : dataBR(perfil.license_expires_at),
    mensagem: 'Enviamos um link de redefinição para ' + mascarado + '. Confira a caixa de entrada e o spam.',
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use POST.' }, 405);
}
