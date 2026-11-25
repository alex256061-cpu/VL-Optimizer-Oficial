/**
 * admin-pc-remove.js — desvincula UM computador específico de uma conta.
 *
 * POST /api/admin-pc-remove   { "deviceId": 123, "email": "cliente@..." }
 *   -> { ok, removido: { id, hwid, device_name, email } }
 *
 * É o "reset de PC por máquina": hoje o painel só tem "Trocar PC", que apaga todos
 * os PCs da conta. Aqui o admin tira só o aparelho escolhido (o cliente pode voltar a
 * ativar a licença no PC novo, sem perder o histórico do outro).
 *
 * Segurança: token do admin + is_admin; a conta dona do device é conferida antes de
 * apagar; o e-mail, quando enviado, precisa bater com o dono.
 */

import { exigirAdmin, cabecalhosServico, responder, metodoPermitido, lerCorpo } from './_admin.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const bloqueioMetodo = metodoPermitido(request, ['POST']);
  if (bloqueioMetodo) return bloqueioMetodo;

  const admin = await exigirAdmin(request, env);
  if (!admin.ok) return responder({ ok: false, erro: admin.erro }, admin.status);

  const corpo = await lerCorpo(request);
  if (!corpo) return responder({ ok: false, erro: 'Corpo inválido.' }, 400);

  const id = Number(corpo.deviceId);
  if (!Number.isFinite(id) || id <= 0) return responder({ ok: false, erro: 'Computador inválido.' }, 400);
  const emailConf = String(corpo.email || '').trim().toLowerCase();

  const { base, svc } = admin;
  const cab = cabecalhosServico(svc);

  let device = null;
  try {
    const r = await fetch(base + '/rest/v1/devices?id=eq.' + id + '&select=id,user_id,hwid,board,device_name,first_seen,last_seen', { headers: cab });
    const lista = r.ok ? await r.json() : [];
    device = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui ler o computador agora.' }, 502);
  }
  if (!device) return responder({ ok: false, erro: 'Computador não encontrado (talvez já tenha sido removido).' }, 404);

  // dono do device
  let dono = null;
  try {
    const r = await fetch(base + '/rest/v1/profiles?id=eq.' + encodeURIComponent(device.user_id) + '&select=id,email', { headers: cab });
    const lista = r.ok ? await r.json() : [];
    dono = Array.isArray(lista) && lista.length ? lista[0] : null;
  } catch (e) { dono = null; }

  if (emailConf && dono && String(dono.email || '').toLowerCase() !== emailConf) {
    return responder({ ok: false, erro: 'Este computador não pertence a esta conta.' }, 409);
  }

  try {
    const r = await fetch(base + '/rest/v1/devices?id=eq.' + id, {
      method: 'DELETE',
      headers: { ...cab, Prefer: 'return=representation' },
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('admin-pc-remove falhou:', r.status, txt);
      return responder({ ok: false, erro: 'O banco recusou a remoção (' + r.status + ').' }, 502);
    }
    const apagados = await r.json();
    if (!Array.isArray(apagados) || !apagados.length) {
      return responder({ ok: false, erro: 'Nenhuma linha removida — confira se o PC ainda existe.' }, 404);
    }
  } catch (e) {
    return responder({ ok: false, erro: 'Não consegui remover agora. Tente de novo.' }, 502);
  }

  return responder({
    ok: true,
    removido: {
      id: device.id,
      hwid: device.hwid,
      device_name: device.device_name,
      email: dono ? dono.email : null,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return responder({ ok: false, erro: 'Use POST.' }, 405);
}
