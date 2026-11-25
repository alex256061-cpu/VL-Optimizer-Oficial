/**
 * functions/api/discord.js — números reais do Discord para o site.
 *
 * O site mostra "membros no Discord" e "online agora" (prova de comunidade, como o
 * GDZ mostra os feedbacks). O navegador não pode chamar a API do Discord direto por
 * causa de CORS, então esta Function faz a ponte no mesmo domínio do site.
 *
 * Uso:  GET /api/discord
 *       -> { ok: true, membros: 4458, online: 353, servidor: "..." }
 *
 * Cache de 5 minutos: os números não precisam ser ao vivo ao segundo e o convite é
 * consultado uma vez só por período (o widget do Discord já cacheia parecido).
 */

const CONVITE = 'k8F3mvxam';

const json = (obj, ttl) =>
  new Response(JSON.stringify(obj), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + (ttl || 300),
    },
  });

export async function onRequestGet() {
  try {
    const r = await fetch('https://discord.com/api/v10/invites/' + CONVITE + '?with_counts=true', {
      headers: { 'User-Agent': 'vl-optimizer-site' },
      cf: { cacheTtl: 300 },
    });
    if (!r.ok) { console.log('discord: status ' + r.status); return json({ ok: false }, 120); }
    const d = await r.json();
    return json({
      ok: true,
      membros: Number(d.approximate_member_count) || 0,
      online: Number(d.approximate_presence_count) || 0,
      servidor: (d.guild && d.guild.name) || null,
    }, 300);
  } catch (e) {
    console.log('discord: erro ' + (e && e.message ? e.message : e));
    return json({ ok: false }, 60);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return onRequestGet();
}
