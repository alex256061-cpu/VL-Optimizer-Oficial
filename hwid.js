// hwid.js — identificador do PC, no mesmo método da referência.
//
// O script abaixo foi recuperado do código da referência (constante HWID_SCRIPT). Ele lê três
// coisas e concatena: ProcessorId da CPU, serial da placa-mãe e o MachineGuid do Windows.
// Se algo falhar, devolve HWID_FAIL e o app não deixa entrar (igual lá).
//
// O valor sai como um hash SHA-256: o servidor nunca precisa ver o dado bruto do PC.
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

/// Roda o script e devolve { id, board, raw } ou null quando falha.
function ler() {
  if (cache) return cache;
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const dir = os.tmpdir();
  const arq = path.join(dir, 'vl-hwid.ps1');
  try {
    fs.writeFileSync(arq, '\ufeff' + SCRIPT, 'utf8');
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', arq],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    try { fs.unlinkSync(arq); } catch (e) { }

    const linhas = String(out || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!linhas.length || linhas[0] === 'HWID_FAIL') return null;

    const raw = linhas[0];
    const board = (linhas.find((l) => l.startsWith('BOARD:')) || '').slice(6);

    // O identificador enviado é o hash: o servidor não precisa do dado bruto do PC.
    const id = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    cache = { id, board, raw, deviceName: os.hostname().slice(0, 32) };
    return cache;
  } catch (e) {
    try { fs.unlinkSync(arq); } catch (e2) { }
    return null;
  }
}

/// Verifica se o HWID é utilizável, no mesmo critério da referência.
function valido(h) {
  if (!h || !h.id) return false;
  if (h.raw === 'HWID_FAIL') return false;
  return h.id.length >= 16;
}

/// Nome do computador para o servidor mostrar ("PC do fulano").
function nome() {
  try { return os.hostname() || ''; } catch (e) { return ''; }
}

module.exports = { ler, valido, nome, SCRIPT };
