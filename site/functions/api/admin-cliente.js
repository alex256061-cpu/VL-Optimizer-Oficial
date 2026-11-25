/**
 * admin-cliente.js — ficha completa de um cliente para o painel.
 *
 * GET /api/admin-cliente?email=cliente@email.com
 *   -> { ok, cliente, devices, vendas, chaves, hardware }
 *
 * Só responde para administrador logado (token da sessão + is_admin no perfil).
 * A leitura é feita com a service key no servidor: o navegador nunca vê a chave.
 */

import { exigirAdmin, cabecalhosServico, responder, metodoPermitido } from './_admin.js';

const sb = (base, svc, caminho) =>
  fetch(base + '/rest/v1/' + caminho, { headers: cabecalhosServico(svc) }).then((r) => (r.ok ? r.json() : []));

export async function onRequestGet(context) {
  const { request, env } = context;
  const bloqueioMetodo = metodoPermitido(request, ['GET']);
  if (bloqueioMetodo) return bloqueioMetodo;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const url = new URL(request.url);
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email || email.length > 200) return responder({ ok: false, erro: 'Informe o e-mail do cliente.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return responder({ ok: false, erro: 'E-mail inválido.' }, 400);

  const { base, svc } = admin;
  const emailQ = encodeURIComponent(email);

  // perfil (tenta exato, depois sem diferenciar maiúsculas)
  let perfis = await sb(base, svc, 'profiles?email=eq.' + emailQ + '&select=id,email,name,plan,features,license_expires_at,lifetime,max_devices,created_at,updated_at,is_admin&limit=1');
  if (!Array.isArray(perfis) || !perfis.length) {
    perfis = await sb(base, svc, 'profiles?email=ilike.' + emailQ + '&select=id,email,name,plan,features,license_expires_at,lifetime,max_devices,created_at,updated_at,is_admin&limit=1');
  }
  if (!Array.isArray(perfis) || !perfis.length) {
    return responder({ ok: false, erro: 'Nenhuma conta com este e-mail.' }, 404);
  }
  const cliente = perfis[0];

  const [devices, vendas, chaves, hardware] = await Promise.all([
    sb(base, svc, 'devices?user_id=eq.' + encodeURIComponent(cliente.id) + '&select=id,hwid,board,device_name,first_seen,last_seen&order=last_seen.desc'),
    sb(base, svc, 'vendas?email=eq.' + encodeURIComponent(cliente.email || email) + '&select=id,pagamento_id,plano,valor,dias,metodo,status,criado_em&order=criado_em.desc&limit=50'),
    sb(base, svc, 'chaves?usado_por=eq.' + encodeURIComponent(cliente.id) + '&select=codigo,plano,dias,usado_em,cancelada,criado_em&order=usado_em.desc&limit=50'),
    sb(base, svc, 'hardware?user_id=eq.' + encodeURIComponent(cliente.id) + '&select=gpu,cpu,ram_gb,sistema,atualizado_em&limit=1'),
  ]);

  const listaVendas = Array.isArray(vendas) ? vendas : [];
  const totalPago = listaVendas
    .filter((v) => String(v.status || '').toLowerCase() === 'approved')
    .reduce((s, v) => s + Number(v.valor || 0), 0);

  return responder({
    ok: true,
    cliente,
    devices: Array.isArray(devices) ? devices : [],
    vendas: listaVendas,
    chaves: Array.isArray(chaves) ? chaves : [],
    hardware: Array.isArray(hardware) && hardware.length ? hardware[0] : null,
    resumo: {
      total_pago: Math.round(totalPago * 100) / 100,
      compras: listaVendas.length,
      pcs: Array.isArray(devices) ? devices.length : 0,
      chaves: Array.isArray(chaves) ? chaves.length : 0,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  return responder({ ok: false, erro: 'Use GET.' }, 405);
}
