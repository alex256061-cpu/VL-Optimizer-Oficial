/**
 * functions/atualizacoes/assinatura/[[versao]].js — entrega a ASSINATURA do instalador.
 *
 * Equivale ao GET /updates/signature/<versão> do GDZ: endpoint SEM autenticação que
 * devolve
 *
 *     { "signature": "<base64>" }
 *
 * e essa assinatura é o Ed25519 do SHA-512 do instalador publicado.
 *
 * Por que isso é diferente do latest.yml
 *   O latest.yml já tem um sha512, e o electron-updater confere. Mas quem controla o
 *   feed controla os dois valores juntos: trocar o .exe E o latest.yml passa nessa
 *   conferência. A assinatura daqui é feita com a chave PRIVADA, que não fica no site
 *   nem no repositório — e a pública está embutida no app. É essa separação que o
 *   sha512 sozinho não tem.
 *
 * HISTÓRICO IMPORTANTE (correção de 19/11/2026)
 *   A primeira versão desta Function fazia `fetch()` para o próprio site para ler o
 *   arquivo .sig estático. Em produção isso NÃO funciona: o sub-request volta para a
 *   própria Pages e a leitura do estático falha — a Function respondia
 *   {"error":"sem assinatura para a versão X"} com 404 para TODA versão.
 *
 *   Consequência real: o app, em modo `obrigatorio` (marca/usada.json), apagava o
 *   instalador baixado porque não conseguia conferir a assinatura. O auto-update
 *   estava quebrado e o app instalado ficou parado na 1.4.31.
 *
 *   Agora a leitura do .sig tenta três caminhos, do mais correto ao mais tolerante:
 *     1. env.ASSETS.fetch(...)  — binding do Pages para os arquivos ESTÁTICOS deste
 *        deploy. Não passa por Function nenhuma, então não tem como dar loop.
 *     2. fetch() de /assinaturas/<versao>.sig — cópia do .sig numa pasta de raiz que
 *        nenhuma Function intercepta (o publicar.js grava essa cópia).
 *     3. fetch() de /atualizacoes/assinatura/<versao>.sig — o caminho original.
 *
 * Não confie no que vem da URL além do nome do arquivo: a versão é validada por
 * regex e concatenada com sufixo fixo, então não dá para escapar da pasta.
 */

const VERSAO_SEGURA = /^\d+\.\d+\.\d+$/;

export async function onRequest(context) {
  const { request, env, next, params } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'método não permitido' }, 405, { Allow: 'GET, HEAD' });
  }

  // /atualizacoes/assinatura/1.4.62  ->  params.versao === "1.4.62"
  const versao = String((params && params.versao) || '').trim();

  if (!VERSAO_SEGURA.test(versao)) {
    return json({ error: 'versão inválida' }, 400);
  }

  const origem = new URL(request.url).origin;

  // 1) arquivo estático do próprio deploy, sem passar por Function
  let texto = await tentarAssets(env, request, origem, versao);

  // 2) cópia numa pasta de raiz que nenhuma Function intercepta
  if (!texto) texto = await tentarFetch(origem + '/assinaturas/' + versao + '.sig');

  // 3) o caminho original
  if (!texto) texto = await tentarFetch(origem + '/atualizacoes/assinatura/' + versao + '.sig');

  if (!texto) {
    // Sem assinatura publicada para esta versão. 404 é a resposta honesta: o app
    // decide se isso bloqueia (modo obrigatório) ou não (opcional).
    if (next) {
      try { await next(); } catch (e) { /* ignora: só queríamos a chance do estático */ }
    }
    return json({ error: 'sem assinatura para a versão ' + versao }, 404);
  }

  return json({ version: versao, signature: texto }, 200);
}

// Lê o .sig pelo binding ASSETS (arquivo estático do deploy).
async function tentarAssets(env, request, origem, versao) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  const url = origem + '/atualizacoes/assinatura/' + versao + '.sig';
  try {
    const r = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    if (!r || !r.ok) return null;
    const t = (await r.text()).trim();
    return t || null;
  } catch (e) {
    return null;
  }
}

async function tentarFetch(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 } });
    if (!r || !r.ok) return null;
    const t = (await r.text()).trim();
    return t || null;
  } catch (e) {
    return null;
  }
}

function json(corpo, status, extras) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    // A assinatura de uma versão publicada nunca muda (mudar seria republicar),
    // mas cache curto evita distribuir uma resposta errada por muito tempo.
    'cache-control': 'public, max-age=300',
  };
  if (extras) for (const k of Object.keys(extras)) headers[k] = extras[k];
  return new Response(JSON.stringify(corpo), { status, headers });
}
