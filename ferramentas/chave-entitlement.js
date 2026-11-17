// chave-entitlement.js — cria e confere o par de chaves Ed25519 da LICENÇA.
//
// Por que existe
//   Hoje a licença é só "o HTTPS do Supabase está de pé?". O `offlineUntil` que decide
//   quanto tempo o app funciona SEM internet é gravado no auth.bin (cifrado com o
//   safeStorage, ou seja, DPAPI): QUALQUER pessoa que já está dentro daquela conta do
//   Windows consegue abrir o arquivo, mudar a data e estender a licença.
//
//   O GDZ não deixa: o servidor MANDA `offlineUntil` dentro de um payload ASSINADO com
//   Ed25519 e o app confere com uma chave pública embutida no .exe
//   (C:\VLTemp\TIME\t6-scaling.md §verifyEntitlement / §refreshEntitlement).
//   Quem edita o auth.bin à mão só consegue validar a alteração se tiver a chave
//   privada, que fica no secret do Supabase, não no PC do cliente.
//
// POR QUE ESTA CHAVE É DIFERENTE DA chave-atualizacao.js
//   São duas confianças diferentes: "este .exe é nosso" (assinatura da ATUALIZAÇÃO) e
//   "esta licença é nossa" (ENTITLEMENT). Misturar as duas faz uma chave vazada na
//   máquina de build virar licença grátis, e vice-versa. São dois pares, dois campos de
//   marca (chaveReleasePublica / chaveEntitlementPublica) e dois secrets no Supabase.
//
// COMO USAR (uma vez só, no PC do dono)
//
//   node ferramentas/chave-entitlement.js gerar
//       -> grava  C:\VLTemp\vl-entitlement-private.key   (PKCS8 DER, base64)  NÃO COMMITAR
//       -> imprime a chave pública em base64 (SPKI)
//       -> imprime o SQL do secret opaco que vai no Supabase (ver §Deploy)
//
//   node ferramentas/chave-entitlement.js publica
//       -> só imprime a pública + o SQL (a privada já existe)
//
//   node ferramentas/chave-entitlement.js secret
//       -> imprime o valor de VL_ENTITLEMENT_KEY_SECRET (o segredo que o app manda)
//
//   node ferramentas/chave-entitlement.js verificar <arquivo.json>
//       -> lê { payload, assinatura } e confere com a pública da marca/marca-vl.json
//
// COMPATIBILIDADE: com a pública VAZIA na marca, o app novo se comporta exatamente como
// hoje (offlineUntil calculado localmente) — ver entidade-licenca.js. A proteção só passa
// a valer para quem baixar a versão que tem a pública embutida. A ordem segura é:
//
//   1. gerar a chave (a privada NUNCA vai para o git nem para o site)
//   2. `verificar` uma emissão de teste contra a pública
//   3. publicar o secret + fazer o deploy da Edge Function
//   4. só então buildar o app novo com a pública na marca
//
// É EXATAMENTE o algoritmo do GDZ: Ed25519 (crypto.verify(null, ...)), payload em
// JSON utf8, base64url nos dois segmentos, separados por UM ponto.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Chave privada FORA do projeto: um `git add .` descuidado não pode vazá-la.
const PRIVADA = process.env.VL_ENTITLEMENT_KEY_FILE || 'C:\\VLTemp\\vl-entitlement-private.key';
// O arquivo que guarda o segredo opaco entregue ao servidor (mesma pasta de fora).
const SEGREDO_ARQ = process.env.VL_ENTITLEMENT_SECRET_FILE || 'C:\\VLTemp\\vl-entitlement-secret.txt';

// ── base64url (é o que o GDZ usa nos dois segmentos) ─────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function deB64url(txt) {
  const s = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

function morrer(msg) {
  console.error('');
  console.error('  ERRO: ' + msg);
  process.exit(1);
}

// JSON.parse que aceita BOM: o PowerShell 5 grava o .json com BOM e o dono vai mexer
// nestes arquivos pelo Notepad. Sem isso, o resto do arquivo fica deslocado.
function lerJson(caminho) {
  const bruto = fs.readFileSync(caminho, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(bruto);
}

// A chave pública que o APP vai embutir: lida da marca (é de lá que o build tira).
function publicaDaMarca() {
  const nome = String(process.env.VL_MARCA || 'vl').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  const arq = path.join(RAIZ, 'marca', 'marca-' + nome + '.json');
  try {
    const j = lerJson(arq);
    return String(j.chaveEntitlementPublica || '').trim();
  } catch (e) {
    return '';
  }
}

// ── gerar ────────────────────────────────────────────────────────────────
function gerar() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const privB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');

  if (fs.existsSync(PRIVADA) && !process.argv.includes('--forcar')) {
    morrer('já existe uma chave privada em ' + PRIVADA + '\n' +
      '  Se gerar outra, TODAS as licenças emitidas com a antiga deixam de valer no app novo\n' +
      '  (o app instalado confere com a PÚBLICA embutida dele, e ela não muda sozinha).\n' +
      '  Para trocar de propósito, rode com --forcar.');
  }

  fs.mkdirSync(path.dirname(PRIVADA), { recursive: true });
  fs.writeFileSync(PRIVADA, privB64, { encoding: 'utf8', mode: 0o600 });

  // O segredo opaco: NÃO é a chave privada. É só uma senha que a Edge Function confere
  // antes de assinar — se vazar, o dono troca por outra sem tocar em app nenhum. Sem ele
  // qualquer dono de conta criaria licença vitalícia para si (ver entidade-licenca.js §2).
  if (!fs.existsSync(SEGREDO_ARQ) || process.argv.includes('--forcar')) {
    fs.writeFileSync(SEGREDO_ARQ, crypto.randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600 });
  }
  const segredo = fs.readFileSync(SEGREDO_ARQ, 'utf8').trim();

  console.log('');
  console.log('  Chave privada gravada em: ' + PRIVADA);
  console.log('  >>> NÃO comite, NÃO suba para o site, NÃO mande por WhatsApp.');
  console.log('  >>> Ela vira o secret VL_ENTITLEMENT_PRIVATE_KEY no Supabase.');
  console.log('');
  console.log('  1) Cole estas duas linhas em marca/marca-' + String(process.env.VL_MARCA || 'vl') + '.json:');
  console.log('');
  console.log('      "chaveEntitlementPublica": "' + pubB64 + '",');
  console.log('      "entitlementSegredo": "' + segredo + '",');
  console.log('');
  console.log('  (é a chave pública: pode aparecer em todo lugar — ela vai dentro do .exe)');
  console.log('');
  console.log('  2) Depois, em supabase/entitlement-SQL.sql (cole no SQL Editor do Supabase):');
  console.log('');
  console.log(sqlDoSecret(segredo));
}

// SQL que guarda o HASH do segredo no banco (nunca o segredo em si) e a versão mínima.
// Usa só o que o Postgres já tem: sha256 e encode em hex.
function sqlDoSecret(segredo) {
  const hash = crypto.createHash('sha256').update(segredo, 'utf8').digest('hex');
  return [
    '-- Segredo do entitlement (hash sha256 do hex entregue no app; a Edge Function confere).',
    "create table if not exists public.entitlement_config (",
    "  id     int primary key default 1 check (id = 1),",
    "  segredo_sha256 text not null,",
    "  updated_at     timestamptz not null default now()",
    ");",
    "alter table public.entitlement_config enable row level security;",
    "-- Ninguém lê esta tabela pelo app: só a Edge Function, com service role.",
    "",
    "insert into public.entitlement_config (id, segredo_sha256)",
    "values (1, '" + hash + "')",
    "on conflict (id) do update set segredo_sha256 = excluded.segredo_sha256, updated_at = now();",
    "",
    "-- Revoga a senha depois (em caso de vazamento):",
    "update public.entitlement_config set segredo_sha256 = encode(sha256('NOVO-SEGREDO'::bytea), 'hex') where id = 1;",
    "-- e troque o segredo em marca/marca-*.json no próximo build.",
  ].join('\n');
}

// ── secret: só imprime ───────────────────────────────────────────────────
function secret() {
  if (!fs.existsSync(SEGREDO_ARQ)) morrer('segredo não encontrado em ' + SEGREDO_ARQ + '\n  Rode "gerar" antes.');
  const segredo = fs.readFileSync(SEGREDO_ARQ, 'utf8').trim();
  console.log('');
  console.log('  Segredo (VL_ENTITLEMENT_SECRET): ' + segredo);
  console.log('');
  console.log('  SQL do banco:');
  console.log(sqlDoSecret(segredo));
  console.log('');
}

// ── verificar: o mesmo passo que o app faz ───────────────────────────────
// Aceita { payload, assinatura } (o que a Edge Function devolve) ou a string
// "payloadB64url.assinaturaB64url" (o formato do GDZ).
function verificar(arquivo) {
  if (!arquivo) morrer('informe o arquivo: node ferramentas/chave-entitlement.js verificar licenca.json');
  if (!fs.existsSync(arquivo)) morrer('arquivo não encontrado: ' + arquivo);

  let payload = '', assinatura = '';
  const bruto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').trim();
  if (bruto.indexOf('.') >= 0 && bruto[0] !== '{') {
    const partes = bruto.split('.');
    payload = partes[0];
    assinatura = partes[1] || '';
  } else {
    const j = JSON.parse(bruto);
    payload = String((j && (j.payload || j.entitlement)) || '');
    if (j && typeof j.assinatura === 'string') assinatura = j.assinatura;
    else if (payload.indexOf('.') >= 0) {
      const partes = payload.split('.');
      payload = partes[0];
      assinatura = partes[1] || '';
    }  }
  if (!payload || !assinatura) morrer('o arquivo não tem payload e assinatura.');

  const pub = publicaDaMarca();
  if (!pub) morrer('chaveEntitlementPublica vazia na marca. Rode "gerar" e cole a pública no marca-*.json.');

  let confere = false;
  let claims = null;
  try {
    const chave = crypto.createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
    const corpo = deB64url(payload);
    confere = crypto.verify(null, corpo, chave, deB64url(assinatura));
    claims = JSON.parse(corpo.toString('utf8'));
  } catch (e) {
    morrer('não consegui conferir: ' + e.message);
  }

  console.log('');
  console.log('  Assinatura: ' + (confere ? 'CONFERE' : 'NÃO CONFERE'));
  console.log('  Claims    : ' + JSON.stringify(claims));
  if (confere && claims && typeof claims.offlineUntil === 'number') {
    console.log('  Offline até: ' + new Date(claims.offlineUntil).toISOString());
  }
  console.log('');
  if (!confere) process.exit(1);
}

// ── assinar (para teste local, sem subir a function) ─────────────────────
// assinar <claims.json>  -> imprime { payload, assinatura } igual ao da Edge Function.
// Serve para provar a ponta a ponta antes do deploy ("não faço deploy sem testar").
function assinar(caminhoClaims) {
  if (!caminhoClaims) morrer('informe as claims: node ferramentas/chave-entitlement.js assinar claims.json');
  if (!fs.existsSync(PRIVADA)) morrer('chave privada não encontrada em ' + PRIVADA + '\n  Rode "gerar" antes.');
  const claims = lerJson(caminhoClaims);
  if (!claims || claims.v !== 1 || !Number.isInteger(claims.uid)) morrer('claims precisam de v:1 e uid inteiro.');

  const priv = crypto.createPrivateKey({
    key: Buffer.from(fs.readFileSync(PRIVADA, 'utf8').trim(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const corpo = Buffer.from(JSON.stringify(claims), 'utf8');
  const assinatura = crypto.sign(null, corpo, priv);

  const saida = { payload: b64url(corpo), assinatura: b64url(assinatura) };

  // Autoconferência: se a pública derivada da privada não validar, é melhor falhar
  // agora do que emitir licença que todo app vai recusar.
  const pubDerivada = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const ok = crypto.verify(null, corpo, crypto.createPublicKey({ key: pubDerivada, format: 'der', type: 'spki' }), assinatura);
  if (!ok) morrer('a assinatura que acabei de gerar não confere. Nada foi emitido.');

  const pubDaMarca = publicaDaMarca();
  if (pubDaMarca && pubDaMarca !== pubDerivada.toString('base64')) {
    console.error('');
    console.error('  AVISO: esta privada NÃO corresponde a chaveEntitlementPublica da marca.');
    console.error('  O app vai recusar toda licença emitida por ela.');
  }

  console.log(JSON.stringify(saida, null, 2));
}

const CMD = (process.argv[2] || '').toLowerCase();
if (CMD === 'gerar') gerar();
else if (CMD === 'publica') {
  const pub = publicaDaMarca();
  if (!pub) morrer('chaveEntitlementPublica vazia na marca-*.json. Rode "gerar" antes.');
  console.log(pub);
} else if (CMD === 'secret') secret();
else if (CMD === 'verificar') verificar(process.argv[3]);
else if (CMD === 'assinar') assinar(process.argv[3]);
else {
  console.log('');
  console.log('  node ferramentas/chave-entitlement.js gerar              cria o par de chaves da licença');
  console.log('  node ferramentas/chave-entitlement.js publica            imprime a pública da marca');
  console.log('  node ferramentas/chave-entitlement.js secret             imprime o segredo + SQL');
  console.log('  node ferramentas/chave-entitlement.js assinar claims.json assina localmente (teste)');
  console.log('  node ferramentas/chave-entitlement.js verificar licenca.json confere como o app confere');
  console.log('');
}

module.exports = { b64url, deB64url, sqlDoSecret };
