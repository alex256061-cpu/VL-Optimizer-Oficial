/**
 * _email.js — modelos e envio de e-mail do VL Optimizer.
 *
 * Provedor: Brevo (300 e-mails/dia no plano grátis) ou Resend, escolhido pelas
 * variáveis de ambiente da Cloudflare:
 *   BREVO_API_KEY            + EMAIL_REMETENTE (e-mail verificado no Brevo)
 *   ou RESEND_API_KEY        + EMAIL_REMETENTE (domínio verificado no Resend)
 *   EMAIL_NOME               opcional (nome do remetente; padrão "VL Optimizer")
 *
 * Nada aqui é chamado pelo cliente direto: as Functions de admin usam estes modelos.
 */

import { storageGravar, storageLer, storageListar, garantirBucket, registrarAuditoria } from './_admin.js';

const SITE = 'https://vl-optimizer.pages.dev';
const DISCORD = 'https://discord.gg/k8F3mvxam';
const PRECO_MENSAL = 'R$ 40';
const PRECO_VITAL = 'R$ 99';

const dataBR = (iso) => {
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return '—'; }
};

export function emailConfigurado(env) {
  const remetente = String(env.EMAIL_REMETENTE || '').trim();
  // Ordem de preferência: Mailjet (6.000/mês, verifica só o e-mail remetente),
  // SendGrid (100/dia), Brevo (300/dia), Resend (3.000/mês, exige domínio).
  if (env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY && remetente) return { ok: true, provedor: 'mailjet', remetente };
  if (env.SENDGRID_API_KEY && remetente) return { ok: true, provedor: 'sendgrid', remetente };
  if (env.BREVO_API_KEY && remetente) return { ok: true, provedor: 'brevo', remetente };
  if (env.RESEND_API_KEY && remetente) return { ok: true, provedor: 'resend', remetente };
  return {
    ok: false,
    provedor: null,
    remetente,
    precisa: env.MAILJET_API_KEY || env.MAILJET_SECRET_KEY
      ? ['MAILJET_API_KEY e MAILJET_SECRET_KEY', 'EMAIL_REMETENTE']
      : ['MAILJET_API_KEY + MAILJET_SECRET_KEY (ou SENDGRID_API_KEY)', 'EMAIL_REMETENTE'],
  };
}

export function montarEmail(modelo, perfil, env) {
  const nome = String((perfil && (perfil.name || perfil.email)) || 'jogador').split('@')[0].slice(0, 40);
  const email = (perfil && perfil.email) || '';
  const expira = perfil && perfil.license_expires_at ? dataBR(perfil.license_expires_at) : '—';
  const dias = (() => {
    if (!perfil || !perfil.license_expires_at) return 7;
    const d = Math.ceil((new Date(perfil.license_expires_at).getTime() - Date.now()) / 86400000);
    return Math.max(0, d);
  })();
  const remetenteNome = String(env.EMAIL_NOME || 'VL Optimizer').trim();

  let assunto;
  let titulo;
  let linhaPrazo;
  if (modelo === 'vence1') {
    assunto = 'Último aviso: sua licença do VL Optimizer vence ' + (dias <= 0 ? 'hoje' : 'amanhã');
    titulo = 'Sua licença vence ' + (dias <= 0 ? 'hoje' : 'amanhã');
    linhaPrazo = 'Ela expira em <b>' + expira + '</b>' + (dias <= 0 ? ' (hoje).' : ' (amanhã).');
  } else if (modelo === 'boasvindas') {
    assunto = 'Bem-vindo ao VL Optimizer';
    titulo = 'Bem-vindo ao VL Optimizer';
    linhaPrazo = 'Seu acesso está ativo. Qualquer dúvida, chama no Discord.';
  } else {
    assunto = 'Sua licença do VL Optimizer vence em ' + dias + ' dia' + (dias === 1 ? '' : 's');
    titulo = 'Sua licença vence em ' + dias + ' dia' + (dias === 1 ? '' : 's');
    linhaPrazo = 'Ela expira em <b>' + expira + '</b>.';
  }

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${assunto}</title></head>
<body style="margin:0;padding:0;background:#07030a;color:#f5f2f7;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 22px">
    <div style="font-size:20px;font-weight:bold;letter-spacing:-0.3px;color:#ffffff;margin-bottom:22px">
      <span style="color:#ff1f2e">VL</span> Optimizer
    </div>
    <div style="background:#130b16;border:1px solid #2a1a30;border-radius:14px;padding:26px 24px">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ffffff">${titulo}</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#c9bfd2">Olá, ${nome}!</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#c9bfd2">${linhaPrazo}</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#c9bfd2">Para continuar com os ajustes, o medidor de FPS e o scaling, é só renovar — leva 2 minutos:</p>
      <p style="margin:0 0 8px"><a href="${SITE}/#precos" style="display:inline-block;background:#ff1f2e;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;font-size:15px">Renovar meu acesso</a></p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#8d8397">Mensal ${PRECO_MENSAL} · Vitalício ${PRECO_VITAL} (pagamento único). Se você já renovou, ignore este e-mail.</p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#8d8397">
      Precisa de ajuda? Fale com a gente no <a href="${DISCORD}" style="color:#ff8a90">Discord</a>.<br>
      Suporte VL Optimizer · <a href="${SITE}" style="color:#c9bfd2">vl-optimizer.pages.dev</a><br>
      <span style="font-size:11px;color:#6d6377">Este aviso é enviado porque você tem uma licença ativa. Não responda este e-mail.</span>
    </p>
  </div>
</body></html>`;

  const texto = [
    remetenteNome,
    '',
    titulo,
    '',
    'Olá, ' + nome + '!',
    linhaPrazo.replace(/<[^>]+>/g, ''),
    'Para continuar com os ajustes, o medidor de FPS e o scaling, é só renovar:',
    SITE + '/#precos',
    'Mensal ' + PRECO_MENSAL + ' · Vitalício ' + PRECO_VITAL + ' (pagamento único).',
    'Se você já renovou, ignore este e-mail.',
    '',
    'Precisa de ajuda? Discord: ' + DISCORD,
    'Suporte VL Optimizer · ' + SITE,
    'Não responda este e-mail.',
  ].join('\n');

  return { modelo: modelo || 'vence7', assunto, html, texto, para: email, nome, dias, expira };
}

/** E-mail de recuperação de senha (link do Supabase Auth, enviado pelo Brevo/Resend). */
export function montarEmailRecuperacao(link, nome, env) {
  const primeiro = String(nome || '').split(' ')[0].replace(/@.*/, '').slice(0, 30) || 'jogador';
  const remetenteNome = String(env.EMAIL_NOME || 'VL Optimizer').trim();
  const assunto = 'Criar nova senha · VL Optimizer';
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${assunto}</title></head>
<body style="margin:0;padding:0;background:#07030a;color:#f5f2f7;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 22px">
    <div style="font-size:20px;font-weight:bold;color:#ffffff;margin-bottom:22px"><span style="color:#ff1f2e">VL</span> Optimizer</div>
    <div style="background:#130b16;border:1px solid #2a1a30;border-radius:14px;padding:26px 24px">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ffffff">Criar nova senha</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#c9bfd2">Olá, ${primeiro}!</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#c9bfd2">Recebemos um pedido para redefinir a senha da sua conta no VL Optimizer. Clique no botão para criar uma senha nova.</p>
      <p style="margin:0 0 8px"><a href="${link}" style="display:inline-block;background:#ff1f2e;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;font-size:15px">Criar nova senha</a></p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#8d8397">O link expira em 1 hora e só pode ser usado uma vez. Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>
      <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#6d6377;word-break:break-all">Se o botão não abrir: ${link}</p>
    </div>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#8d8397">Precisa de ajuda? Fale com a gente no <a href="${DISCORD}" style="color:#ff8a90">Discord</a>.<br>Suporte VL Optimizer · <a href="${SITE}" style="color:#c9bfd2">vl-optimizer.pages.dev</a></p>
  </div>
</body></html>`;
  const texto = [
    remetenteNome, '', 'Criar nova senha', '',
    'Olá, ' + primeiro + '!',
    'Recebemos um pedido para redefinir a senha da sua conta no VL Optimizer.',
    'Abra este link para criar uma senha nova (expira em 1 hora, uso único):',
    link, '',
    'Se não foi você, ignore este e-mail — sua senha continua a mesma.',
    'Precisa de ajuda? Discord: ' + DISCORD,
    'Suporte VL Optimizer · ' + SITE,
  ].join('\n');
  return { assunto, html, texto, para: null };
}

export async function enviar(env, para, assunto, html, texto) {
  const conf = emailConfigurado(env);
  if (!conf.ok) {
    return { ok: false, erro: 'E-mail não configurado. Falta: ' + conf.precisa.join(', ') + '.', precisa: conf.precisa };
  }
  const remetenteNome = String(env.EMAIL_NOME || 'VL Optimizer').trim();
  try {
    if (conf.provedor === 'mailjet') {
      const auth = btoa(String(env.MAILJET_API_KEY) + ':' + String(env.MAILJET_SECRET_KEY));
      const r = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Messages: [{
            From: { Email: conf.remetente, Name: remetenteNome },
            To: [{ Email: para }],
            Subject: assunto,
            TextPart: texto,
            HTMLPart: html,
          }],
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('Mailjet falhou:', r.status, txt.slice(0, 300));
        return { ok: false, erro: 'O provedor de e-mail recusou o envio (' + r.status + ').' };
      }
      return { ok: true, provedor: 'mailjet' };
    }
    if (conf.provedor === 'sendgrid') {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + String(env.SENDGRID_API_KEY), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: para }] }],
          from: { email: conf.remetente, name: remetenteNome },
          subject: assunto,
          content: [
            { type: 'text/plain', value: texto },
            { type: 'text/html', value: html },
          ],
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('SendGrid falhou:', r.status, txt.slice(0, 300));
        return { ok: false, erro: 'O provedor de e-mail recusou o envio (' + r.status + ').' };
      }
      return { ok: true, provedor: 'sendgrid' };
    }
    if (conf.provedor === 'brevo') {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': String(env.BREVO_API_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: remetenteNome, email: conf.remetente },
          to: [{ email: para }],
          subject: assunto,
          htmlContent: html,
          textContent: texto,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('Brevo falhou:', r.status, txt.slice(0, 300));
        return { ok: false, erro: 'O provedor de e-mail recusou o envio (' + r.status + ').' };
      }
      return { ok: true, provedor: 'brevo' };
    }
    // Resend
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + String(env.RESEND_API_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remetenteNome + ' <' + conf.remetente + '>', to: [para], subject: assunto, html, text: texto }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('Resend falhou:', r.status, txt.slice(0, 300));
      return { ok: false, erro: 'O provedor de e-mail recusou o envio (' + r.status + ').' };
    }
    return { ok: true, provedor: 'resend' };
  } catch (e) {
    return { ok: false, erro: 'Não consegui falar com o provedor de e-mail agora.' };
  }
}

/**
 * Roda os lembretes de vencimento (janela de 7 dias).
 * Dedupe: marca em Storage (avisos/<id>-<modelo>-<data>.json) para não enviar 2x no día.
 */
export async function rodarLembretes(base, svc, env) {
  const conf = emailConfigurado(env);
  if (!conf.ok) return { ok: false, erro: 'E-mail não configurado. Falta: ' + conf.precisa.join(', ') + '.', enviados: 0, pulados: 0 };

  await garantirBucket(base, svc, 'avisos');
  const agora = Date.now();
  const limite = new Date(agora + 8 * 86400000).toISOString();
  let perfis = [];
  try {
    const r = await fetch(
      base + '/rest/v1/profiles?select=id,email,name,plan,lifetime,license_expires_at' +
        '&plan=eq.pro&lifetime=eq.false&license_expires_at=not.is.null' +
        '&license_expires_at=gt.' + encodeURIComponent(new Date(agora).toISOString()) +
        '&license_expires_at=lt.' + encodeURIComponent(limite) +
        '&order=license_expires_at.asc&limit=300',
      { headers: { apikey: svc, Authorization: 'Bearer ' + svc } }
    );
    perfis = r.ok ? await r.json() : [];
  } catch (e) {
    return { ok: false, erro: 'Não consegui listar as licenças agora.', enviados: 0, pulados: 0 };
  }
  if (!Array.isArray(perfis)) perfis = [];

  const hoje = new Date().toISOString().slice(0, 10);
  let enviados = 0;
  let pulados = 0;
  const erros = [];

  for (const perfil of perfis) {
    const dias = Math.ceil((new Date(perfil.license_expires_at).getTime() - Date.now()) / 86400000);
    const modelo = dias <= 1 ? 'vence1' : 'vence7';
    const marcador = String(perfil.id) + '-' + modelo + '-' + hoje + '.json';
    try {
      const ja = await storageLer(base, svc, 'avisos', marcador);
      if (ja) { pulados++; continue; }
      const mail = montarEmail(modelo, perfil, env);
      const envio = await enviar(env, perfil.email, mail.assunto, mail.html, mail.texto);
      if (!envio.ok) { erros.push(perfil.email + ': ' + envio.erro); continue; }
      await storageGravar(base, svc, 'avisos', marcador, { enviado_em: new Date().toISOString(), email: perfil.email, modelo });
      await registrarAuditoria(base, svc, { id: 'sistema', email: 'sistema@email' }, 'email_vencimento', perfil.email, modelo + ' · vence ' + mail.expira);
      enviados++;
    } catch (e) {
      erros.push(perfil.email + ': ' + (e && e.message ? e.message : 'erro'));
    }
  }

  return { ok: true, configurado: true, provedor: conf.provedor, total: perfis.length, enviados, pulados, erros: erros.slice(0, 5) };
}

/** Lista os avisos já marcados (para a tela de lembretes no admin). */
export async function listarAvisosRecentes(base, svc, limite) {
  const objetos = await storageListar(base, svc, 'avisos', '', limite || 20);
  const itens = await Promise.all(
    objetos.slice(0, limite || 20).map(async (o) => {
      const d = await storageLer(base, svc, 'avisos', o.name);
      return d ? { nome: o.name, ...d } : null;
    })
  );
  return itens.filter(Boolean);
}
