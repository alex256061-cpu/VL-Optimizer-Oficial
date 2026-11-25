/**
 * _admin.js — helpers das Functions de administração.
 *
 * - exigirAdmin: token da sessão + is_admin no perfil (service key fica no servidor)
 * - authAdmin: chamadas à Auth Admin API do Supabase (banir/desbanir, ler usuário)
 * - storage*: bucket privado usado para o log de auditoria e para o controle de
 *   e-mails já enviados (não precisamos de tabela nova para isso)
 * - registrarAuditoria: grava uma linha no log (best-effort, nunca derruba a ação)
 */

const sj = (o, status) =>
  new Response(JSON.stringify(o), {
    status: status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export const responder = sj;

export const cabecalhosServico = (svc) => ({
  apikey: svc,
  Authorization: 'Bearer ' + svc,
  'Content-Type': 'application/json',
});

export async function exigirAdmin(request, env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const svc = String(env.SUPABASE_SERVICE || '');
  if (!base || !svc) return { ok: false, status: 500, erro: 'Banco não configurado.' };

  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (!m) return { ok: false, status: 401, erro: 'Entre como administrador para usar esta função.' };
  const token = m[1];

  let usuario = null;
  try {
    const r = await fetch(base + '/auth/v1/user', {
      headers: { apikey: svc, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return { ok: false, status: 401, erro: 'Sessão inválida ou expirada. Entre de novo.' };
    usuario = await r.json();
  } catch (e) {
    return { ok: false, status: 502, erro: 'Não consegui validar a sessão agora.' };
  }
  if (!usuario || !usuario.id) return { ok: false, status: 401, erro: 'Sessão inválida.' };

  try {
    const rp = await fetch(
      base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(usuario.id) + '&select=id,email,is_admin',
      { headers: cabecalhosServico(svc) }
    );
    const lista = rp.ok ? await rp.json() : [];
    if (!Array.isArray(lista) || !lista.length || !lista[0].is_admin) {
      return { ok: false, status: 403, erro: 'Esta conta não é administradora.' };
    }
    return { ok: true, base, svc, usuario, perfil: lista[0] };
  } catch (e) {
    return { ok: false, status: 502, erro: 'Não consegui conferir a permissão agora.' };
  }
}

/** GET/HEAD/POST conforme a lista. */
export function metodoPermitido(request, metodos) {
  const permitidos = metodos || ['GET', 'HEAD'];
  if (!permitidos.includes(request.method)) {
    return sj({ ok: false, erro: 'Método não permitido.' }, 405);
  }
  return null;
}

export async function lerCorpo(request) {
  try {
    const txt = await request.text();
    if (!txt) return {};
    const j = JSON.parse(txt);
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return null;
  }
}

/* ── Auth Admin API ────────────────────────────────────────────────────── */

export const authAdmin = (base, svc, metodo, caminho, corpo) =>
  fetch(base + '/auth/v1/admin/' + caminho, {
    method: metodo || 'GET',
    headers: cabecalhosServico(svc),
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

/** Lê o usuário do Auth (traz banned_until, last_sign_in_at, metadata). */
export async function lerUsuarioAuth(base, svc, id) {
  try {
    const r = await authAdmin(base, svc, 'GET', 'users/' + encodeURIComponent(id));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

/* ── Storage (bucket privado) ──────────────────────────────────────────── */

export async function garantirBucket(base, svc, bucket) {
  try {
    const r = await fetch(base + '/storage/v1/bucket', {
      method: 'POST',
      headers: cabecalhosServico(svc),
      body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 2097152 }),
    });
    // 200 = criou agora; 400/409 = já existe — os dois servem
    return r.status < 500;
  } catch (e) {
    return false;
  }
}

export async function storageGravar(base, svc, bucket, nome, obj) {
  const r = await fetch(base + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(nome), {
    method: 'POST',
    headers: Object.assign({}, cabecalhosServico(svc), { 'x-upsert': 'false' }),
    body: JSON.stringify(obj),
  });
  return r.ok;
}

export async function storageListar(base, svc, bucket, prefixo, limite) {
  try {
    const r = await fetch(base + '/storage/v1/object/list/' + bucket, {
      method: 'POST',
      headers: cabecalhosServico(svc),
      body: JSON.stringify({
        prefix: prefixo || '',
        limit: limite || 50,
        sortBy: { column: 'created_at', order: 'desc' },
      }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

export async function storageLer(base, svc, bucket, nome) {
  try {
    const r = await fetch(base + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(nome), {
      headers: { apikey: svc, Authorization: 'Bearer ' + svc },
    });
    if (!r.ok) return null;
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { return null; }
  } catch (e) {
    return null;
  }
}

export async function storageApagar(base, svc, bucket, prefixos) {
  if (!prefixos || !prefixos.length) return true;
  try {
    const r = await fetch(base + '/storage/v1/object/' + bucket, {
      method: 'DELETE',
      headers: cabecalhosServico(svc),
      body: JSON.stringify({ prefixes: prefixos }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/* ── auditoria ─────────────────────────────────────────────────────────── */

export async function registrarAuditoria(base, svc, admin, acao, alvo, detalhe) {
  try {
    await garantirBucket(base, svc, 'auditoria');
    const quando = new Date().toISOString();
    const nome = quando.replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    return await storageGravar(base, svc, 'auditoria', nome, {
      quando,
      admin: (admin && (admin.email || admin.id)) || 'desconhecido',
      admin_id: (admin && admin.id) || null,
      acao: String(acao || '').slice(0, 80),
      alvo: alvo == null ? null : String(alvo).slice(0, 160),
      detalhe: detalhe == null ? null : String(detalhe).slice(0, 500),
    });
  } catch (e) {
    return false; // auditoria é melhor-esforço: nunca derruba a ação
  }
}
