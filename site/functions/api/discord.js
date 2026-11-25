/**
 * functions/api/discord.js — números reais do Discord para o site.
 *
 * O site mostra "membros no Discord" e "online agora" (prova de comunidade, como o
 * GDZ mostra os feedbacks). O navegador não pode chamar a API do Discord direto por
 * causa de CORS, então esta Function faz a ponte no mesmo domínio do site.
 *
 * Uso:  GET /api/discord
 *       -> { ok: true, membros: 4459, online: 369, servidor: "..." }
 *
 * A API de convites do Discord às vezes responde 429 para os IPs do Cloudflare.
 * Por isso: 3 tentativas com espera crescente e, se todas falharem, devolve o último
 * resultado bom que este worker viu (cache em memória). O site, por segurança, ainda
 * tem números estáticos no HTML para o caso de tudo falhar.
 *
 * Cache de 5 minutos: os números não precisam ser ao vivo ao segundo.
 */

const CONVITE = 'k8F3mvxam';
const URL_API = 'https://discord.com/api/v10/invites/' + CONVITE + '?with_counts=true';

// último resultado bom (vive enquanto o worker estiver quente)
let ultimoBom = null;

const json = (obj, ttl) =>
  new Response(JSON.stringify(obj), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + (ttl || 300),
    },
  });

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function buscar(env) {
  const cab = {
    'User-Agent': 'vl-optimizer-site (https://vl-optimizer.pages.dev)',
    Accept: 'application/json',
  };
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetch(URL_API, { headers: cab });
      if (r.ok) {
        const d = await r.json();
        const dados = {
          ok: true,
          membros: Number(d.approximate_member_count) || 0,
          online: Number(d.approximate_presence_count) || 0,
          servidor: (d.guild && d.guild.name) || null,
        };
        if (dados.membros > 0) ultimoBom = dados;
        return dados;
      }
      // 429/5xx: espera e tenta de novo
      if (r.status === 429 || r.status >= 500) { await espera(300 * (tentativa + 1)); continue; }
      break;
    } catch (e) {
      await espera(200 * (tentativa + 1));
    }
  }
  if (ultimoBom) return { ...ultimoBom, fonte: 'cache' };
  return { ok: false };
}

export async function onRequestGet(context) {
  const dados = await buscar(context && context.env);
  if (!dados.ok) return json({ ok: false }, 60);
  return json(dados, 300);
}

export async function onRequest(context) {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return onRequestGet(context);
}
