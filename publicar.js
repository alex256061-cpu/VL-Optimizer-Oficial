// ══════════════════════════════════════════════════════════════════════════
// publicar.js — o trabalho pesado da publicação.
//
// Fica em JS porque quase tudo aqui é JSON, regex e HTTP. O PowerShell só chama este
// arquivo; assim não há armadilha de aspa, de `$` ou de backtick em string.
//
// Uso:
//   node publicar.js 1.4.18              publica tudo
//   node publicar.js 1.4.18 --pular-site não faz deploy do site
//   node publicar.js 1.4.18 --seco       só confere a sintaxe e para
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const RAIZ = 'C:\\Users\\lucas larado\\Desktop\\vlotimizeroficial';
const SITE = path.join(RAIZ, 'site');
const UPD = path.join(SITE, 'atualizacoes');
const REPO = 'alex256061-cpu/VL-Optimizer-Oficial';

const args = process.argv.slice(2);
const versao = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const PULAR_SITE = args.includes('--pular-site');
const SECO = args.includes('--seco');

function passo(n, msg) {
  console.log('');
  console.log('[' + n + '] ' + msg);
}
function ok(msg) { console.log('    ' + msg); }
function parar(msg) { console.log(''); console.log('  ERRO: ' + msg); process.exit(1); }

if (!versao) parar('passe a versao, por exemplo: node publicar.js 1.4.18');

console.log('');
console.log('===============================================');
console.log(' VL Optimizer — publicar ' + versao);
console.log('===============================================');

// ── 1. sintaxe ────────────────────────────────────────────────────────────
passo(1, 'Conferindo a sintaxe do codigo');
const arquivos = [
  'main.js', 'preload.js', 'engine.js', 'engine-extras.js', 'engine-scaler.js',
  'engine-bridge.js', 'updater.js', 'assinatura-update.js', 'supabase.js', 'hwid.js', 'lossless-official.js',
  'escrever-settings.js', 'gdz-launch.js', 'features.js', 'elevacao.js', 'notas-versao.js',
  // Os novos: a fotografia do estado e o desfazer dos 8 tipos.
  'foto-sistema.js', 'telemetria.js', 'restaurar-sistema.js',
];
let erros = 0;
for (const f of arquivos) {
  const p = path.join(RAIZ, f);
  if (!fs.existsSync(p)) { console.log('    falta: ' + f); continue; }
  try {
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
  } catch (e) {
    console.log('    ERRO em ' + f);
    console.log('    ' + String(e.stderr || '').split('\n').slice(0, 4).join('\n    '));
    erros++;
  }
}
if (erros) parar(erros + ' arquivo(s) com erro. Nada foi publicado.');
ok('todos OK');

// ── 1b. cards da tela x ações do motor ───────────────────────────────────
//
// O QUE ESTE PASSO IMPEDE
//   O projeto ficou preso num ciclo: uma opção era implementada, quebrava, era
//   removida do motor, mas o CARD continuava na tela. O cliente via o card,
//   clicava e recebia "ação desconhecida". Depois, semanas adiante, alguém
//   comparava com o programa de referência, via "falta essa opção" e
//   reimplementava do zero — sem saber que já tinha sido removida de propósito.
//
//   O verificar-cards.js confere duas coisas:
//     A) nenhum card aponta para ação inexistente
//     B) nenhuma remoção já decidida voltou sem liberação explícita
passo('1b', 'Conferindo os cards da tela x as ações do motor');
try {
  execFileSync(process.execPath, [path.join(RAIZ, 'verificar-cards.js'), '--falhar'], { stdio: 'inherit' });
  ok('cards conferidos');
} catch (e) {
  parar('Há card na tela sem ação no motor, ou uma opção removida voltou. Nada foi publicado.');
}

// ── 1c. o pacote tem tudo que o código pede? ─────────────────────────────
//
// O QUE ESTE PASSO IMPEDE
//   A 1.4.47 foi publicada QUEBRADA: o gerar-build restaurou uma cópia antiga do
//   projeto e 9 arquivos exigidos por require() saíram do files[] do
//   electron-builder.json. O app não abria (require('./foto-sistema') sem try/catch).
//
//   O verificar-packaging já existia, mas saía com exit 1 por falsos positivos
//   (arquivos de build e arquivos que o app apenas GRAVA) e por isso nunca foi
//   ligado. Agora ele distingue leitura de escrita e conhece as exceções — passa
//   limpo — e vira trava de build.
passo('1c', 'Conferindo se o pacote tem todos os arquivos que o código pede');
try {
  execFileSync(process.execPath, [path.join(RAIZ, 'verificar-packaging.js')], { stdio: 'inherit' });
  ok('pacote conferido');
} catch (e) {
  parar('O pacote não tem algum arquivo que o código carrega. Nada foi publicado.');
}

// ── 2. versão ─────────────────────────────────────────────────────────────
passo(2, 'Atualizando a versao para ' + versao);
const pkgPath = path.join(RAIZ, 'package.json');
// JSON.parse recusa o BOM que o PowerShell grava com Set-Content -Encoding UTF8.
// Tirar o BOM na leitura e nunca escrever de volta.
let pkgBruto = fs.readFileSync(pkgPath, 'utf8');
if (pkgBruto.charCodeAt(0) === 0xFEFF) pkgBruto = pkgBruto.slice(1);
const pkg = JSON.parse(pkgBruto);
const atual = pkg.version;
pkg.version = versao;
// preserva a formatação (4 espaços, como o electron-builder escreveu)
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
ok(atual + ' -> ' + versao);

// ── 3. LEIA-ME ────────────────────────────────────────────────────────────
passo(3, 'Atualizando o LEIA-ME');
const leiaPath = path.join(RAIZ, 'LEIA-ME.txt');
let leia = fs.readFileSync(leiaPath, 'utf8');
leia = leia.replace(/Instalar-VL-Optimizer-[\d.]+\.exe/g, 'Instalar-VL-Optimizer-' + versao + '.exe');
fs.writeFileSync(leiaPath, leia, 'utf8');
ok('instalador citado: Instalar-VL-Optimizer-' + versao + '.exe');

// ── notas da versão ───────────────────────────────────────────────────────
const notasSrc = fs.readFileSync(path.join(RAIZ, 'notas-versao.js'), 'utf8');
if (!notasSrc.includes("'" + versao + "'")) {
  console.log('');
  console.log('    AVISO: nao existe texto em notas-versao.js para a ' + versao + '.');
  console.log('    O cartao de atualizacao vai mostrar o corpo do release.');
  console.log('    Para escrever o texto do cliente, acrescente em notas-versao.js:');
  console.log("      '" + versao + "': { corrigido: [...], novo: [...] },");
}
const NOTAS = require(path.join(RAIZ, 'notas-versao.js'));
const notas = NOTAS.notasDe(versao);

if (SECO) {
  console.log('');
  console.log('  --seco: parando aqui (nada foi buildado nem publicado).');
  process.exit(0);
}

// ── 4. build ──────────────────────────────────────────────────────────────
passo(4, 'Buildando o instalador');
const releaseDir = path.join(RAIZ, 'release');
fs.rmSync(releaseDir, { recursive: true, force: true });
try {
  // No Windows um .cmd não roda direto por execFile: precisa de shell.
  // (Foi o que fez o build "falhar" sem mensagem: o erro era ENOENT do .cmd.)
  execSync('"' + path.join(RAIZ, 'node_modules\\.bin\\electron-builder.cmd') + '" --win nsis --x64 --publish never', {
    cwd: RAIZ, stdio: 'pipe', encoding: 'utf8',
  });
} catch (e) {
  const saida = (String(e.stdout || '') + String(e.stderr || '')).trim();
  parar('o build falhou:\n' + (saida || String(e.message || e)));
}
const setup = path.join(releaseDir, 'Instalar-VL-Optimizer-' + versao + '.exe');
if (!fs.existsSync(setup)) parar('o build nao gerou o instalador');
ok('Instalar-VL-Optimizer-' + versao + '.exe  ' + Math.round(fs.statSync(setup).size / 1048576) + ' MB');

// ── 4b. assinatura Ed25519 do instalador ──────────────────────────────────
//
// O electron-updater já confere o sha512 deste .exe contra o latest.yml. Isso não
// protege contra alguém trocar os DOIS juntos (o hash do yml acompanha o arquivo).
// A assinatura abaixo é feita com a chave privada, que não fica no site — é ela que
// o app confere em assinatura-update.js antes de liberar o "Instalar".
//
// Sem chave privada o publish NÃO para: avisa e segue. Assim o fluxo de hoje
// continua funcionando enquanto o dono não gerar a chave.
passo('4b', 'Assinando o instalador');
const arqPrivada = process.env.VL_RELEASE_KEY_FILE || 'C:\\VLTemp\\vl-release-private.key';
let assinou = false;
if (!fs.existsSync(arqPrivada)) {
  console.log('    AVISO: sem chave privada em ' + arqPrivada);
  console.log('    A atualizacao sai SEM assinatura. O app ainda instala enquanto');
  console.log('    "chaveReleasePublica" estiver vazia em marca/marca-vl.json.');
  console.log('    Para ligar a protecao: node ferramentas/chave-atualizacao.js gerar');
} else {
  try {
    const crypto = require('crypto');
    const priv = crypto.createPrivateKey({
      key: Buffer.from(fs.readFileSync(arqPrivada, 'utf8').trim(), 'base64'),
      format: 'der', type: 'pkcs8',
    });
    // SHA-512 do arquivo inteiro. `crypto.hash` é síncrono (Node 21+) — aqui é um
    // script de build, não há por que complicar com stream.
    const digest = crypto.hash('sha512', fs.readFileSync(setup), 'buffer');
    const sig = crypto.sign(null, digest, priv).toString('base64');
    // a assinatura tem de validar com a MESMA pública que vai embutida no app
    const publicaMarca = String(require(path.join(RAIZ, 'marca.js')).chaveReleasePublica || '').trim();
    if (publicaMarca) {
      const okSig = crypto.verify(null, digest,
        crypto.createPublicKey({ key: Buffer.from(publicaMarca, 'base64'), format: 'der', type: 'spki' }),
        Buffer.from(sig, 'base64'));
      if (!okSig) parar('a chave privada de ' + arqPrivada + ' NAO corresponde a "chaveReleasePublica" de marca.js.\n' +
        '  Publicar assim mandaria uma atualizacao que todo app instalado recusaria.');
    } else {
      console.log('    AVISO: marca.js sem chaveReleasePublica — a assinatura sera gerada');
      console.log('    mas nenhum app instalado vai conferi-la.');
    }
    fs.writeFileSync(path.join(releaseDir, 'Instalar-VL-Optimizer-' + versao + '.exe.sig'), sig, 'utf8');
    ok('assinatura gerada (' + sig.length + ' chars base64)');
    assinou = true;
  } catch (e) {
    parar('nao consegui assinar o instalador: ' + e.message);
  }
}

// ── 5. GitHub ─────────────────────────────────────────────────────────────
passo(5, 'Publicando o release no GitHub');
const cred = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
const token = (cred.match(/password=(.+)/) || [])[1];
if (!token) parar('nao consegui pegar o token do GitHub');
const tk = token.trim();

async function api(url, opts) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + tk,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...((opts && opts.headers) || {}),
    },
  });
  return r;
}

(async () => {
  // texto do release a partir das notas
  let corpoNotas = '';
  if (notas) {
    const linhas = [];
    if ((notas.novo || []).length) {
      linhas.push('### Novo');
      linhas.push(...notas.novo.map((x) => '- ' + x));
    }
    if ((notas.corrigido || []).length) {
      linhas.push('### Corrigido');
      linhas.push(...notas.corrigido.map((x) => '- ' + x));
    }
    corpoNotas = linhas.join('\n');
  }
  const corpo = {
    tag_name: 'v' + versao,
    name: 'VL Optimizer ' + versao,
    draft: false,
    prerelease: false,
    body: '## VL Optimizer ' + versao + '\n\n' + (corpoNotas || '### O que mudou\n\n' + NOTAS.resumoDe(notas)) +
      '\n\n### Instalacao\n\nBaixe em https://vl-optimizer.pages.dev/baixar',
  };

  let rel;
  let r = await api('https://api.github.com/repos/' + REPO + '/releases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  if (r.ok) {
    rel = await r.json();
  } else {
    // já existe
    r = await api('https://api.github.com/repos/' + REPO + '/releases/tags/v' + versao);
    if (!r.ok) parar('nao consegui criar nem achar o release (' + r.status + ')');
    rel = await r.json();
  }
  ok('release: ' + rel.html_url);

  // remove assets com o mesmo nome (evita 422) e envia os novos
  const existentes = await (await api('https://api.github.com/repos/' + REPO + '/releases/' + rel.id + '/assets')).json();
  for (const f of [setup, path.join(releaseDir, 'latest.yml')]) {
    const nome = path.basename(f);
    for (const a of existentes) {
      if (a.name === nome) {
        await api('https://api.github.com/repos/' + REPO + '/releases/assets/' + a.id, { method: 'DELETE' });
      }
    }
    const dados = fs.readFileSync(f);
    const up = await fetch(
      'https://uploads.github.com/repos/' + REPO + '/releases/' + rel.id + '/assets?name=' + encodeURIComponent(nome),
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/octet-stream' },
        body: dados,
      }
    );
    if (!up.ok) parar('falha ao enviar ' + nome + ' (' + up.status + ')');
    const j = await up.json();
    ok('asset: ' + j.name + '  ' + Math.round(j.size / 1048576) + ' MB');
  }

  // ── 6. latest.yml para o site ───────────────────────────────────────────
  passo(6, 'Atualizando o manifesto do site');
  fs.mkdirSync(UPD, { recursive: true });
  for (const a of fs.readdirSync(UPD)) {
    if (a.toLowerCase().endsWith('.exe')) fs.rmSync(path.join(UPD, a), { force: true });
  }
  fs.copyFileSync(path.join(releaseDir, 'latest.yml'), path.join(UPD, 'latest.yml'));
  ok('site\\atualizacoes\\latest.yml');
  console.log('      ' + fs.readFileSync(path.join(UPD, 'latest.yml'), 'utf8').split('\n').slice(0, 2).join('\n      '));

  // ── 6b. assinatura para o site ──────────────────────────────────────────
  //
  // Vai para site\atualizacoes\assinatura\<versao>.sig. A Function
  // site/functions/atualizacoes/assinatura/[[versao]].js serve isso como
  // { signature } em GET /atualizacoes/assinatura/<versao> — que é o endpoint
  // que o app consulta antes de liberar a instalação.
  if (assinou) {
    const pastaSig = path.join(UPD, 'assinatura');
    fs.mkdirSync(pastaSig, { recursive: true });
    // limpa .sig de versões antigas: o app só pede a versão que está baixando,
    // e manter o histórico só incha o pacote do site.
    for (const a of fs.readdirSync(pastaSig)) {
      if (a.toLowerCase().endsWith('.sig') && a !== versao + '.sig') {
        fs.rmSync(path.join(pastaSig, a), { force: true });
      }
    }
    fs.copyFileSync(
      path.join(releaseDir, 'Instalar-VL-Optimizer-' + versao + '.exe.sig'),
      path.join(pastaSig, versao + '.sig')
    );
    ok('site\\atualizacoes\\assinatura\\' + versao + '.sig');
  } else {
    console.log('    (sem assinatura: nada publicado em atualizacoes/assinatura)');
  }

  // ── 7. deploy ───────────────────────────────────────────────────────────
  if (!PULAR_SITE) {
    passo(7, 'Fazendo o deploy do site');
    let saida = '';
    try {
      // wrangler também é .cmd: roda por shell, como o electron-builder.
      saida = execSync(
        '"' + path.join(RAIZ, 'node_modules\\.bin\\wrangler.cmd') + '" pages deploy . --project-name=vl-optimizer --branch=main --commit-dirty=true',
        { cwd: SITE, encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (e) {
      saida = String(e.stdout || '') + String(e.stderr || '');
    }
    const url = (saida.match(/https:\/\/[a-z0-9]+\.vl-optimizer\.pages\.dev/) || [])[0];
    if (url) ok('deploy: ' + url);
    else console.log('    AVISO: nao consegui ler a URL do deploy');
  } else {
    passo(7, 'Deploy do site PULADO (--pular-site)');
  }

  // ── 8. área de trabalho ─────────────────────────────────────────────────
  passo(8, 'Copiando o instalador para a Area de Trabalho');
  const desktop = path.join(process.env.USERPROFILE, 'Desktop');
  for (const a of fs.readdirSync(desktop)) {
    if (/^Instalar-VL-Optimizer-[\d.]+\.exe$/i.test(a)) fs.rmSync(path.join(desktop, a), { force: true });
  }
  fs.copyFileSync(setup, path.join(desktop, 'Instalar-VL-Optimizer-' + versao + '.exe'));
  ok('Instalar-VL-Optimizer-' + versao + '.exe');

  console.log('');
  console.log('===============================================');
  console.log(' PRONTO — ' + versao + ' publicada');
  console.log('===============================================');
  console.log('  Cliente baixa de: https://vl-optimizer.pages.dev/baixar');
  console.log('  App atualiza de:  https://vl-optimizer.pages.dev/atualizacoes');
  console.log('');
  console.log('  Nao esqueca o commit do codigo:');
  console.log('    git commit -am "v' + versao + '" ; git push');
  console.log('');
})().catch((e) => parar(String(e && e.message || e)));
