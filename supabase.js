// supabase.js — login, cadastro e perfil usando o Supabase.
//
// Fala direto com a API REST/GoTrue do Supabase por fetch (Node 20 tem fetch global no Electron),
// sem adicionar dependência: assim o instalador não cresce e não precisa de node_modules extra.
//
// O que é guardado no PC: o token de acesso e o de renovação. Nada de senha.
// A senha só vai para o Supabase, no login ou no cadastro.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const hwid = require('./hwid');
const extra = require('./engine-extras');
const MARCA = require('./marca');

// ── configuração ──────────────────────────────────────────────────────────
// Preencha depois de criar o projeto no supabase.com. Os dois valores são públicos
// (a chave anon vai no app de qualquer forma); o que protege os dados é a regra de
// segurança no banco, não o sigilo dessas duas strings.
const CONFIG = {
  // Projeto Supabase DESTA marca (marca/marca-<cliente>.json).
  // O env continua podendo sobrescrever, para testes.
  url: process.env.VL_SUPABASE_URL || MARCA.supabase.url,
  anonKey: process.env.VL_SUPABASE_ANON_KEY || MARCA.supabase.anon,
};

const DIR = MARCA.dirDados;
// LOPT_DATA_DIR força outra pasta de dados (testes e --shots). O engine.js já respeita a
// variável (main.js chama core.setDataDir(dataDir())); o login ficava preso em APPDATA e
// não dava para testar a sessão sem escrever na pasta real de %APPDATA%.
const DIR_SESSAO = process.env.LOPT_DATA_DIR ? path.resolve(process.env.LOPT_DATA_DIR) : DIR;
const SESSAO = path.join(DIR_SESSAO, 'sessao.json');

// ── o que o plano GRÁTIS libera (copiado do GDZ) ───────────────────────────
//
// No GDZ cada página/canal pede uma feature e o plano grátis recebe uma LISTA de
// features do servidor. Do código dele (src_plano.js + main.js):
//   páginas: dashboard=painel, jogos, fps, gargalo, hardware, pcinfo=hardware,
//            inicializacao, sobre           (todas as outras são do plano pago)
//   canais:  fps-*, measure-bottleneck/bn-*, run-check/pcinfo-*, startup-*,
//            games-*/game-clean/shader-clean
//   run-action: SÓ "Otimização Rápida" com a feature quick-opt; qualquer outra → pago
//   e o texto do upsell dele: "O plano grátis inclui o medidor de FPS, o gargalo, a
//   verificação do hardware, a inicialização, os jogos e a Otimização Rápida."
//
// O QUE ESTAVA ERRADO AQUI: o banco manda features ["painel"] para conta grátis e o
// app usava só isso. Com a lista curta, filtro de páginas e canal derrubavam FPS,
// gargalo, hardware, inicialização, jogos e a própria Otimização Rápida — ou seja, o
// plano grátis não fazia NADA do que o próprio texto promete.
//
// Completar aqui é melhor que esperar SQL rodar em cada cliente: um app antigo
// continua limitado, mas a lista do plano grátis é propriedade do app (como no GDZ, que
// aplica as features que o servidor manda). O banco pode mandar mais; nunca menos que isto.
const FEATURES_GRATIS = ['painel', 'jogos', 'fps', 'gargalo', 'hardware', 'inicializacao', 'sobre', 'quick-opt'];

// Lista final de features de uma conta. Plano pago ('*') fica como veio; grátis/vencido
// recebe a união do que o servidor mandou com o conjunto do plano grátis.
function completarFeatures(plan, lista) {
  const l = Array.isArray(lista) ? lista.filter((x) => typeof x === 'string' && x) : [];
  if (l.includes('*')) return l;
  if (plan === 'pro') return l.length ? l : FEATURES_GRATIS.slice();
  return Array.from(new Set([...l, ...FEATURES_GRATIS]));
}

// ── arquivo de sessão cifrado (mesmo esquema do GDZ: auth.bin + safeStorage) ─
//
// O GDZ grava a sessão em auth.bin cifrado com o safeStorage do Electron (DPAPI no
// Windows); nós gravávamos sessao.json em texto puro. Ver t6-scaling.md § loadAuth /
// saveAuth. A ordem de leitura tenta, nesta ordem:
//
//   1. auth.bin  cifrado        -> caminho novo
//   2. SESSAO.bin cifrado       -> cifrado, mas sem poder gravar em auth.bin
//   3. sessao.json (texto puro) -> arquivo antigo; é MIGRADO para cifrado na 1ª leitura
//
// O passo 3 é o que mantém o login de quem já usa o app: o sessao.json que está no PC
// passa a ser lido e, se for bem lido, ainda é aceito (e apagado depois que a versão
// cifrada for gravada).
const AUTH_PRINCIPAL = path.join(DIR_SESSAO, 'auth.bin');
const AUTH_ALTERNATIVO = path.join(DIR_SESSAO, 'sessao.bin');

// Cópia de segurança do arquivo de sessão principal.
//
// POR QUE EXISTE (caso real de 24/11/2026)
//   O PC do dono teve um desligamento forçado (Windows, evento 6008: "desligamento às
//   05:07:26 não era esperado"). O auth.bin tinha 2533 bytes e TODOS os bytes zero: o
//   NTFS atualizou tamanho/mtime no journal, mas os clusters de dados nunca foram
//   gravados — o arquivo ficou "oco". No boot seguinte o app não conseguia decifrar,
//   tratava como "sem sessão" e pedia login, sem explicar nada.
//
//   Gravar direto no auth.bin (fs.writeFileSync no destino final) tem exatamente essa
//   janela de risco: se a máquina cair no meio da gravação, o arquivo do login vira
//   lixo. Agora a gravação é atômica (arquivo temporário + rename) e o conteúdo
//   anterior fica numa cópia .bak. Um tombo no meio da gravação deixa OU o arquivo
//   antigo OU o novo, nunca os dois quebrados; e se o principal abrir com problema a
//   cópia salva o login.
const AUTH_BACKUP = AUTH_PRINCIPAL + '.bak';

// Tolerância do anti-rollback, literal do GDZ (refreshEntitlement).
const CLOCK_ROLLBACK_TOLERANCE_MS = 600000;

// Partes que SOBREVIVEM a uma gravação de sessão: o token vem do servidor, mas o que
// o servidor não manda (maxSeen, lastSeenAt, a última licença boa) não pode ser perdido.
// No GDZ o mesmo campo é carregado em acceptEntitlement antes de gravar; aqui é aqui.
const CAMPOS_LOCAIS = ['maxSeen', 'lastSeenAt', 'licenca', 'tokens'];

function configurado() {
  return Boolean(CONFIG.url && CONFIG.anonKey);
}

// O safeStorage só existe dentro do Electron. Fora dele (teste em node puro, ou um
// ambiente em que o Electron não o expõe) o require devolve null e tudo cai no texto
// puro — o app continua entrando, só não cifra. Nunca lança.
function safeStorageElectron() {
  try {
    const el = require('electron');
    const ss = el && el.safeStorage;
    if (ss && typeof ss.isEncryptionAvailable === 'function' && ss.isEncryptionAvailable()) return ss;
  } catch (e) { }
  return null;
}

// Grava cifrado onde der. Devolve { caminho, cifrado }.
// Mesma regra de ordem do GDZ (loadAuth): sem cifra disponível, não há sessão cifrada.
//
// A gravação é ATÔMICA: escreve num temporário e renomeia por cima. `rename` no mesmo
// volume é atômico no NTFS, então uma queda de energia no meio deixa o arquivo antigo
// intacto em vez de um auth.bin pela metade. Depois de gravar o principal, guarda a
// mesma cifra em AUTH_BACKUP (ver comentário em AUTH_BACKUP).
function gravarCifrado(texto) {
  const ss = safeStorageElectron();
  if (!ss) return { caminho: null, cifrado: false };
  let buf = null;
  try { buf = ss.encryptString(texto); } catch (e) { return { caminho: null, cifrado: false }; }
  for (const alvo of [AUTH_PRINCIPAL, AUTH_ALTERNATIVO]) {
    try {
      fs.mkdirSync(DIR_SESSAO, { recursive: true });
      const temporario = alvo + '.tmp';
      fs.writeFileSync(temporario, buf);
      fs.renameSync(temporario, alvo);
      // Cópia de segurança só do principal (o alternativo já é o plano B).
      if (alvo === AUTH_PRINCIPAL) {
        try {
          const temporarioBak = AUTH_BACKUP + '.tmp';
          fs.writeFileSync(temporarioBak, buf);
          fs.renameSync(temporarioBak, AUTH_BACKUP);
        } catch (e) { }
      }
      return { caminho: alvo, cifrado: true };
    } catch (e) { }
  }
  return { caminho: null, cifrado: false };
}

// Lê um arquivo cifrado. Devolve o objeto, `undefined` quando o arquivo não existe e
// `null` quando existe mas não abriu (cifra indisponível, arquivo de outro PC/usuário
// ou corrompido). A diferença importa: no `undefined` dá para apagar e trocar; no null
// NÃO se pode apagar, senão um auth.bin de outra conta de Windows derrubaria o login.
function lerCifrado(alvo) {
  try {
    if (!fs.existsSync(alvo)) return undefined;
    const ss = safeStorageElectron();
    if (!ss) return null; // arquivo cifrado e sem como abrir: não é texto puro
    const j = JSON.parse(ss.decryptString(fs.readFileSync(alvo)));
    if (j && j.access_token) return j;
  } catch (e) { }
  return null;
}

// Lê a sessão, com a cópia de segurança como plano B.
//
// O arquivo pode estar ilegível por queda de energia no meio da gravação (caso real:
// auth.bin inteiro zerado) ou por ter sido cifrado em outra conta do Windows. Se o
// principal não abrir mas o .bak abrir, o login do cliente é preservado — e o principal
// é reescrito a partir dele, para a próxima abertura ser rápida.
function lerSessaoCifrada() {
  const j = lerCifrado(AUTH_PRINCIPAL);
  if (j && j.access_token) return j;
  const b = lerCifrado(AUTH_BACKUP);
  if (b && b.access_token) {
    try {
      fs.copyFileSync(AUTH_BACKUP, AUTH_PRINCIPAL);
    } catch (e) { }
    return b;
  }
  return j === undefined ? undefined : null;
}

function lerSessao() {
  // Principal -> cópia de segurança (.bak) -> alternativo. Ver lerSessaoCifrada().
  const j = lerSessaoCifrada();
  if (j && j.access_token) return j;
  const alt = lerCifrado(AUTH_ALTERNATIVO);
  if (alt && alt.access_token) return alt;
  // Arquivo antigo, em texto puro.
  try {
    const t = JSON.parse(fs.readFileSync(SESSAO, 'utf8'));
    if (t && t.access_token) return t;
  } catch (e) { }
  return null;
}

// Devolve o conteúdo cru do sessao.json antigo (para desfazer a migração se o login
// falhar) ou null.
function lerSessaoTextoPuro() {
  try {
    const bruto = fs.readFileSync(SESSAO, 'utf8');
    const j = JSON.parse(bruto);
    if (j && j.access_token) return { s: j, bruto };
  } catch (e) { }
  return null;
}

// Carimba o MAIOR instante já visto neste PC (anti-rollback de relógio).
// Espelha o maxSeen do GDZ (acceptEntitlement / refreshEntitlement):
//   maxSeen = Math.max(agora, maxSeen || 0)
// No GDZ o carimbo é atualizado quando ele aceita uma licença nova e no modo offline.
// Aqui não há arquivo de licença separado da sessão, então o carimbo vive na sessão:
// toda verificação de sessão (`carimbar(s, true)`) atualiza o carimbo, e a gravação da
// sessão também faz Math.max (ver gravarSessao).
// mexer: false só informa o carimbo guardado e se o relógio está atrasado, sem gravar.
// Só o `entrar()` usa false, para ler o maxSeen antigo antes de regravar a sessão.
function carimbar(s, mexer) {
  const guardado = (s && typeof s.maxSeen === 'number' && isFinite(s.maxSeen)) ? s.maxSeen : 0;
  const agora = Date.now();
  const atrasado = !!(guardado && agora < guardado - CLOCK_ROLLBACK_TOLERANCE_MS);
  if (!mexer) return { guardado, atrasado };
  if (agora > guardado) {
    s.maxSeen = agora;
    // Grava de volta só quando o carimbo mudou de fato: o maxSeen nunca diminui, então
    // depois do primeiro carimbo do dia não há escrita em disco a cada leitura.
    gravarSessao(s);
  }
  return { guardado, atrasado };
}

function gravarSessao(s) {
  try {
    fs.mkdirSync(DIR_SESSAO, { recursive: true });
    if (!s) {
      // Inclui a cópia .bak: sem isso, "sair" apagaria o principal e a próxima abertura
      // ressuscitaria a sessão a partir do backup — o oposto de sair.
      for (const alvo of [AUTH_PRINCIPAL, AUTH_BACKUP, AUTH_ALTERNATIVO, SESSAO]) {
        try { if (fs.existsSync(alvo)) fs.unlinkSync(alvo); } catch (e) { }
      }
      return;
    }
    // Uma gravação da sessão não pode apagar o que o servidor não manda de volta
    // (maxSeen, lastSeenAt, última licença boa). Vale também quando `s` é o objeto LIDO
    // do sessao.json e `s` ainda não tem maxSeen nenhum.
    let anterior = null;
    try { anterior = lerSessao(); } catch (e) { }
    const base = (anterior && anterior.access_token === s.access_token) ? anterior : s;
    for (const k of CAMPOS_LOCAIS) {
      if (base && base[k] !== undefined && s[k] === undefined) s[k] = base[k];
    }
    s.maxSeen = Math.max(Date.now(), Number(s.maxSeen) || 0);
    s.lastSeenAt = Date.now();

    const texto = JSON.stringify(s);
    const r = gravarCifrado(texto);
    if (r.cifrado) {
      // Migrou: o texto puro antigo não fica no disco.
      try { if (fs.existsSync(SESSAO)) fs.unlinkSync(SESSAO); } catch (e) { }
    } else {
      fs.writeFileSync(SESSAO, texto, 'utf8');
    }
  } catch (e) { }
}

// Teto de qualquer chamada ao servidor (o GDZ usa API_TIMEOUT_MS = 12000).
const TIMEOUT_MS = 12000;

async function pedir(caminho, opcoes) {
  const o = Object.assign({}, opcoes);
  o.headers = Object.assign(
    {
      'Content-Type': 'application/json',
      apikey: CONFIG.anonKey,
      Authorization: 'Bearer ' + (o.token || CONFIG.anonKey),
    },
    o.headers || {}
  );
  if (o.token) delete o.token;
  delete o.token;

  const url = CONFIG.url.replace(/\/$/, '') + caminho;

  // Sem rede, servidor fora do ar ou DNS errado, o fetch rejeita. Isso não pode subir como
  // exceção e fechar o app: vira um resultado tratado, que a tela mostra em português.
  // `semRede` separa "não houve resposta" de "o servidor respondeu errado" — é o `offline`
  // do apiCall do GDZ (t6-scaling.md). O modo offline depende dessa diferença.
  // 12 s é o teto do programa de referência (API_TIMEOUT_MS). Sem isto, um
  // servidor que aceita a conexão e não responde deixava o login pendurado.
  let r;
  try {
    const sinal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(o.timeoutMs || TIMEOUT_MS)
      : undefined;
    if (sinal) o.signal = sinal;
    delete o.timeoutMs;
    r = await fetch(url, o);
  } catch (e) {
    // AbortSignal.timeout não gera ETIMEDOUT: gera um AbortError com
    // "The operation was aborted due to timeout" (medido pela auditoria n2). Sem
    // tratar esse caso, o cliente lia na tela de login
    // "Falha ao conectar: The operation was aborted due to timeout", em inglês.
    const nome = String((e && e.name) || '');
    const texto = String((e && e.message) || '');
    const estourou = nome === 'TimeoutError' || nome === 'AbortError' || /aborted due to timeout/i.test(texto);
    const semRede = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET|fetch failed/i.test(texto);
    return {
      ok: false,
      offline: true,
      status: 0,
      dados: {
        message: estourou
          ? 'O servidor demorou demais para responder. Confira sua internet e tente de novo.'
          : (semRede ? 'Sem conexão com o servidor. Verifique sua internet.' : 'Não foi possível falar com o servidor agora. Tente de novo em instantes.'),
      },
    };
  }

  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = { raw: texto }; }
  // O apiCall do GDZ considera offline qualquer 5xx (o `fetch` do Chromium não rejeita em
  // 500 como o do Node). Aqui 5xx vira offline do mesmo jeito; 404 é licença inexistente,
  // não é queda de servidor — vai para o caminho normal, como no refreshEntitlement.
  const offline = r.status >= 500;
  return { ok: r.ok, offline, status: r.status, dados };
}

// ── mensagens de erro em português ────────────────────────────────────────
function traduzir(msg, status) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique a caixa de entrada.';
  if (m.includes('user already registered')) {
    // Não confirmamos se o e-mail existe: mesma resposta para os dois casos.
    return 'Se este e-mail puder ser cadastrado, enviaremos as instruções.';
  }
  if (m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (m.includes('unable to validate email')) return 'E-mail inválido.';
  if (m.includes('rate limit') || status === 429) return 'Muitas tentativas. Espere um minuto e tente de novo.';
  if (m.includes('network') || m.includes('fetch failed')) return 'Sem conexão com o servidor. Verifique sua internet.';
  return msg || 'Não foi possível concluir. Tente de novo.';
}

// ── login ─────────────────────────────────────────────────────────────────
async function entrar(email, senha) {
  if (!configurado()) return { success: false, message: 'Login ainda não configurado neste app.' };

  const limpo = String(email).trim().toLowerCase();

  // 0. Anti-rollback: o maxSeen do arquivo é lido ANTES de regravar a sessão. No GDZ a
  // entitlement é recusada quando o relógio está atrasado (refreshEntitlement:
  // "O relógio do Windows está atrasado."). Aqui o login é justamente o caminho da
  // internet, então ele continua valendo — quem bloqueia é o `sessao()` sem servidor.
  // O login, ao passar, ressincroniza o carimbo (gravarSessao faz Math.max).
  const textoPuro = lerSessaoTextoPuro();

  // 1. bloqueio por excesso de tentativas
  const bl = await pedir('/rest/v1/rpc/login_bloqueado', {
    method: 'POST',
    body: JSON.stringify({ p_email: limpo }),
  });
  if (bl.ok && bl.dados && bl.dados.bloqueado) {
    return { success: false, message: bl.dados.mensagem || 'Muitas tentativas. Espere alguns minutos.' };
  }

  const r = await pedir('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: String(email).trim(), password: senha }),
  });

  if (!r.ok) {
    // 2. registra a falha
    pedir('/rest/v1/rpc/registrar_falha_login', {
      method: 'POST',
      body: JSON.stringify({ p_email: limpo, p_ip: null }),
    }).catch(() => { });
    // A migração do sessao.json antigo só pode acontecer num login que deu certo. Se a
    // senha estava errada, o arquivo antigo volta intacto.
    if (textoPuro) {
      try { fs.mkdirSync(DIR_SESSAO, { recursive: true }); fs.writeFileSync(SESSAO, textoPuro.bruto, 'utf8'); } catch (e) { }
    }
    return { success: false, message: traduzir(r.dados && (r.dados.error_description || r.dados.msg || r.dados.message), r.status) };
  }

  // 3. sucesso: limpa as falhas
  pedir('/rest/v1/rpc/limpar_falhas_login', {
    method: 'POST',
    body: JSON.stringify({ p_email: limpo }),
  }).catch(() => { });
  const s = {
    access_token: r.dados.access_token,
    refresh_token: r.dados.refresh_token,
    expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
    user: r.dados.user,
  };
  // maxSeen: gravarSessao já faz Math.max(agora, maxSeen anterior). O anterior vem do
  // arquivo antigo, quando existe.
  gravarSessao(s);
  const p = await perfil(s);
  // A mesma verificação do servidor que o `sessao()` faz: é ela que diz se o plano vale
  // neste PC. O resultado fica guardado na sessão (é a referência do offlineUntil).
  const v = await verificarPc(s);
  gravarSessao(s);
  // O login só conta se a licença vale neste PC. Credencial certa com plano já usado em
  // outro PC não pode levar para o painel (a tela de planos lê r.user direto).
  if (v && v.success === false && (v.reason === 'other_device' || v.reason === 'expired')) {
    return Object.assign({ success: false }, sessaoRecusada({
      motivo: v.reason,
      licenca: s.licenca || null,
      email: (p && p.email) || (s.user && s.user.email) || null,
      nome: (p && p.name) || null,
      plan: (p && p.plan) || 'free',
      pcBound: !!v.pcBound,
    }));
  }
  return { success: true, user: { ...p, ...v } };
}

// ── cadastro ──────────────────────────────────────────────────────────────
async function registrar(nome, email, senha) {
  if (!configurado()) return { success: false, message: 'Cadastro ainda não configurado neste app.' };
  const r = await pedir('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email: String(email).trim(), password: senha, data: { name: nome || '' } }),
  });
  if (!r.ok) {
    return { success: false, message: traduzir(r.dados && (r.dados.msg || r.dados.message || r.dados.error_description), r.status) };
  }
  // Se o Supabase já devolver sessão (confirmação de e-mail desligada), entra direto.
  if (r.dados && r.dados.access_token) {
    const s = {
      access_token: r.dados.access_token,
      refresh_token: r.dados.refresh_token,
      expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
      user: r.dados.user,
    };
    gravarSessao(s);
      const p = await perfil(s);
    const v = await verificarPc(s);
    return { success: true, user: { ...p, ...v }, confirmarEmail: false };
  }
  return {
    success: true,
    confirmarEmail: true,
    message: 'Conta criada. Confirme o e-mail que enviamos para entrar.',
  };
}

// ── renova o token quando expira ──────────────────────────────────────────
async function renovar(s) {
  if (!s || !s.refresh_token) return null;
  const r = await pedir('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) {
    // Sem rede (o `offline` do pedir) não é revogação: quem paga continua entrando.
    // Antes desta mudança, 3 segundos de rede caída mandavam o cliente para a tela de
    // login. Agora a sessão velha fica no disco e quem decide se ela ainda vale é
    // `offlineUntil` em `sessaoValida` — como o refreshEntitlement do GDZ.
    // A sessão é PRESERVADA (sem `gravarSessao(null)`) antes de devolver null.
    if (r.status === 0 || r.offline) return null;
    gravarSessao(null);
    return null;
  }
  const novo = {
    access_token: r.dados.access_token,
    refresh_token: r.dados.refresh_token || s.refresh_token,
    expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
    user: r.dados.user || s.user,
  };
  // Carrega o que não vem do servidor (maxSeen, a licença guardada). O maxSeen continua
  // sendo o MAIOR — "agora" depois de uma queda do relógio não apaga o carimbo antigo.
  for (const k of CAMPOS_LOCAIS) {
    if (s[k] !== undefined) novo[k] = s[k];
  }
  // Se o refresh já está vencido pelo relógio do PC, ele pode ser recusado no próximo
  // arranque por causa do rollback. Gravar o carimbo novo só DIMINUI a proteção, então
  // o maxSeen antigo fica.
  gravarSessao(novo);
  return novo;
}

// ── licença offline (offlineUntil) ────────────────────────────────────────
//
// O GDZ recebe `offlineUntil` assinado pelo servidor dentro da entitlement e, sem
// internet, aceita o uso até essa data (refreshEntitlement). Ver t6-scaling.md.
//
// O nosso modelo não tem esse campo: o Supabase devolve `licenseExpiresAt` (a validade
// do plano) e nada mais. No lugar de inventar um endpoint, a validade offline é
// calculada a partir da verificação boa do servidor, em DIAS, com duas guardas:
//
//   - a base é o instante da verificação que o servidor APROVOU (`licenca.okAt`); se o
//     servidor entregou uma validade de licença nova (maior que a guardada), a base é
//     essa validade — renovar o plano estende o prazo offline;
//   - o teto é a validade da licença (`licenseExpiresAt`): min(base + N dias, validade).
//     Licença de 3 dias não vira N dias de uso offline.
//
// `N` é o DIAS_OFFLINE abaixo. O briefing não fixa o número; ele vem daqui e pode ser
// trocado sem tocar no resto do código.
const DIAS_OFFLINE = 7;

// `lifetime` e sem validade = não expira; para a licença offline é o caso mais longo
// que existe: validade infinito.
function validadeLicencaMs(exp) {
  if (exp === null || exp === undefined || exp === '') return Infinity;
  const t = typeof exp === 'number' ? exp : Date.parse(String(exp));
  return isFinite(t) ? t : Infinity;
}

// Calcula o offlineUntil de uma licença que o servidor acabou de aprovar.
function offlineUntilDe(v, licenca) {
  const agora = Date.now();
  let base = agora;
  const expMs = validadeLicencaMs(v && v.licenseExpiresAt);
  // Detalhe do formato: o Supabase devolve `license_expires_at` como texto ISO (é um
  // timestamptz), não como número.
  const houveValidadeNova = Number.isFinite(expMs) && expMs > (licenca && licenca.validadeRef ? licenca.validadeRef : 0);
  if (houveValidadeNova) base = Math.max(agora, expMs);
  const offlineUntil = Math.min(base + DIAS_OFFLINE * 24 * 60 * 60 * 1000, expMs);
  return { offlineUntil, validadeRef: Number.isFinite(expMs) ? expMs : (licenca && licenca.validadeRef) || Infinity };
}

// Diz se a licença guardada ainda vale para uso sem internet, e por quê não.
function licencaOffline(lic) {
  const agora = Date.now();
  if (!lic || typeof lic !== 'object') return { ok: false, motivo: 'sem_licenca' };
  const guardado = typeof lic.offlineUntil === 'number' && isFinite(lic.offlineUntil) ? lic.offlineUntil : 0;
  if (!guardado) return { ok: false, motivo: 'sem_offline' };
  if (agora >= guardado) return { ok: false, motivo: 'offline_vencido' };
  if (agora >= validadeLicencaMs(lic.licenseExpiresAt)) return { ok: false, motivo: 'licenca' };
  let w = lic;
  if (w.lifetime) w = { ...w, licenseExpiresAt: null };
  return { ok: true, offlineUntil: guardado, user: w };
}

// Versão da licença guardada, para a tela (plano.js mostra a data).
function copiaLicenca(lic) {
  if (!lic || typeof lic !== 'object') return null;
  const copia = {};
  for (const k of Object.keys(lic)) {
    if (Array.isArray(lic[k])) copia[k] = lic[k].slice();
    else copia[k] = lic[k];
  }
  return copia;
}

// Registra o resultado de uma verificação do PC no arquivo de sessão.
// Devolve a licença que fica guardada (nova ou a anterior).
function anotarLicenca(s, v) {
  if (!s || !v) return null;
  const anterior = (s.licenca && typeof s.licenca === 'object') ? s.licenca : null;
  // Plano gratuito não tem licença para guardar. 'pro' OU último veredito com licença:
  // um 'pro' recusado (other_device, expirado) também cai aqui — é ele que precisa ser
  // registrado, senão a licença offline anterior continuaria valendo para quem foi
  // recusado pelo servidor.
  const comLicenca = v.plan === 'pro'
    || (v.licenseExpiresAt !== null && v.licenseExpiresAt !== undefined)
    || (anterior && anterior.ok === true);
  if (!v.success) {
    if (!comLicenca && !anterior) return null;
    // Licença recusada pelo servidor: guarda o estado (para a tela explicar o motivo) e
    // derruba a licença offline, senão o cliente usaria sem internet um plano que o
    // servidor acabou de negar.
    const guardada = Object.assign({}, anterior || {}, {
      ok: false, reason: v.reason || null, pcBound: !!v.pcBound,
      plan: v.plan || 'free', features: completarFeatures(v.plan || 'free', v.features),
      licenseExpiresAt: v.licenseExpiresAt || null,
      offlineUntil: 0, okAt: Date.now(),
    });
    s.licenca = guardada;
    gravarSessao(s);
    return guardada;
  }
  if (!comLicenca) {
    if (anterior) {
      s.licenca = Object.assign({}, anterior, { ok: false, reason: null, offlineUntil: 0, okAt: Date.now() });
      gravarSessao(s);
      return s.licenca;
    }
    return null;
  }
  const { offlineUntil, validadeRef } = offlineUntilDe(v, anterior);
  const nova = {
    ok: true,
    okAt: Date.now(),
    validadeRef,
    plan: v.plan,
    features: completarFeatures(v.plan, v.features),
    lifetime: !!v.lifetime,
    licenseExpiresAt: v.licenseExpiresAt || null,
    reason: v.reason || null,
    pcBound: !!v.pcBound,
    offlineUntil,
  };
  s.licenca = nova;
  gravarSessao(s);
  return nova;
}

async function sessaoValida() {
  let s = lerSessao();
  if (!s) return null;
  // 1. anti-rollback. Sem internet, usa a licença offline; com internet, o servidor
  // decide (a proteção do GDZ na linha 243 do t6: maxSeen - 10min).
  const carimbo = carimbar(s, true);
  if (carimbo.atrasado) return { __offline: true, motivo: 'relogio_atrasado' };
  if (!(s.expires_at && Date.now() > s.expires_at - 60000)) {
    // token ainda no prazo (inclusive no modo offline): vale.
    return s;
  }
  // 2. token venceu. Renova.
  const novo = await renovar(s);
  if (novo) return novo;
  // 3. Não renovou. Revogação de verdade já apagou a sessão; sem rede, o arquivo
  //    continua no disco e a licença offline decide.
  const depois = lerSessao();
  if (!depois) return null;
  return { __offline: true, sessao: depois };
}

// ── verificação do PC (mesma regra da referência) ──────────────────────
//
// Depois de autenticar, o app manda o HWID. O servidor decide:
//   - PC já vinculado            -> libera
//   - ainda cabe na cota         -> vincula e libera
//   - cota cheia                 -> reason 'other_device'
//       pcBound true  -> o PC mudou (formatou/trocou); pode renovar
//       pcBound false -> plano em outro PC
async function verificarPc(s) {
  const sess = s || (await sessaoValida());
  // Sessão só com o arquivo guardado (sem internet): quem responde é a licença
  // offline, não a tela de login.
  if (!sess) return { success: false, reason: 'no_session' };
  if (sess.__offline || !sess.access_token) return licencaOffline(sess.sessao && sess.sessao.licenca);

  const h = hwid.ler();
  if (!hwid.valido(h)) return { success: false, reason: 'bad_hwid' };

  const r = await pedir('/rest/v1/rpc/verificar_pc', {
    method: 'POST',
    token: sess.access_token,
    body: JSON.stringify({
      p_hwid: h.id,
      p_board: h.board || null,
      p_device: h.deviceName || null,
    }),
  });

  if (!r.ok) {
    // Sem resposta (rede caída/5xx) não é "PC errado": é falta de servidor. O perfil do
    // Supabase é público por RLS, então ele também falha nesse caso. A resposta vem da
    // última licença boa, até o `offlineUntil` — como no modo offline do GDZ.
    if (r.status === 0 || r.offline) {
      const local = licencaOffline(sess.licenca);
      return local.ok
        ? Object.assign({}, local.user, { offline: true, offlineUntil: local.offlineUntil, motivoOffline: null })
        : Object.assign({ success: false, reason: 'offline', offline: true, motivoOffline: local.motivo },
                        local.user || {});
    }
    return { success: false, reason: 'erro_servidor', message: (r.dados && r.dados.message) || 'Falha ao verificar o PC.' };
  }

  const d = r.dados || {};
  const v = {
    success: !!d.success,
    plan: d.plan || 'free',
    features: completarFeatures(d.plan || 'free', d.features),
    lifetime: !!d.lifetime,
    licenseExpiresAt: d.licenseExpiresAt || null,
    reason: d.reason || null,
    pcBound: !!d.pcBound,
    maxDevices: d.maxDevices,
  };
  // Guarda o veredito do servidor: é a referência do `offlineUntil` e do motivo mostrado
  // quando ele recusa (other_device / expired).
  anotarLicenca(sess, v);
  return v;
}


// ── envio do hardware para o painel ───────────────────────────────────────
//
// Depois do login, manda placa de vídeo, processador, memória e sistema para o Supabase.
// A função gravar_hardware aceita só para o próprio usuário logado. Falha aqui não atrapalha
// o uso do app: é informação para o painel administrativo.
async function enviarHardware() {
  try {
    const s = await sessaoValida();
    if (!s) return { success: false, reason: 'no_session' };

    const hw = extra.getHardware ? await extra.getHardware() : null;
    if (!hw) return { success: false, reason: 'sem dados' };

    const gpu = hw.gpu || hw.gpuNome || hw.videocard || '';
    const cpu = hw.cpu || hw.cpuNome || hw.processador || '';

    // o getHardware devolve a memória como texto: "32 GB DDR5-5200".
    // Aqui tiramos só o número antes do "GB".
    let ram = null;
    if (typeof hw.ram === 'number') {
      ram = hw.ram;
    } else if (typeof hw.ram === 'string') {
      const m = hw.ram.match(/(\d+)\s*GB/i);
      if (m) ram = Number(m[1]);
    }
    if (!ram) {
      const total = os.totalmem ? os.totalmem() : 0;
      if (total) ram = Math.round(total / (1024 * 1024 * 1024));
    }

    // sistema: nome + versão do Windows
    let sis = hw.os || hw.sistema || hw.windows || '';
    if (!sis) {
      const rel = os.release ? os.release() : '';
      const ver = /^10\.0\.(\d+)/.exec(rel);
      sis = ver ? (Number(ver[1]) >= 22000 ? 'Windows 11' : 'Windows 10') : (rel || '');
    }

    if (!gpu && !cpu) return { success: false, reason: 'sem hardware' };

    const r = await pedir('/rest/v1/rpc/gravar_hardware', {
      method: 'POST',
      token: s.access_token,
      body: JSON.stringify({
        p_gpu: String(gpu).slice(0, 120),
        p_cpu: String(cpu).slice(0, 120),
        p_ram: ram ? Math.round(ram) : null,
        p_sistema: String(sis).slice(0, 60),
      }),
    });

    return { success: r.ok, status: r.status };
  } catch (e) {
    return { success: false, erro: e.message };
  }
}


// ── resgate de chave ──────────────────────────────────────────────────────
//
// O cliente digita a chave (VL-XXXX-XXXX-XXXX) e o plano é liberado na hora.
// A validação é toda no banco: chave inexistente, já usada ou cancelada são recusadas lá.
async function resgatarChave(codigo) {
  const limpo = String(codigo || '').trim().toUpperCase();
  if (!limpo) return { ok: false, erro: 'Digite a chave.' };
  if (!/^VL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(limpo)) {
    return { ok: false, erro: 'Formato inválido. A chave é VL-XXXX-XXXX-XXXX.' };
  }

  const s = await sessaoValida();
  if (!s) return { ok: false, erro: 'Faça login antes de resgatar a chave.' };
  if (s.__offline || !s.access_token) {
    return { ok: false, erro: 'Resgatar chave precisa de internet. Conecte e tente de novo.' };
  }

  const r = await pedir('/rest/v1/rpc/resgatar_chave', {
    method: 'POST',
    token: s.access_token,
    body: JSON.stringify({ p_codigo: limpo }),
  });

  if (!r.ok) {
    return { ok: false, erro: (r.dados && r.dados.message) || 'Não foi possível resgatar.' };
  }

  const d = r.dados || {};
  if (!d.ok) return { ok: false, erro: d.erro || 'Chave recusada.' };

  // limpa o cache do plano para o app reler
  return { ok: true, tipo: d.tipo || 'liberado', codigo: limpo };
}

// ── perfil (nome + plano) ─────────────────────────────────────────────────
async function perfil(s) {
  const sess = s || (await sessaoValida());
  if (!sess || sess.__offline || !sess.user) return null;
  const r = await pedir('/rest/v1/profiles?select=email,name,plan,features,lifetime,license_expires_at&id=eq.' + sess.user.id, {
    method: 'GET',
    token: sess.access_token,
  });
  const p = Array.isArray(r.dados) && r.dados[0] ? r.dados[0] : {};

  // Mesmo modelo da referencia: plan 'free' ou 'pro' e uma lista de features (por pagina).
  // ['*'] libera tudo. Licenca vencida volta para gratuito.
  const vencida = !!(p.license_expires_at && new Date(p.license_expires_at) <= new Date());
  const planoValido = p.plan === 'pro' && !vencida;
  const features = completarFeatures(planoValido ? (p.plan || 'free') : 'free', planoValido ? p.features : null);

  // Mesmos campos que o userFromClaims do GDZ devolve, sem inventar nada.
  //
  // O GDZ recebe um entitlement ASSINADO do servidor com did/pcBound/offlineUntil/
  // minVersion/latestVersion. Aqui o plano vem da tabela `profiles` do Supabase, que
  // NÃO tem essas colunas (conferido: profiles tem email, name, plan, features,
  // lifetime, license_expires_at). Então:
  //
  //   - deviceId, pcBound, offlineUntil, latestVersion, minVersion ficam de FORA:
  //     devolver null/true para eles seria dado inventado aparecendo como se
  //     viesse do servidor. Quem precisa do PC preso, o gate do main já resolve
  //     com a RPC verificar_pc.
  //   - user_metadata também não serve: nada no projeto escreve nele, então ler
  //     de lá dava sempre undefined (medido pela auditoria).
  const meta = sess.user.user_metadata || {};
  return {
    id: sess.user.id,
    userId: sess.user.id,
    email: p.email || sess.user.email,
    username: p.name || meta.name || String(sess.user.email || '').split('@')[0],
    name: p.name || meta.name || String(sess.user.email || '').split('@')[0],
    plan: planoValido ? 'pro' : 'free',
    reason: planoValido ? null : (vencida ? 'expired' : null),
    features,
    lifetime: !!p.lifetime,
    licenseExpiresAt: p.license_expires_at || null,
    expirada: vencida,
    offline: false,
  };
}

// ── estado da sessão ao abrir o app ───────────────────────────────────────
async function sessao() {
  const s = await sessaoValida();
  if (!s) return { valid: false };

  // Depois do anti-rollback e sem servidor: a resposta vem da licença offline.
  if (s.__offline) {
    const lic = licencaOffline(s.sessao && s.sessao.licenca);
    if (s.motivo === 'relogio_atrasado') return sessaoRecusada({ motivo: 'relogio' });
    if (lic.ok) {
      return {
        valid: true,
        offline: true,
        offlineUntil: lic.offlineUntil,
        user: Object.assign({}, lic.user, { pcAprovado: true, offline: true, offlineUntil: lic.offlineUntil }),
      };
    }
    return sessaoRecusada({ motivo: lic.motivo, licenca: (s.sessao && s.sessao.licenca) || null });
  }

  const p = await perfil(s);
  const v = await verificarPc(s);

  // O banco não respondeu mas a licença guardada ainda está no prazo: abre a tela, com
  // o retrato do que o servidor aprovou por último.
  // `v.success === true` (não só truthy): a resposta da licença offline traz success
  // false quando o motivo é 'sem_offline'/'offline_vencido' — isso não abre a tela.
  if (v && v.offline === true && v.success === true) {
    return {
      valid: true,
      offline: true,
      offlineUntil: v.offlineUntil,
      user: Object.assign({}, v, {
        email: (p && p.email) || (s.user && s.user.email) || null,
        name: (p && p.name) || null,
        expirada: v.reason === 'expired',
        pcAprovado: true,
        pcBound: !!v.pcBound,
        offline: true,
        offlineUntil: v.offlineUntil,
      }),
    };
  }

  // Sem perfil do servidor (rede caiu / 500) e sem licença no prazo. Vem ANTES da
  // checagem de other_device: sem perfil não há resposta de licença nenhuma, e o motivo
  // correto é 'sem servidor', não a ausência de licença guardada.
  if (!p) {
    return sessaoRecusada({
      motivo: (v && v.motivoOffline) || 'offline',
      licenca: s.licenca || null,
    });
  }

  // Servidor respondeu e negou o PC (other_device). O login do provedor funciona, mas a
  // licença não vale neste PC — 'valid: true' com pcAprovado false era o que a tela de
  // planos lia (plano.js: `if (r && r.success) user = r.user`), então este caso vira
  // sessão inválida com o motivo, como o 401 do refreshEntitlement do GDZ.
  if (v && v.success === false && (v.reason === 'other_device' || v.reason === 'expired' || v.reason === 'offline')) {
    return sessaoRecusada({
      motivo: v.reason === 'offline' ? (v.motivoOffline || 'offline') : v.reason,
      licenca: s.licenca || null,
      email: (p && p.email) || (s.user && s.user.email) || null,
      plan: (p && p.plan) || 'free',
      pcBound: !!v.pcBound,
    });
  }
  // O verificar_pc devolve reason ('other_device'), pcBound e success. O spread
  // simples perdia o 'success', e o conta-plano so olhava 'expirada'. Resultado:
  // o plano vitalicio funcionava em QUALQUER PC, bastando copiar o sessao.json.
  return {
    valid: true,
    user: {
      ...p,
      ...v,
      pcAprovado: !(v && v.success === false),
      reason: (v && v.reason) || null,
      pcBound: !!(v && v.pcBound),
      offlineUntil: (s.licenca && s.licenca.offlineUntil) || null,
      // Para a tela explicar: por que a resposta veio do arquivo local e não do servidor.
      motivoOffline: (v && v.success === false) ? ((v && v.motivoOffline) || v.reason || null) : null,
      licencaRef: copiaLicenca(s.licenca),
    },
  };
}

// Recusa a entrada com motivo legível. Mesmas palavras do GDZ onde ele tem uma
// (t6-scaling.md, refreshEntitlement), adaptadas para a nossa tela.
function sessaoRecusada(info) {
  const i = info || {};
  if (i.motivo === 'relogio') {
    return {
      valid: false,
      motivo: 'relogio',
      message: 'O relógio do Windows está atrasado. Acerte a data e hora ou conecte à internet.',
    };
  }
  if (i.motivo === 'offline_vencido') {
    return {
      valid: false,
      motivo: 'offline_vencido',
      offlineUntil: (i.licenca && i.licenca.offlineUntil) || null,
      message: 'Sem conexão com o servidor e o período offline venceu. Conecte à internet para entrar.',
    };
  }
  if (i.motivo === 'other_device') {
    // Duas situações diferentes, com soluções diferentes (mesma distinção do GDZ):
    //   pcBound true  -> o PC desta licença saiu (formatou/trocou): renova o PC no site
    //   pcBound false -> a conta está em outro PC: sair lá ou falar no suporte
    // A mensagem antiga ("Seu plano está sendo usado em outro PC.") não dizia o que fazer
    // e a tela caía num texto genérico quando o campo faltava.
    return {
      valid: false,
      motivo: 'other_device',
      outraMaquina: true,
      pcBound: !!i.pcBound,
      email: i.email || null,
      nome: i.nome || null,
      message: i.pcBound
        ? 'Este PC não é o PC liberado na sua conta. Se você formatou ou trocou de PC, abra o site e use "Renovar PC".'
        : 'Sua conta já está em uso em outro PC. Cada conta vale para 1 PC por vez: saia no outro PC ou fale com o suporte.',
    };
  }
  if (i.motivo === 'expired') {
    return {
      valid: false,
      motivo: 'expired',
      expirada: true,
      message: 'Sua licença venceu. Renove no site para aplicar ajustes novos; o que já está aplicado continua funcionando.',
    };
  }
  // 'sem_licenca' / 'sem_offline' / 'licenca': sem resposta e sem licença guardada.
  return {
    valid: false,
    motivo: i.motivo || 'offline',
    message: 'Sem conexão com o servidor. Conecte à internet para entrar.',
  };
}

/// Sai da conta E revoga o token no servidor.
///
/// O GDZ faz ipcMain.on("logout") com a mesma ordem: lê o token guardado, apaga
/// o arquivo e manda POST /app/logout com ele. Só apagar o arquivo (como era
/// antes) deixava o refresh_token que estava no disco válido para sempre — quem
/// copiasse o arquivo continuava entrando.
///
/// Ordem escolhida: revoga PRIMEIRO (com o token ainda em mão) e apaga depois.
/// Se a rede falhar, apaga do mesmo jeito e devolve um aviso: o cliente pediu
/// para sair, então ele sai.
async function sair() {
  let s = null;
  try { s = lerSessao(); } catch (e) { }
  const access = s && s.access_token;
  const refresh = s && s.refresh_token;
  let revogou = false;

  if (configurado() && (access || refresh)) {
    // `/auth/v1/logout` do Supabase revoga o token de ACESSO que vai no header —
    // não o refresh_token. Mandar o refresh_token ali fazia o GoTrue responder 401
    // em toda saída e a tela avisava "o servidor não confirmou" mesmo com internet
    // boa (achado da auditoria n2).
    //
    // Então são duas chamadas, cada uma com o token que a API espera:
    //   1) logout do access token (e o 401 aqui também conta como revogado)
    //   2) revogação do refresh token em /auth/v1/user? Ele não tem endpoint de
    //      revogação por refresh no GoTrue padrão; o caminho que existe é o
    //      `?scope=global` do logout, que encerra TODAS as sessões do usuário.
    //      Usamos `global` só quando temos access token válido; se só houver
    //      refresh, tentamos renovar primeiro.
    try {
      let tokenParaRevogar = access;
      if (!tokenParaRevogar && refresh) {
        const renov = await pedir('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refresh }),
          timeoutMs: 8000,
        });
        if (renov && renov.ok && renov.dados && renov.dados.access_token) {
          tokenParaRevogar = renov.dados.access_token;
        }
      }
      if (tokenParaRevogar) {
        const r = await pedir('/auth/v1/logout?scope=global', {
          method: 'POST',
          token: tokenParaRevogar,
          timeoutMs: 8000,
        });
        // 204 = sem conteúdo (ok), 401 = token já não valia (também ok: o objetivo
        // era justamente ficar inválido), 404 = sessão já encerrada pelo servidor.
        revogou = !!(r && (r.ok || r.status === 204 || r.status === 401 || r.status === 404));
      }
    } catch (e) { }
  }

  gravarSessao(null);

  // Aviso só quando realmente não deu: sem conexão ou servidor fora. Se o token
  // já não valia, o objetivo foi cumprido e não há o que avisar.
  if ((access || refresh) && !revogou) {
    return {
      success: true,
      message: 'Saímos no PC. O servidor não respondeu agora, então a sessão antiga só expira sozinha — entre de novo para renovar.',
    };
  }
  return { success: true };
}

// ── recuperar senha ───────────────────────────────────────────────────────
async function recuperar(email) {
  if (!configurado()) return { success: false, message: 'Login ainda não configurado neste app.' };
  const r = await pedir('/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({
      email: String(email).trim(),
      // O e-mail de recuperação tem que abrir a página que pede a senha nova
      // (site/redefinir.html). Sem redirect_to o Supabase manda para a home e o cliente
      // fica sem onde digitar a senha — foi assim que o dono perdeu a senha em 24/11.
      redirect_to: (MARCA.site || 'https://vl-optimizer.pages.dev').replace(/\/$/, '') + '/redefinir',
    }),
  });
  if (!r.ok) return { success: false, message: traduzir(r.dados && (r.dados.msg || r.dados.message), r.status) };
  return { success: true, message: 'Enviamos um link de redefinição para o seu e-mail.' };
}

// ── usuário local (compatibilidade com o que a tela já usa) ───────────────
async function usuario() {
  const p = await perfil();
  if (p) return p;
  // Sem servidor mas com licença offline válida: o renderer (engine-extras) usa o plano,
  // então ele precisa continuar vindo.
  try {
    const s = lerSessao();
    const lic = s && licencaOffline(s.licenca);
    if (lic && lic.ok) return Object.assign({}, lic.user, { offline: true, offlineUntil: lic.offlineUntil });
  } catch (e) { }
  return { username: 'visitante', email: null, plan: 'free', features: ['painel'] };
}

// ── Telemetria: POST na Edge Function `telemetria` ───────────────────────
// O GDZ manda { fps, hardware } para api.gdzfps.com/app/telemetry. Aqui vai
// para https://<projeto>.supabase.co/functions/v1/telemetria, autenticado com
// o access_token da sessão. Recebe as mesmas rotas que o módulo usa, para a
// lógica de fila do telemetria.js continuar igual à do GDZ.
async function telemetriaPedir(metodo, rota, corpo) {
  if (!configurado()) return { status: 0, data: {} };
  const sess = lerSessao();
  const token = sess && sess.access_token;
  if (!token) return { status: 401, data: {} };

  // /app/x -> /functions/v1/telemetria/x
  const caminho = String(rota || "").replace(/^\/app\//, "/");
  const url = CONFIG.url.replace(/\/$/, "") + "/functions/v1/telemetria" + caminho;

  try {
    const r = await fetch(url, {
      method: metodo || "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.anonKey,
        Authorization: "Bearer " + token,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
    let dados = {};
    try { dados = await r.json(); } catch (e) { }
    return { status: r.status, data: dados };
  } catch (e) {
    return { status: 0, data: {} };
  }
}


module.exports = {
  configurado, entrar, registrar, sessao, sair, recuperar, perfil, usuario,
  verificarPc, enviarHardware, resgatarChave, CONFIG,
  // proteções: expostas para teste e para a tela mostrar a data do modo offline
  CLOCK_ROLLBACK_TOLERANCE_MS, DIAS_OFFLINE, offlineUntilDe, licencaOffline, copiaLicenca,
  // plano grátis: a lista do GDZ e a função que completa o que o servidor mandar
  FEATURES_GRATIS, completarFeatures,
  // arquivo de sessão: expostos para teste da gravação atômica e da cópia .bak
  gravarCifrado, lerCifrado, lerSessao, gravarSessao, AUTH_PRINCIPAL, AUTH_BACKUP,
  telemetriaPedir,
};
