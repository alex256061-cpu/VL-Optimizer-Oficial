// ══════════════════════════════════════════════════════════════════════════
// MARCA — uma instalação só para todos os revendedores
//
// O dono vende o VL Optimizer e tem um revendedor que quer a versão dele: marca
// própria (nome, logo, cores), e infraestrutura própria (GitHub, Supabase, Cloudflare).
//
// Copiar o projeto e trocar as logos foi descartado: em poucas semanas seriam dois
// códigos divergentes e toda correção teria de ser feita duas vezes. Aqui o código é o
// mesmo; o que muda por cliente é só o arquivo de marca.
//
// ESTRUTURA
//
//   marca/marca-vl.json        <- a nossa (padrão quando nada é pedido)
//   marca/marca-<cliente>.json <- a de cada revendedor (não vai para o git)
//
//   marca.js                   <- carrega o JSON e devolve os valores prontos
//
// Como escolher a marca:
//   1. variável de ambiente VL_MARCA=<cliente>
//   2. marca/ATIVA.txt (gravado pelo publicar.ps1 durante o build)
//   3. "vl" (a nossa)
//
// O QUE CADA MARCA DEFINE
//
//   nome            nome que o cliente vê ("VL Optimizer")
//   nomeCurto       usado no executável e na tarefa ("VLOptimizer", "OptimizerPro")
//   appId           identificador do instalador (com.marca.app)
//   pasta           pasta de dados em %APPDATA% ("VL Optimizer")
//   modelo          prefixo do instalador ("Instalar-VL-Optimizer")
//   supabase.url    projeto Supabase DESTE cliente
//   supabase.anon   chave publicável (vai no app de qualquer forma; o que protege
//                   os dados é a RLS no banco)
//   site            domínio do site dele (Cloudflare Pages)
//   github.owner    dono do repositório (para os releases)
//   github.repo     nome do repositório
//   assets          pasta com icon.png / icon.ico / logo.png / logo-branco.png
//
// Tudo que hoje está fixo no código passa a ler daqui. O padrão é a nossa marca, então
// nada muda para quem já usa o VL.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const DIR_MARCA = path.join(RAIZ, 'marca');

// A nossa marca, usada sempre que nada mais é pedido.
const PADRAO = {
  nome: 'VL Optimizer',
  nomeCurto: 'VLOptimizer',
  appId: 'com.vl.optimizer',
  pasta: 'VL Optimizer',
  modelo: 'Instalar-VL-Optimizer',
  supabase: {
    url: 'https://wsmropvlmnyegpvmyndn.supabase.co',
    anon: 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o',
  },
  site: 'https://vl-optimizer.pages.dev',
  github: { owner: 'alex256061-cpu', repo: 'VL-Optimizer-Oficial' },
  assets: 'assets',
  cores: { principal: '#c8101f', secundaria: '#050506' },
  // Assinatura da atualização (ver assinatura-update.js e ferramentas/chave-atualizacao.js).
  //
  // chaveReleasePublica: Ed25519 em DER/SPKI base64. Vazia = verificação DESLIGADA
  // (o app registra "sem-chave" no estado, não finge que protege). Cada revendedor
  // usa a PRÓPRIA chave — é por marca, não por produto.
  //
  // assinaturaModo: 'obrigatorio' (igual ao GDZ: sem assinatura não instala) ou
  // 'opcional' (site sem assinatura publicada não trava a atualização).
  chaveReleasePublica: '',
  assinaturaModo: 'obrigatorio',
};

// Qual marca usar.
function qual() {
  const env = String(process.env.VL_MARCA || '').trim();
  if (env) return limpar(env);
  try {
    const ativa = limpar(fs.readFileSync(path.join(DIR_MARCA, 'ATIVA.txt'), 'utf8'));
    // "usada" é o nome do ARQUIVO que vai no pacote, não o nome de uma marca. Já apareceu
    // gravado aqui por engano e derrubava o app na abertura.
    if (ativa && ativa !== 'usada') return ativa;
  } catch (e) { }
  return 'vl';
}

// Nome de marca em forma segura: minúsculo, só letras/números/_/-
function limpar(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

// Lê o JSON da marca e completa o que faltar com o padrão.
function carregar(nomeMarca) {
  const nome = nomeMarca || qual();

  // No APP INSTALADO só existe um arquivo de marca: marca/usada.json, escrito pelo
  // gerar-build.js na hora do build. As marcas dos outros revendedores NÃO vão para o
  // pacote — o cliente de um não pode ver os dados do outro.
  //
  // Mas no FONTE (onde o gerar-build roda) existem as duas coisas: usada.json (do último
  // build) e marca-vl.json. Quem manda é o ATIVA.txt, gravado no fim de cada build.
  //
  // Antes eu checava o usada.json primeiro sempre que o nome era "vl", e aí um build de
  // revendedor seguido de "node gerar-build.js vl" continuava com a marca do revendedor.
  const usada = path.join(DIR_MARCA, 'usada.json');
  const ativa = path.join(DIR_MARCA, 'ATIVA.txt');
  const ehFonte = fs.existsSync(ativa) && fs.existsSync(path.join(RAIZ, 'gerar-build.js'));
  if (!ehFonte) {
    try { return montar(JSON.parse(fs.readFileSync(usada, 'utf8')), 'usada'); } catch (e) { }
  }

  let dados = {};
  const arq = path.join(DIR_MARCA, 'marca-' + nome + '.json');
  try {
    dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch (e) {
    if (nome !== 'vl') {
      // Marca pedida e não encontrada: não seguir com a nossa em silêncio — o build
      // sairia com o nome errado e o cliente receberia o produto de outra pessoa.
      throw new Error('marca "' + nome + '" nao encontrada em ' + arq);
    }
  }
  return montar(dados, nome);
}

// Monta o objeto final (padrão + dados + URLs derivadas).
function montar(dados, nome) {
  const m = {
    ...PADRAO,
    ...dados,
    supabase: { ...PADRAO.supabase, ...(dados.supabase || {}) },
    github: { ...PADRAO.github, ...(dados.github || {}) },
    cores: { ...PADRAO.cores, ...(dados.cores || {}) },
    marca: nome,
  };
  // aceita as duas grafias
  if (dados.supabase && dados.supabase.anonKey && !dados.supabase.anon) m.supabase.anon = dados.supabase.anonKey;
  m.site = String(m.site || '').replace(/\/+$/, '');
  // URLs derivadas: ficam no MESMO objeto, senão carregar('demo') devolveria undefined
  // e o electron-builder.json sairia com "publish: [{provider:'generic'}]" sem url.
  m.urlAtualizacoes = m.site + '/atualizacoes';
  m.urlDownload = m.site + '/baixar';
  m.dirDados = path.join(process.env.APPDATA || require('os').homedir(), m.pasta);
  m.tarefa = m.nomeCurto;
  return m;
}

const M = carregar();

// Em qualquer falha ao ler a marca, o app não pode ficar sem nome: cai na nossa.
// (Aconteceu de o ATIVA.txt ficar com "usada" — o nome do ARQUIVO, não da marca — e o
// app quebrar ao abrir com "marca usada nao encontrada".)

// ── atalhos usados pelo app ──────────────────────────────────────────────
const ehPadrao = M.marca === 'vl';

module.exports = {
  ...M,
  ehPadrao,
  // URL do manifesto de atualização e a página de download
  urlAtualizacoes: M.site + '/atualizacoes',
  urlDownload: M.site + '/baixar',
  // pasta de dados do usuário
  dirDados: path.join(process.env.APPDATA || require('os').homedir(), M.pasta),
  // nome usado pelo Agendador de Tarefas
  tarefa: M.nomeCurto,
  carregar,
  qual,
};
