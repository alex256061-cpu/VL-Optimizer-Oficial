/**
 * cron-vencimentos.js — chamada automática diária para os avisos de vencimento.
 *
 * GET/POST /api/cron-vencimentos   com header  x-cron-key: <CRON_KEY>
 *   (ou token de administrador no Authorization)
 *
 * O Cloudflare Pages não tem agendador próprio, então quem chama é o GitHub Actions
 * (.github/workflows/avisos-vencimento.yml) ou um cron externo. O CRON_KEY é um
 * segredo configurado na Cloudflare (env) e no repositório (secret).
 */

import { exigirAdmin, responder, metodoPermitido } from './_admin.js';
import { rodarLembretes, emailConfigurado } from './_email.js';

export async function onRequest(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET', 'POST', 'HEAD']);
  if (bloqueio) return bloqueio;

  const chaveEnv = String(env.CRON_KEY || '').trim();
  const chave = String(request.headers.get('x-cron-key') || new URL(request.url).searchParams.get('chave') || '').trim();

  let autorizado = false;
  if (chaveEnv && chave && chave === chaveEnv) {
    autorizado = true;
  } else {
    // também aceita administrador logado (botão "Enviar lembretes agora")
    const admin = await exigirAdmin(request, env);
    autorizado = !!admin.ok;
  }

  if (!autorizado) {
    return responder({ ok: false, erro: 'Não autorizado.' }, 401);
  }

  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const svc = String(env.SUPABASE_SERVICE || '');
  if (!base || !svc) return responder({ ok: false, erro: 'Banco não configurado.' }, 500);

  const conf = emailConfigurado(env);
  if (!conf.ok) {
    return responder({ ok: false, erro: 'E-mail não configurado.', precisa: conf.precisa }, 503);
  }

  const r = await rodarLembretes(base, svc, env);
  return responder(r.ok ? r : Object.assign({ ok: false }, r), r.ok ? 200 : 502);
}
