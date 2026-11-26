/* supabase-client.js — login e conta no site do VL Optimizer.
 *
 * Fala direto com o Supabase pela API REST, sem biblioteca: assim o site continua estático e
 * leve no Cloudflare Pages, sem build.
 *
 * Usa a publishable key (a antiga anon key foi substituída no Supabase novo). Ela é pública por
 * natureza: quem protege os dados é a regra de segurança do banco (row level security).
 */
const SUPABASE = (() => {
  const URL = 'https://wsmropvlmnyegpvmyndn.supabase.co';
  const KEY = 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o';
  const CHAVE_SESSAO = 'vl-sessao';

  function sessao() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null');
      if (s && s.access_token) return s;
    } catch (e) { }
    return null;
  }

  function guardar(s) {
    if (!s) { localStorage.removeItem(CHAVE_SESSAO); return; }
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
  }

  async function pedir(caminho, opcoes) {
    const o = Object.assign({}, opcoes || {});
    o.headers = Object.assign(
      { 'Content-Type': 'application/json', apikey: KEY },
      o.headers || {}
    );
    if (!o.headers.Authorization) o.headers.Authorization = 'Bearer ' + (o.token || KEY);
    delete o.token;
    try {
      const r = await fetch(URL + caminho, o);
      const txt = await r.text();
      let dados = null;
      try { dados = txt ? JSON.parse(txt) : null; } catch (e) { dados = { raw: txt }; }
      return { ok: r.ok, status: r.status, dados };
    } catch (e) {
      return { ok: false, status: 0, dados: { message: 'Sem conexão com o servidor.' } };
    }
  }

  function traduzir(msg, status) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
    if (m.includes('user already registered')) {
      // Não revelamos se o e-mail existe: a mesma mensagem serve para os dois casos.
      // Assim ninguém consegue descobrir quem tem conta testando e-mails.
      return 'Se este e-mail puder ser cadastrado, enviaremos as instruções. Tente entrar ou recuperar a senha.';
    }
    if (m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
    if (m.includes('unable to validate email') || m.includes('is invalid')) return 'E-mail inválido.';
    if (m.includes('rate limit') || status === 429) return 'Muitas tentativas. Espere um minuto.';
    if (m.includes('fetch failed') || m.includes('network')) return 'Sem conexão. Verifique sua internet.';
    return msg || 'Não foi possível concluir. Tente de novo.';
  }

  // Login pelo SERVIDOR (/api/login). O bloqueio de tentativas e o registro de falhas
  // não são mais feitos por RPC pública: qualquer pessoa conseguia chamar
  // limpar_falhas_login e apagar o bloqueio. Agora só o servidor (com service key)
  // consulta/grava isso e devolve a sessão já validada.
  async function entrar(email, senha, lembrar) {
    const limpo = String(email).trim().toLowerCase();
    let resposta;
    let dados = null;
    try {
      resposta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: limpo, senha: String(senha) }),
      });
      const txt = await resposta.text();
      try { dados = txt ? JSON.parse(txt) : null; } catch (e) { dados = null; }
    } catch (e) {
      return { success: false, message: 'Sem conexão. Verifique sua internet.' };
    }

    if (!resposta.ok || !dados || dados.ok !== true) {
      return {
        success: false,
        message: (dados && dados.erro) || 'Não foi possível entrar. Confira o e-mail e a senha e tente de novo.',
      };
    }

    const s = {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expires_at: Date.now() + (Number(dados.expires_in) || 3600) * 1000,
      user: dados.user,
    };
    if (lembrar !== false) guardar(s);
    else sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
    return { success: true, user: dados.user };
  }

  async function criarConta(nome, email, senha) {
    const r = await pedir('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email: String(email).trim(), password: senha, data: { name: nome || '' } }),
    });
    if (!r.ok) return { success: false, message: traduzir(r.dados && (r.dados.msg || r.dados.message), r.status) };
    if (r.dados && r.dados.access_token) {
      guardar({
        access_token: r.dados.access_token,
        refresh_token: r.dados.refresh_token,
        expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
        user: r.dados.user,
      });
      return { success: true, confirmarEmail: false };
    }
    return { success: true, confirmarEmail: true, message: 'Conta criada. Confirme o e-mail para entrar.' };
  }

  async function renovar(s) {
    if (!s || !s.refresh_token) return null;
    const r = await pedir('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) { guardar(null); return null; }
    const novo = {
      access_token: r.dados.access_token,
      refresh_token: r.dados.refresh_token || s.refresh_token,
      expires_at: Date.now() + (Number(r.dados.expires_in) || 3600) * 1000,
      user: r.dados.user || s.user,
    };
    guardar(novo);
    return novo;
  }

  async function sessaoValida() {
    let s = sessao() || (() => { try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null'); } catch (e) { return null; } })();
    if (!s) return null;
    if (s.expires_at && Date.now() > s.expires_at - 60000) {
      s = await renovar(s);
      if (!s) return null;
    }
    return s;
  }

  async function perfil() {
    const s = await sessaoValida();
    if (!s) return null;
    const r = await pedir('/rest/v1/profiles?select=email,name,plan,features,lifetime,license_expires_at&id=eq.' + s.user.id, {
      method: 'GET',
      token: s.access_token,
    });
    const p = Array.isArray(r.dados) && r.dados[0] ? r.dados[0] : {};
    const vencida = !!(p.license_expires_at && new Date(p.license_expires_at) <= new Date());
    const pro = p.plan === 'pro' && !vencida;
    return {
      id: s.user.id,
      email: p.email || s.user.email,
      name: p.name || (s.user.user_metadata && s.user.user_metadata.name) || String(s.user.email || '').split('@')[0],
      plan: pro ? 'pro' : 'free',
      lifetime: !!p.lifetime,
      validade: p.license_expires_at || null,
    };
  }

  async function meusPcs() {
    const s = await sessaoValida();
    if (!s) return [];
    const r = await pedir('/rest/v1/devices?select=hwid,board,device_name,first_seen,last_seen&order=last_seen.desc', {
      method: 'GET',
      token: s.access_token,
    });
    return Array.isArray(r.dados) ? r.dados : [];
  }

  async function recuperar(email) {
    const r = await pedir('/auth/v1/recover', {
      method: 'POST',
      body: JSON.stringify({
        email: String(email).trim(),
        // O link do e-mail tem que cair na página que pede a senha nova. Sem isto o
        // Supabase manda para a home e a pessoa não tem onde digitar a senha nova
        // (era o caso antes de existir /redefinir).
        redirect_to: location.origin + '/redefinir',
      }),
    });
    if (!r.ok) return { success: false, message: traduzir(r.dados && (r.dados.msg || r.dados.message), r.status) };
    return { success: true, message: 'Enviamos um link de redefinição para o seu e-mail.' };
  }

  // Salva a senha nova. `token` é o access_token do link de recuperação; sem ele usa a
  // sessão atual (serve para "trocar a senha" com a conta logada).
  async function definirSenha(token, senha) {
    return await pedir('/auth/v1/user', {
      method: 'PUT',
      token: token || undefined,
      body: JSON.stringify({ password: String(senha) }),
    });
  }

  function sair() {
    guardar(null);
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) { }
  }

  return { entrar, criarConta, sessao, sessaoValida, perfil, meusPcs, recuperar, definirSenha, traduzir, sair, URL, KEY };
})();
