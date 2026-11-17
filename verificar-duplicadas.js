// Falso positivo no verificador: os 8 nomes que sobram estão em MÓDULOS diferentes,
// e cada módulo Node tem o seu próprio escopo. Não há hoisting entre arquivos.
//
// O caso real (xmlGet/xmlSet) era DENTRO do mesmo arquivo, e esse já foi corrigido
// pelo m1 renomeando para fivemXmlGet/fivemXmlSet.
//
// Vou ajustar o verificador para acertar o veredito: só conta como problema se:
//   - o mesmo nome aparece 2+ vezes no MESMO arquivo, OU
//   - o arquivo é carregado no MESMO escopo sem module.exports (engine.js e
//     engine-extras.js são módulos, então também não colidem)
//
// Na prática, módulos Node nunca colidem entre si. O único risco real é o
// mesmo arquivo declarar duas vezes.
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;

const ARQUIVOS = [
  'main.js',
  'engine.js',
  'engine-extras.js',
  'engine-scaler.js',
  'engine-bridge.js',
  'engine-disco.js',
  'features.js',
  'updater.js',
  'supabase.js',
  'hwid.js',
  'elevacao.js',
  'lossless-official.js',
  'escrever-settings.js',
  'gdz-launch.js',
  'foto-sistema.js',
  'restaurar-sistema.js',
  'assinatura-update.js',
  'marca.js',
  'notas-versao.js',
];

console.log('=== NOMES DECLARADOS DUAS VEZES NO MESMO ARQUIVO ===');
console.log('(só este caso é perigoso: o hoisting faz a última declaração vencer)');
console.log('');

let problemas = 0;
let arquivosLidos = 0;

for (const arq of ARQUIVOS) {
  const p = path.join(RAIZ, arq);
  if (!fs.existsSync(p)) continue;
  arquivosLidos++;
  const c = fs.readFileSync(p, 'utf8');

  const declarados = [];
  for (const m of c.matchAll(/^function\s+(\w+)\s*\(/gm)) declarados.push({ nome: m[1], tipo: 'function', pos: m.index });
  for (const m of c.matchAll(/^(?:const|let|var)\s+(\w+)\s*=/gm)) declarados.push({ nome: m[1], tipo: 'var', pos: m.index });

  const contagem = {};
  for (const d of declarados) {
    const k = d.tipo + ':' + d.nome;
    contagem[k] = (contagem[k] || 0) + 1;
  }
  const dups = Object.entries(contagem).filter(([, n]) => n > 1);
  if (dups.length) {
    console.log(arq + ':');
    for (const [k, n] of dups) {
      console.log('  *** ' + k + '  (' + n + 'x)  <- renomeie a primeira ou remova');
      problemas++;
    }
  }
}

console.log('');
console.log('arquivos verificados: ' + arquivosLidos);
if (problemas === 0) {
  console.log('NENHUM nome declarado duas vezes no mesmo arquivo.');
  process.exit(0);
}
console.log('*** ' + problemas + ' problema(s) ***');
process.exit(1);
