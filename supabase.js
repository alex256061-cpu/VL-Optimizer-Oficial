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

// ── configuração ──────────────────────────────────────────────────────────
// Preencha depois de criar o projeto no supabase.com. Os dois valores são públicos
// (a chave anon vai no app de qualquer forma); o que protege os dados é a regra de
// segurança no banco, não o sigilo dessas duas strings.
const CONFIG = {
  url: process.env.VL_SUPABASE_URL || 'https://wsmropvlmnyegpvmyndn.supabase.co',
  anonKey: process.env.VL_SUPABASE_ANON_KEY || 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o',
};

const DIR = path.join(process.env.APPDATA || os.homedir(), 'VL Optimizer');
const SESSAO = path.join(DIR, 'sessao.json');

function configurado() {
  return Boolean(CONFIG.url && CONFIG.anonKey);
}

function lerSessao() {
  try {
    const j = JSON.parse(fs.readFileSync(SESSAO, 'utf8'));
    if (j && j.access_token) return j;
  } catch (e) { }
  return null;
}

function gravarSessao(s) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (!s) { try { fs.unlinkSync(SESSAO); } catch (e) { } return; }
    fs.writeFileSync(SESSAO, JSON.stringify(s), 'utf8');
  } catch (e) { }
}

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
  let r;
  try {
    r = await fetch(url, o);
  } catch (e) {
    const semRede = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(String(e && e.message));
    return {
      ok: false,
      status: 0,
      dados: { message: semRede ? 'Sem conexão com o servidor. Verifique sua internet.' : 'Falha ao conectar: ' + (e && e.message) },
    };
  }

  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = { raw: texto }; }
  return { ok: r.ok, status: r.status, dados };
}

// ── mensagens de erro em português ────────────────────────────────────────
function traduzir(msg, status) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique a caixa de entrada.';
  if (m.includes('user already registered')) return 'Este e-mail já tem conta. Use Entrar.';
  if (m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (m.includes('unable to validate email')) return 'E-mail inválido.';
  if (m.includes('rate limit') || status === 429) return 'Muitas tentativas. Espere um minuto e tente de novo.';
  if (m.includes('network') || m.includes('fetch failed')) return 'Sem conexão com o servidor. Verifique sua internet.';
  return msg || 'Não foi possível concluir. Tente de novo.';
}

// ── login ─────────────────────────────────────────────────────────────────
async function entrar(email, senha) {
  if (!configurado()) return { success: false, message: 'Login ainda não configurado neste app.' };
  const r = await pedir('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: String(email).trim(), password: senha }),
  });
  if (!r.ok) {
    return { success: false, message: traduzir(r.dados && (r.dados.error_description || r.dados.msg || r.dados.message), r.status) };
  }
  const s = {
    access_token: r.dados.access_token,
    refresh_token: r.dados.refresh_token,
    expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
    user: r.dados.user,
  };
  gravarSessao(s);
  const p = await perfil(s);
  const v = await verificarPc(s);
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
  if (!r.ok) { gravarSessao(null); return null; }
  const novo = {
    access_token: r.dados.access_token,
    refresh_token: r.dados.refresh_token || s.refresh_token,
    expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
    user: r.dados.user || s.user,
  };
  gravarSessao(novo);
  return novo;
}

async function sessaoValida() {
  let s = lerSessao();
  if (!s) return null;
  if (s.expires_at && Date.now() > s.expires_at - 60000) {
    s = await renovar(s);
    if (!s) return null;
  }
  return s;
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
  if (!sess) return { success: false, reason: 'no_session' };

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
    return { success: false, reason: 'erro_servidor', message: (r.dados && r.dados.message) || 'Falha ao verificar o PC.' };
  }

  const d = r.dados || {};
  return {
    success: !!d.success,
    plan: d.plan || 'free',
    features: Array.isArray(d.features) ? d.features : ['painel'],
    lifetime: !!d.lifetime,
    licenseExpiresAt: d.licenseExpiresAt || null,
    reason: d.reason || null,
    pcBound: !!d.pcBound,
    maxDevices: d.maxDevices,
  };
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

// ── perfil (nome + plano) ─────────────────────────────────────────────────
async function perfil(s) {
  const sess = s || (await sessaoValida());
  if (!sess) return null;
  const r = await pedir('/rest/v1/profiles?select=email,name,plan,features,lifetime,license_expires_at&id=eq.' + sess.user.id, {
    method: 'GET',
    token: sess.access_token,
  });
  const p = Array.isArray(r.dados) && r.dados[0] ? r.dados[0] : {};

  // Mesmo modelo da referencia: plan 'free' ou 'pro' e uma lista de features (por pagina).
  // ['*'] libera tudo. Licenca vencida volta para gratuito.
  const vencida = !!(p.license_expires_at && new Date(p.license_expires_at) <= new Date());
  const planoValido = p.plan === 'pro' && !vencida;
  const features = planoValido ? (Array.isArray(p.features) ? p.features : []) : ['painel'];

  return {
    id: sess.user.id,
    email: p.email || sess.user.email,
    name: p.name || (sess.user.user_metadata && sess.user.user_metadata.name) || String(sess.user.email || '').split('@')[0],
    plan: planoValido ? 'pro' : 'free',
    features,
    lifetime: !!p.lifetime,
    licenseExpiresAt: p.license_expires_at || null,
    expirada: vencida,
  };
}

// ── estado da sessão ao abrir o app ───────────────────────────────────────
async function sessao() {
  const s = await sessaoValida();
  if (!s) return { valid: false };
  const p = await perfil(s);
  if (!p) return { valid: false };
  const v = await verificarPc(s);
  return { valid: true, user: { ...p, ...v } };
}

function sair() {
  gravarSessao(null);
  return { success: true };
}

// ── recuperar senha ───────────────────────────────────────────────────────
async function recuperar(email) {
  if (!configurado()) return { success: false, message: 'Login ainda não configurado neste app.' };
  const r = await pedir('/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({ email: String(email).trim() }),
  });
  if (!r.ok) return { success: false, message: traduzir(r.dados && (r.dados.msg || r.dados.message), r.status) };
  return { success: true, message: 'Enviamos um link de redefinição para o seu e-mail.' };
}

// ── usuário local (compatibilidade com o que a tela já usa) ───────────────
async function usuario() {
  const p = await perfil();
  return p || { username: 'visitante', email: null, plan: 'free', features: ['painel'] };
}

module.exports = { configurado, entrar, registrar, sessao, sair, recuperar, perfil, usuario, verificarPc, enviarHardware, CONFIG };
