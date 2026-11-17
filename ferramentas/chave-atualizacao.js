// chave-atualizacao.js — cria e usa o par de chaves Ed25519 da ATUALIZAÇÃO.
//
// Por que existe
//   O electron-updater confere o sha512 do .exe contra o latest.yml. Quem consegue
//   trocar o .exe E o latest.yml juntos passa nessa conferência, porque o hash do
//   yml passa a descrever o arquivo malicioso. O que trava isso é uma assinatura
//   SEPARADA, feita com uma chave que o servidor de arquivos não tem.
//   O GDZ faz assim (C:\VLTemp\TIME\t6-scaling.md, §verifyInstaller).
//
// O QUE ESTE ARQUIVO FAZ
//   gerar    cria o par de chaves (a privada NUNCA vai para o repositório)
//   assinar  assina um instalador e grava o .sig ao lado
//
// COMO USAR (uma vez só, no PC do dono)
//
//   node ferramentas/chave-atualizacao.js gerar
//       -> grava  C:\VLTemp\vl-release-private.key   (PKCS8 DER, base64)  NÃO COMMITAR
//       -> imprime a chave pública em base64 (SPKI)
//       -> você cola a pública em marca/marca-vl.json  no campo "chaveReleasePublica"
//
//   node ferramentas/chave-atualizacao.js assinar 1.4.35
//       -> assina release\Instalar-VL-Optimizer-1.4.35.exe
//       -> grava  release\Instalar-VL-Optimizer-1.4.35.exe.sig   (base64)
//
//   Depois o publicar.js leva o .sig para site\atualizacoes\assinatura\<versão>.sig
//   e o app busca em GET <site>/atualizacoes/assinatura/<versão>.
//
// O algoritmo é EXATAMENTE o do GDZ: assina-se o DIGEST SHA-512 do arquivo, não o
// arquivo cru, e a conferência é `crypto.verify(null, digest, pubkey, sig)`.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const RELEASE = path.join(RAIZ, 'release');

// Chave privada FORA do projeto: um `git add .` descuidado não pode vazá-la.
const PRIVADA = process.env.VL_RELEASE_KEY_FILE || 'C:\\VLTemp\\vl-release-private.key';

const CMD = (process.argv[2] || '').toLowerCase();

function morrer(msg) {
  console.error('');
  console.error('  ERRO: ' + msg);
  process.exit(1);
}

function gerar() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const privB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

  if (fs.existsSync(PRIVADA) && !process.argv.includes('--forcar')) {
    morrer('já existe uma chave privada em ' + PRIVADA + '\n' +
      '  Se gerar outra, TODOS os apps instalados deixam de aceitar as atualizações novas.\n' +
      '  Para trocar de propósito, rode com --forcar.');
  }

  fs.mkdirSync(path.dirname(PRIVADA), { recursive: true });
  fs.writeFileSync(PRIVADA, privB64, { encoding: 'utf8', mode: 0o600 });

  console.log('');
  console.log('  Chave privada gravada em: ' + PRIVADA);
  console.log('  >>> NÃO comite, NÃO suba para o site, NÃO mande por WhatsApp.');
  console.log('');
  console.log('  Cole esta linha em marca/marca-vl.json:');
  console.log('');
  console.log('      "chaveReleasePublica": "' + pubB64 + '",');
  console.log('');
  console.log('  (é a chave pública: pode aparecer em todo lugar)');
}

// SHA-512 em streaming — o instalador tem ~140 MB.
function sha512(caminho) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(caminho)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest()))
      .on('error', rej);
  });
}

async function assinar(versao) {
  if (!versao) morrer('informe a versão: node ferramentas/chave-atualizacao.js assinar 1.4.35');
  if (!fs.existsSync(PRIVADA)) morrer('chave privada não encontrada em ' + PRIVADA + '\n  Rode "gerar" antes.');

  const exe = path.join(RELEASE, 'Instalar-VL-Optimizer-' + versao + '.exe');
  if (!fs.existsSync(exe)) morrer('instalador não encontrado: ' + exe + '\n  Rode o build antes.');

  const priv = crypto.createPrivateKey({
    key: Buffer.from(fs.readFileSync(PRIVADA, 'utf8').trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  const digest = await sha512(exe);
  const sig = crypto.sign(null, digest, priv).toString('base64');

  const destino = path.join(RELEASE, 'Instalar-VL-Optimizer-' + versao + '.exe.sig');
  fs.writeFileSync(destino, sig, 'utf8');

  // Autoconferência: se a assinatura não validar com a pública derivada da privada,
  // é melhor falhar agora do que distribuir algo que todo app vai recusar.
  const pubDerivada = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const ok = crypto.verify(null, digest, crypto.createPublicKey({ key: pubDerivada, format: 'der', type: 'spki' }), Buffer.from(sig, 'base64'));
  if (!ok) morrer('a assinatura que acabei de gerar não confere. Nada foi publicado.');

  console.log('');
  console.log('  Assinado: ' + path.basename(exe));
  console.log('  SHA-512 : ' + digest.toString('base64'));
  console.log('  Assinatura (base64): ' + sig);
  console.log('  Arquivo : ' + destino);
  console.log('');
}

const versao = (process.argv[3] || '').trim();
if (CMD === 'gerar') gerar();
else if (CMD === 'assinar') assinar(versao).catch((e) => morrer(e.message));
else {
  console.log('');
  console.log('  node ferramentas/chave-atualizacao.js gerar            cria o par de chaves');
  console.log('  node ferramentas/chave-atualizacao.js assinar <versao> assina o instalador');
  console.log('');
}
