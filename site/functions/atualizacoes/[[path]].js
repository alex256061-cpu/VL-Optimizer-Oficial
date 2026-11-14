// Cloudflare Pages Function — entrega o instalador SEM mandar o usuário ao GitHub.
//
// Por que existe:
//   O Cloudflare Pages recusa qualquer arquivo estático acima de 25 MiB
//   (https://developers.cloudflare.com/pages/platform/limits/). O instalador tem ~137 MB,
//   então não cabe na pasta do site.
//
//   O GDZ resolve com um servidor próprio:
//       provider: generic
//       url: https://api.gdzfps.com/api/v1/updates
//
//   Aqui é o mesmo arranjo: o app e o site pedem o arquivo em
//   vl-optimizer.pages.dev/atualizacoes/… e ESTA função busca o binário e devolve como se
//   fosse um arquivo nosso. O cliente nunca vê github.com.
//
// ATENÇÃO ao nome da rota: esta função intercepta TUDO em /atualizacoes/…, inclusive os
// arquivos estáticos dessa pasta. Se a resposta não for um .exe permitido, ela precisa
// deixar o arquivo estático passar (next()) — senão o latest.yml some do site.

const REPO = 'alex256061-cpu/VL-Optimizer-Oficial';

// Só estes nomes podem passar. Impede que a função vire proxy aberto para qualquer URL.
const PERMITIDO = /^Instalar-VL-Optimizer(-[\d.]+)?\.exe$/i;

// A tag do release NÃO é "latest": o electron-builder publica com a tag da versão
// (v1.4.17, v1.4.16, ...). Antes esta função usava /download/latest/…, que responde 404 —
// por isso o botão de download não funcionava.
// Aqui a tag vem do próprio latest.yml que o site publica, com cache de 10 minutos.
let tagEmCache = null;
let tagEmCacheAte = 0;

async function descobrirTag(origem) {
  const agora = Date.now();
  if (tagEmCache && agora < tagEmCacheAte) return tagEmCache;

  // 1. do latest.yml do site (é a fonte que o app usa)
  try {
    const r = await fetch(origem + '/atualizacoes/latest.yml', { cf: { cacheTtl: 0 } });
    if (r.ok) {
      const txt = await r.text();
      const m = /^version:\s*(.+)$/m.exec(txt);
      if (m && m[1]) {
        tagEmCache = 'v' + m[1].trim().replace(/^v/i, '');
        tagEmCacheAte = agora + 10 * 60 * 1000;
        return tagEmCache;
      }
    }
  } catch (e) { }

  // 2. da API pública do GitHub
  try {
    const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { 'User-Agent': 'vl-optimizer', Accept: 'application/vnd.github+json' },
      cf: { cacheTtl: 600 },
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.tag_name) {
        tagEmCache = j.tag_name;
        tagEmCacheAte = agora + 10 * 60 * 1000;
        return tagEmCache;
      }
    }
  } catch (e) { }

  return null;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const nome = decodeURIComponent(url.pathname.replace(/^\/atualizacoes\//, ''));

  // Não é um instalador: deixa o arquivo estático do site responder
  // (latest.yml, ou qualquer outro arquivo que esteja na pasta).
  if (!PERMITIDO.test(nome)) {
    if (next) return next();
    return new Response('Arquivo não disponível.', { status: 404 });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const tag = await descobrirTag(url.origin);
  if (!tag) {
    return new Response(
      'Não foi possível localizar a versão publicada agora. Tente de novo em alguns minutos.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  // O nome fixo (sem versão) sempre baixa a última versão publicada.
  let alvo = nome;
  if (/^Instalar-VL-Optimizer\.exe$/i.test(nome)) {
    try {
      const r = await fetch(url.origin + '/atualizacoes/latest.yml', { cf: { cacheTtl: 0 } });
      if (r.ok) {
        const txt = await r.text();
        const m = /^\s*-\s*url:\s*(.+)$/m.exec(txt) || /^path:\s*(.+)$/m.exec(txt);
        if (m && m[1]) alvo = m[1].trim();
      }
    } catch (e) { }
  }

  const destino =
    'https://github.com/' + REPO + '/releases/download/' + encodeURIComponent(tag) + '/' + encodeURIComponent(alvo);

  // Range é essencial: o atualizador baixa em partes e o navegador retoma downloads.
  const cabecalhos = {};
  const range = request.headers.get('Range');
  if (range) cabecalhos['Range'] = range;

  let upstream;
  try {
    upstream = await fetch(destino, {
      headers: cabecalhos,
      redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch (e) {
    return new Response('Não foi possível buscar o instalador agora. Tente de novo em instantes.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(
      'O instalador desta versão não foi publicado ainda. Tente de novo em alguns minutos.',
      {
        status: upstream.status === 404 ? 404 : 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  }

  // Repassa o corpo como stream: nunca carrega 137 MB na memória da função.
  const saida = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) saida.set(h, v);
  }
  if (!saida.has('content-type')) saida.set('content-type', 'application/octet-stream');
  saida.set('content-disposition', 'attachment; filename="' + alvo + '"');
  saida.set('cache-control', 'public, max-age=86400');

  // HEAD responde sem corpo; o navegador e o atualizador usam GET.
  if (request.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers: saida });
  }

  return new Response(upstream.body, { status: upstream.status, headers: saida });
}
