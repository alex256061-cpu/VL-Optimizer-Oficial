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
    // REIMPLEMENTADA NA 1.4.61, com prova.
    //
    // O defeito era a struct: 6 inteiros (24 bytes) no lugar dos 156 da DEVMODEA. O
    // driver recebia lixo em dmPelsWidth.
    //
    // Como ficou: struct DEVMODEA completa (156 bytes, conferida com
    // Marshal.SizeOf em tempo de execução), CDS_TEST antes de aplicar (se a tela
    // não aceitar 1280x720, nada muda), conferência da resolução real depois de
    // aplicar e restauração automática se não mudou. A resolução anterior fica em
    // HKCU\Software\VLOptimizer (chave nossa, não a do GDZ).
    //
    // Prova em 19/11/2026 nesta máquina: 1920x1080 -> 1280x720 aplicado, PrevResW
    // gravada 1920, revert devolveu 1920x1080. CDS_TEST para 1280x720 = 0; para
    // modo inválido = -2 (BADMODE), e a tela não mudou.
    liberado: true,
  },
  {
    nome: 'Efeitos Visuais Off',
    versao: '1.4.31',
    motivo: 'O Windows ignora a chave quando o ajuste é por script: não fazia efeito, e o desfazer apagava a configuração que o cliente já tinha.',
    // REIMPLEMENTADA NA 1.4.61, com prova.
    //
    // O defeito era o desfazer: o revert do GDZ NÃO devolve o valor que o cliente
    // tinha — ele grava uma máscara FIXA de fábrica (0x9E,0x1E,0x07,0x80,0x12) por
    // cima do que estava lá. A nossa versão antiga copiou esse desfazer.
    //
    // Como ficou: as duas chaves (VisualFXSetting e UserPreferencesMask) estão em
    // `regs`, então o runAction arquiva o valor atual antes de aplicar e o
    // revertAction restaura o arquivado. A máscara ao aplicar é a do GDZ
    // (0x90,0x12,0x03,0x80,0x10); o fallback sem backup usa a de fábrica do GDZ
    // (0x9E,0x1E,0x07,0x80,0x12) e só roda quando o estado atual é exatamente o que
    // a ação grava — se o cliente já tinha configurado por conta própria, o VL recusa
    // o desfazer em vez de apagar a configuração dele.
    //
    // Prova em 19/11/2026 nesta máquina, partindo do estado do dono (VisualFXSetting=3
    // e máscara 9E 1E 03 80 12 00 00 00): aplicar -> 2 e 90 12 03 80 10 00 00 00;
    // desfazer -> 3 e 9E 1E 03 80 12 00 00 00, byte a byte. E desfazer SEM ter
    // aplicado recusa e deixa a máscara do dono intacta.
    liberado: true,
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
// FIX e TOOL também são cards clicáveis. O auditor s1 achou os 4 botões "Religar"
// mortos justamente porque esta verificação não olhava o tipo 'fix'.
const cardsFIX = [...otim.matchAll(/\bFIX\('([^']+)'/g)].map((m) => m[1]);
const cardsTOOL = [...otim.matchAll(/\bTOOL\('([^']+)'/g)].map((m) => m[1]);

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
// FIX: o botão chama 'run-action', que roteia ONCES -> runOnce. Então o nome
// precisa existir em ONCES OU em ACTIONS. Se não existir em nenhum, o clique
// devolve "ação desconhecida" — foi o que aconteceu com os 4 botões "Religar".
for (const nome of cardsFIX) {
  if (!ONCES.has(nome.toLowerCase()) && !ACOES.has(nome.toLowerCase())) {
    problemas.push('CARD FIX SEM AÇÃO: "' + nome + '" — o botão "Religar" chama run-action, mas o nome não está em ONCES nem em ACTIONS. Clicar dá "ação desconhecida".');
  }
}
// TOOL: precisa existir em TOOLS, senão o clique não roda nada.
const TOOLS = new Set(Object.keys(engine.TOOLS || {}).map((x) => x.toLowerCase()));
for (const nome of cardsTOOL) {
  if (!TOOLS.has(nome.toLowerCase())) {
    problemas.push('CARD TOOL SEM FERRAMENTA: "' + nome + '" — o botão chama tweak-tool, mas a ferramenta não existe no motor.');
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
