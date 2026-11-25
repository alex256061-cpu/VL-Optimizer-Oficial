/**
 * admin-buscar-chave.js — o suporte digita o código da chave e vê de quem é.
 *
 * GET /api/admin-buscar-chave?codigo=VL-XXXX-XXXX-XXXX
 *   -> { ok, chave, cliente, resumo }
 *
 * Só administrador. Fica registrado no log de auditoria (busca_chave).
 */

import { exigirAdmin, cabecalhosServico, responder, metodoPermitido, registrarAuditoria } from './_admin.js';

const CODIGO_RE = /^VL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const normalizar = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').trim();
const sb = (base, svc, caminho) => fetch(base + '/rest/v1/' + caminho, { headers: cabecalhosServico(svc) }).then((r) => (r.ok ? r.json() : []));

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueio = metodoPermitido(request, ['GET']);
  if (bloqueio) return bloqueio;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const url = new URL(request.url);
  const codigo = normalizar(url.searchParams.get('codigo'));
  if (!CODIGO_RE.test(codigo)) return responder({ ok: false, erro: 'Código inválido. Formato: VL-XXXX-XXXX-XXXX.' }, 400);

  const { base, svc } = admin;
  let chave = null;
  try {
    const lista = await sb(base, svc, 'chaves?codigo=eq.' + encodeURIComponent(codigo) + '&select=codigo,plano,dias,usado_por,usado_em,cancelada,criado_em&limit=1');
    chave = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui consultar a chave agora.' }, 502);
  }
  if (!chave) return responder({ ok: false, erro: 'Chave não encontrada.' }, 404);

  let cliente = null;
  let resumo = { pcs: 0, compras: 0 };
  if (chave.usado_por) {
    try {
      const perfis = await sb(base, svc, 'profiles?id=eq.' + encodeURIComponent(chave.usado_por) + '&select=id,email,name,plan,lifetime,license_expires_at,max_devices,created_at&limit=1');
      cliente = Array.isArray(perfis) && perfis.length ? perfis[0] : null;
      if (cliente) {
        const [devices, vendas] = await Promise.all([
          sb(base, svc, 'devices?user_id=eq.' + encodeURIComponent(cliente.id) + '&select=id&limit=50'),
          sb(base, svc, 'vendas?email=eq.' + encodeURIComponent(cliente.email || '') + '&select=id&limit=50'),
        ]);
        resumo = { pcs: Array.isArray(devices) ? devices.length : 0, compras: Array.isArray(vendas) ? vendas.length : 0 };
      }
    } catch (e) { }
  }

  {
    const tarefa = registrarAuditoria(base, svc, admin.perfil, 'busca_chave', codigo, cliente ? cliente.email : 'chave não usada');
    if (context.waitUntil) context.waitUntil(tarefa); else await tarefa;
  }

  return responder({
    ok: true,
    chave: {
      codigo: chave.codigo,
      plano: chave.plano,
      dias: chave.dias,
      cancelada: !!chave.cancelada,
      usada: !!chave.usado_por,
      usado_em: chave.usado_em || null,
    },
    cliente: cliente
      ? {
          email: cliente.email,
          nome: cliente.name,
          plano: cliente.lifetime ? 'vitalicio' : (cliente.plan === 'pro' ? 'pro' : 'free'),
          vence_em: cliente.lifetime ? null : cliente.license_expires_at,
          max_devices: cliente.max_devices,
          criado_em: cliente.created_at,
        }
      : null,
    resumo,
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return responder({ ok: false, erro: 'Use GET.' }, 405);
}
