// hwid.js — identificador do PC.
//
// O script abaixo foi recuperado do código da referência (constante HWID_SCRIPT). Ele lê três
// coisas e concatena: ProcessorId da CPU, serial da placa-mãe e o MachineGuid do Windows.
// Se algo falhar, devolve HWID_FAIL e o app não deixa entrar (igual lá).
//
// DIFERENÇA CONSCIENTE DO GDZ: o programa de referência envia o texto cru
// (CPU + serial da placa-mãe + MachineGuid). Aqui o valor vira SHA-256 antes de
// sair, então o servidor nunca vê o serial nem o MachineGuid. Trocar isso agora
// mudaria o ID de todos os clientes que já têm licença presa ao PC, então fica
// como está.
'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

// Script idêntico ao da referência.
const SCRIPT = `
$fail = $false
try { $cpu   = (Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1).ProcessorId  } catch { $fail = $true }
try { $board = (Get-CimInstance Win32_BaseBoard -ErrorAction Stop | Select-Object -First 1).SerialNumber } catch { $fail = $true }
try { $uuid  = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid } catch { $fail = $true }
if ($fail) { Write-Output 'HWID_FAIL'; exit }
$raw = "$cpu$board$uuid" -replace '\\s',''
if ($raw.Length -lt 8) { $raw = $env:COMPUTERNAME + $env:PROCESSOR_IDENTIFIER }
Write-Output $raw
Write-Output ('BOARD:' + "$board".Trim())
`;

let cache = null;

/// Roda o script UMA vez. Devolve { id, board, raw } ou null.
function tentar() {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const dir = os.tmpdir();
  const arq = path.join(dir, 'vl-hwid-' + Date.now() + '.ps1');
  try {
    fs.writeFileSync(arq, '\ufeff' + SCRIPT, 'utf8');
    // 12 s: o mesmo tempo que o programa de referência dá para o WMI responder.
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', arq],
      { encoding: 'utf8', windowsHide: true, timeout: 12000 });
    try { fs.unlinkSync(arq); } catch (e) { }

    const linhas = String(out || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!linhas.length || linhas[0] === 'HWID_FAIL') return null;

    const raw = linhas[0].replace(/\s+/g, '');
    // O "BOARD:" é cortado em 128 no GDZ; sem isso um serial gigante viaja à toa.
    const board = (linhas.find((l) => l.startsWith('BOARD:')) || '').slice(6).trim().slice(0, 128);

    // 6 é o mínimo do GDZ para o texto cru. Aqui o valor vira hash antes de sair,
    // então o mínimo é aplicado ao texto, não ao hash.
    if (!raw || raw === 'HWID_FAIL' || raw.length < 6) return null;

    const id = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    return { id, board, raw, deviceName: os.hostname().slice(0, 64) };
  } catch (e) {
    try { fs.unlinkSync(arq); } catch (e2) { }
    return null;
  }
}

/// Lê o identificador, com as mesmas 3 tentativas de 2 em 2 segundos do GDZ.
///
/// O WMI (Win32_Processor/Win32_BaseBoard) costuma responder "nenhuma instância"
/// logo depois do boot ou durante um pico de disco. Uma tentativa só fazia o
/// cliente cair na tela de login com 'bad_hwid' e ele não tinha o que fazer.
function ler() {
  if (cache) return cache;
  for (let i = 0; i < 3; i++) {
    const r = tentar();
    if (r) { cache = r; return cache; }
    if (i < 2) {
      // espera 2 s entre tentativas, sem travar o processo principal: usa sleep
      // sincrono curto porque esta função é chamada no boot e precisa devolver
      // o valor antes de abrir a janela.
      try { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)'], { timeout: 4000 }); } catch (e) { }
    }
  }
  return null;
}

/// Verifica se o HWID é utilizável.
///
/// O critério do GDZ é `id.length >= 6` porque lá o id é o texto cru. Aqui o id
/// é sempre sha256 (64 hex), então testar o id seria um teste morto — quem tem de
/// passar pelo mínimo é o TEXTO de origem, que é o que `ler()` já valida antes de
/// calcular o hash. Aqui só se confere que o hash foi calculado.
function valido(h) {
  if (!h || !h.id) return false;
  if (h.raw === 'HWID_FAIL') return false;
  return /^[0-9a-f]{64}$/.test(h.id);
}

/// Nome do computador para o servidor mostrar ("PC do fulano").
function nome() {
  try { return os.hostname() || ''; } catch (e) { return ''; }
}

module.exports = { ler, valido, nome, SCRIPT };
