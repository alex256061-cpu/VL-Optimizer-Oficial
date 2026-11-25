/**
 * _admin.js — verificação de administrador para as Functions de admin.
 *
 * O painel manda o token da sessão do usuário. Aqui:
 *   1. valida o token no Supabase Auth (auth/v1/user)
 *   2. lê o perfil e confere is_admin
 *   3. devolve também a URL e a service key para as consultas privilegiadas
 *
 * A service key NUNCA sai do servidor: só é usada aqui dentro.
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

/** GET/HEAD apenas. */
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
