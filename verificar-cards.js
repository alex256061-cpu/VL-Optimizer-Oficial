// ══════════════════════════════════════════════════════════════════════════
// verificar-cards.js — impede o loop "implementar algo que já foi removido".
//
// O PROBLEMA (aconteceu 3 vezes nesta sessão)
//   1. Eu comparo o nosso com o GDZ e digo "falta a opção X"
//   2. Implemento X copiando do GDZ
//   3. Descubro que X já tinha sido removido de propósito porque quebrou
//   4. Removo X
//   5. Semana seguinte, o passo 1 acontece de novo
//
// Isso aconteceu com: 720p Boost, Efeitos Visuais Off, e quase com o Tema escuro.
//
// O QUE ESTA FERRAMENTA FAZ
//   Lê a lista de REMOÇÕES DECIDIDAS (abaixo) e verifica duas coisas:
//
//   A) Nenhum card da tela aponta para uma ação que não existe no motor
//      (isso é o que faz o cliente clicar e receber "ação desconhecida")
//
//   B) Nenhuma ação removida voltou para o motor sem ter sido liberada
//      (isso pega o "implementei de novo sem perceber")
//
// As remoções decididas vêm do notas-versao.js e dos comentários do código.
// Cada uma tem a versão em que foi removida e o motivo.
//
// USO:
//   node verificar-cards.js            -> relatório
//   node verificar-cards.js --falhar   -> sai com código 1 se achar problema
//                                        (para usar no publicar.js)
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;

// ── REMOÇÕES DECIDIDAS ──────────────────────────────────────────────────
// Cada linha: [nome da ação/ajuste, versão em que foi removida, por quê]
// "liberado: true" só quando o dono mandar reimplementar DEPOIS de provar.
const REMOVIDAS = [
  {
    nome: '720p Boost Ativo',
    versao: '1.4.31',
    motivo: 'Escria uma DEVMODE truncada e podia deixar a tela preta em notebook. Só voltava reiniciando.',
    liberado: false,
  },
  {
    nome: 'Efeitos Visuais Off',
    versao: '1.4.31',
    motivo: 'O Windows ignora a chave quando o ajuste é por script: não fazia efeito, e o desfazer apagava a configuração que o cliente já tinha.',
    liberado: false,
  },
  {
    nome: 'dlss-ind',
    versao: '1.4.31',
    motivo: 'Não existe no programa de referência (0 ocorrências no código dele).',
    liberado: false,
  },
  {
    nome: 'Desativar impressora',
    versao: '1.4.31',
    motivo: 'Desligar o Spooler quebrava a impressão de quem usa. Passou a não ser mexido.',
    liberado: false,
  },
];

// ── 1. ler o motor de verdade ──────────────────────────────────────────
process.env.LOPT_DATA_DIR = process.env.LOPT_DATA_DIR || path.join('C:', 'VLTemp', 'cards-' + Date.now());
const engine = require(path.join(RAIZ, 'engine.js'));
const ACOES = new Set(Object.keys(engine.ACTIONS || {}).map((x) => x.toLowerCase()));
const ONCES = new Set(Object.keys(engine.ONCES || {}).map((x) => x.toLowerCase()));
const TWEAKS = new Set((engine.TWEAKS || []).map((t) => String(t.id || t.title || t).toLowerCase()));

// ── 2. ler os cards da tela ────────────────────────────────────────────
const otim = fs.readFileSync(path.join(RAIZ, 'src', 'otimizacoes.js'), 'utf8');
const cardsA = [...otim.matchAll(/\bA\('([^']+)'/g)].map((m) => m[1]);
const cardsO = [...otim.matchAll(/\bO\('([^']+)'/g)].map((m) => m[1]);
const cardsT = [...otim.matchAll(/\bT\('([^']+)'/g)].map((m) => m[1]);
const cardsC = [...otim.matchAll(/\bC\('([^']+)'/g)].map((m) => m[1]);

const problemas = [];
const avisos = [];

// ── 3. A) card sem ação ────────────────────────────────────────────────
for (const nome of cardsA) {
  if (!ACOES.has(nome.toLowerCase())) {
    problemas.push('CARD SEM AÇÃO: "' + nome + '" — está na tela, mas o motor não tem a ação. Clicar dá "ação desconhecida".');
  }
}
for (const nome of cardsO) {
  if (!ONCES.has(nome.toLowerCase())) {
    problemas.push('CARD SEM ONCE: "' + nome + '" — está na tela, mas o motor não tem a ação de uma vez.');
  }
}
for (const nome of cardsT) {
  if (!TWEAKS.has(nome.toLowerCase())) {
    // T() é dica: pode citar um tweak que existe com outro nome. Só avisa.
    avisos.push('dica "' + nome + '" não bate com nenhum tweak (pode ser só texto)');
  }
}

// ── 4. B) ação removida que voltou ─────────────────────────────────────
for (const r of REMOVIDAS) {
  const voltou =
    ACOES.has(r.nome.toLowerCase()) ||
    ONCES.has(r.nome.toLowerCase()) ||
    cardsA.some((x) => x.toLowerCase() === r.nome.toLowerCase()) ||
    cardsO.some((x) => x.toLowerCase() === r.nome.toLowerCase());

  if (voltou && !r.liberado) {
    problemas.push(
      'AÇÃO REMOVIDA VOLTOU: "' + r.nome + '" foi removida na ' + r.versao + ' porque ' +
      r.motivo + '\n    Se for reimplementar, mude liberado: true neste arquivo DEPOIS de provar num PC limpo.'
    );
  }
}

// ── 5. relatório ───────────────────────────────────────────────────────
const querFalhar = process.argv.includes('--falhar');

console.log('');
console.log('=== VERIFICAÇÃO DE CARDS ===');
console.log('  cards A(): ' + cardsA.length + '  |  ações no motor: ' + ACOES.size);
console.log('  cards O(): ' + cardsO.length + '  |  onces no motor: ' + ONCES.size);
console.log('  cards T(): ' + cardsT.length);
console.log('  cards C(): ' + cardsC.length);
console.log('  remoções registradas: ' + REMOVIDAS.length);
console.log('');

if (problemas.length) {
  console.log('🔴 PROBLEMAS (' + problemas.length + '):');
  for (const p of problemas) console.log('  - ' + p);
  console.log('');
}

if (avisos.length) {
  console.log('🟡 AVISOS (' + avisos.length + '):');
  for (const a of avisos.slice(0, 10)) console.log('  - ' + a);
  if (avisos.length > 10) console.log('  ... e mais ' + (avisos.length - 10));
  console.log('');
}

if (!problemas.length) {
  console.log('✅ Nenhum card órfão. Nenhuma remoção decidida voltou.');
  console.log('');
}

if (querFalhar && problemas.length) process.exit(1);
process.exit(0);
