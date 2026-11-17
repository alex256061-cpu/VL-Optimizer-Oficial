// assinatura-update.js — confere a ASSINATURA da atualização antes de instalar.
//
// O PROBLEMA QUE ISTO RESOLVE
//
//   O electron-updater já confere o SHA-512 do instalador baixado contra o campo
//   `sha512` do latest.yml (ver `DigestTransform` em builder-util-runtime,
//   `ERR_CHECKSUM_MISMATCH`). Isso pega download corrompido e pega .exe trocado SOZINHO.
//
//   Não pega o caso em que alguém troca o .exe E o latest.yml juntos, porque o sha512
//   do latest.yml passa a descrever (e a bater com) o arquivo malicioso. Quem controla
//   o feed controla o hash. O sha512 sozinho é integridade, não é autenticidade.
//
// COMO O GDZ RESOLVE (C:\VLTemp\TIME\t6-scaling.md, §verifyInstaller)
//
//   Uma assinatura Ed25519 SEPARADA do latest.yml. A chave pública fica embutida no
//   app (o atacante teria de trocar o app instalado, que é justamente o que ele quer
//   propagar). O servidor devolve só a assinatura e o cliente confere:
//
//       GET  {API_URL}/updates/signature/<versão>   ->  { signature: base64 }
//       SHA-512 do arquivo baixado  ->  digest (Buffer)
//       crypto.verify(null, digest, chavePúblicaEd25519, assinatura)
//
//   O que é assinado é o DIGEST, não o arquivo cru. Falhou? O instalador é APAGADO.
//
// DIFERENÇAS CONSCIENTES EM RELAÇÃO AO GDZ
//
//   1. O GDZ usa `apiCall`, que devolve `{ status: 0 }` quando o servidor está fora.
//      Aí `verifyInstaller` devolve "Não foi possível conferir" e o GDZ APAGA o
//      instalador — o usuário fica sem atualização só porque a rede caiu.
//      Aqui existe uma opção `modo`:
//        'obrigatorio' -> igual ao GDZ: sem assinatura = não instala (mais seguro)
//        'opcional'    -> servidor sem chave configurada = passa (não trava ninguém)
//      A escolha é do dono, em MARCA.chaveReleasePublica. Ver DECISOES.md.
//
//   2. Sem chave pública configurada nada é verificado e isso fica REGISTRADO no
//      estado (`assinatura: 'sem-chave'`), para não parecer que a proteção existe.
//
// Este arquivo é puro Node (não importa `electron`), então dá para testar fora do app.
'use strict';

const crypto = require('crypto');
const fs = require('fs');

// Mensagens iguais às do GDZ (t6-scaling.md, §verifyInstaller) — o usuário vê as mesmas.
const MSG_SEM_ASSINATURA = 'Não foi possível conferir a assinatura da atualização.';
const MSG_NAO_CONFERE = 'A assinatura da atualização não confere. Ela foi descartada.';

// SHA-512 do arquivo, em streaming (o instalador tem ~140 MB: não pode ir para a memória).
function sha512DeArquivo(caminho) {
  return new Promise((resolver, rejeitar) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(caminho)
      .on('data', (pedaco) => hash.update(pedaco))
      .on('end', () => resolver(hash.digest()))
      .on('error', rejeitar);
  });
}

// A chave pública é DER/SPKI em base64 (é assim que `crypto.generateKeyPairSync`
// entrega uma Ed25519). `createPublicKey` recusa o que não for chave válida.
function chaveDe(publicaB64) {
  return crypto.createPublicKey({
    key: Buffer.from(String(publicaB64 || '').trim(), 'base64'),
    format: 'der',
    type: 'spki',
  });
}

// Chave pública é um valor da MARCA. Vazio/inválido = verificação desligada.
function temChave(publicaB64) {
  if (!String(publicaB64 || '').trim()) return false;
  try { chaveDe(publicaB64); return true; } catch (e) { return false; }
}

// Confere a assinatura de UM arquivo já baixado.
//
// Devolve sempre um objeto (nunca lança para o chamador decidir melhor):
//   { ok: true,  digest }                 -> pode instalar
//   { ok: false, motivo, mensagem }       -> não pode instalar
//
// `assinaturaB64` null = o servidor não devolveu assinatura. Em modo 'opcional' isso
// passa; em 'obrigatorio' reprova (igual ao GDZ).
async function conferirArquivo({ arquivo, versao, assinaturaB64, publicaB64, modo }) {
  const obrigatorio = modo !== 'opcional';

  if (!temChave(publicaB64)) {
    // Sem chave não há o que conferir. Não é falha do usuário — é configuração.
    return { ok: true, pulado: true, motivo: 'sem-chave', digest: null };
  }

  if (!assinaturaB64) {
    if (!obrigatorio) return { ok: true, pulado: true, motivo: 'sem-assinatura', digest: null };
    return { ok: false, motivo: 'sem-assinatura', mensagem: MSG_SEM_ASSINATURA };
  }

  let digest;
  try {
    digest = await sha512DeArquivo(arquivo);
  } catch (e) {
    // Não consegui ler o arquivo: não dá para afirmar que é bom.
    return { ok: false, motivo: 'erro-leitura', mensagem: MSG_SEM_ASSINATURA, detalhe: e.message };
  }

  let confere = false;
  try {
    confere = crypto.verify(
      null,                                        // null = Ed25519 (algoritmo implícito na chave)
      digest,
      chaveDe(publicaB64),
      Buffer.from(String(assinaturaB64), 'base64'),
    );
  } catch (e) {
    confere = false;
  }

  if (!confere) {
    return { ok: false, motivo: 'assinatura-invalida', mensagem: MSG_NAO_CONFERE, digest };
  }
  return { ok: true, digest, versao: versao || null };
}

module.exports = {
  conferirArquivo,
  sha512DeArquivo,
  temChave,
  chaveDe,
  MSG_SEM_ASSINATURA,
  MSG_NAO_CONFERE,
};
