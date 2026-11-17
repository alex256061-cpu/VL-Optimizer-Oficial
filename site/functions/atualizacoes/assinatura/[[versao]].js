/**
 * functions/atualizacoes/assinatura/[[versao]].js — entrega a ASSINATURA do instalador.
 *
 * Equivale ao GET /updates/signature/<versão> do GDZ
 * (C:\VLTemp\TIME\t6-scaling.md, §verifyInstaller): endpoint SEM autenticação, que devolve
 *
 *     { "signature": "<base64>" }
 *
 * e essa assinatura é o Ed25519 do SHA-512 do instalador publicado.
 *
 * Por que isso é diferente do latest.yml
 *   O latest.yml já tem um sha512, e o electron-updater confere. Mas quem controla o
 *   feed controla os dois valores juntos: trocar o .exe E o latest.yml passa nessa
 *   conferência. A assinatura daqui é feita com a chave PRIVADA, que não fica no
 *   site nem no repositório — e a pública está embutida no app. É essa separação
 *   que o sha512 sozinho não tem.
 *
 * De onde vem o arquivo
 *   O publicar.js grava  site/atualizacoes/assinatura/<versão>.sig  antes do deploy.
 *   Esta Function lê esse arquivo estático (mesmo padrão de "deixa o estático passar"
 *   da [[path]].js) e devolve { signature }. Se o .sig não existir, responde 404 —
 *   o app trata isso conforme o modo configurado (obrigatório ou opcional).
 *
 * Não confie no que vem da URL além do nome do arquivo: a versão é validada por
 * regex e concatenada com sufixo fixo, então não dá para escapar da pasta.
 */

const VERSAO_SEGURA = /^\d+\.\d+\.\d+$/;

export async function onRequest(context) {
  const { request, next, params } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Método não permitido.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  // /atualizacoes/assinatura/1.4.35  ->  params.versao === "1.4.35"
  const versao = String((params && params.versao) || '').trim();

  if (!VERSAO_SEGURA.test(versao)) {
    return json({ error: 'versão inválida' }, 400);
  }

  // Lê o .sig que o publicar.js deixou em site/atualizacoes/assinatura/.
  const url = new URL(request.url);
  const alvo = new URL(url.origin + '/atualizacoes/assinatura/' + versao + '.sig');

  let resposta;
  try {
    resposta = await fetch(alvo.toString(), { cf: { cacheTtl: 300 } });
  } catch (e) {
    resposta = null;
  }

  if (!resposta || !resposta.ok) {
    // Sem assinatura publicada para esta versão. 404 é a resposta honesta: o app
    // decide se isso bloqueia (modo obrigatório) ou não (opcional).
    return json({ error: 'sem assinatura para a versão ' + versao }, 404);
  }

  const signature = (await resposta.text()).trim();
  if (!signature) {
    return json({ error: 'assinatura vazia para a versão ' + versao }, 404);
  }

  return json({ version: versao, signature }, 200);
}

function json(corpo, status) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A assinatura de uma versão publicada nunca muda (mudar seria republicar),
      // mas cache curto evita distribuir uma resposta errada por muito tempo.
      'cache-control': 'public, max-age=300',
    },
  });
}
