// ══════════════════════════════════════════════════════════════════════════
// fotoSistema — a fotografia do estado do Windows antes de aplicar um ajuste.
//
// Fonte do que isto faz: C:\VLTemp\TIME\t1-backup.md (T1) e o GDZ Optimizer:
// o GDZ chama takeSnapshot() ANTES de qualquer tweak e, se a foto falhar, NÃO
// aplica nada. A foto cobre 8 tipos de item:
//
//   reg     -> chave de registro (kind + valor, com as conversões do GDZ)
//   svc     -> serviço (modo, delayed, rodando?)
//   scheme  -> GUID do plano de energia ativo
//   pwr     -> índice AC de uma subconfiguração do plano
//   bcd     -> elemento do boot (bcdedit)
//   tcp     -> RSS / autotuning / heuristics
//   dns     -> NameServer de cada adaptador ativo
//   drs     -> chave do driver NVIDIA (só via NVAPI; ver DRS_PS)
//
// Fica em arquivo próprio de propósito: o script PowerShell embutido tem cifrão
// e barra invertida que brigam com o template literal do JavaScript. Separado,
// cada lado é validado com a sua própria ferramenta (node --check e o parser do
// PowerShell) e não há como um quebrar o outro.
//
// Uso:
//   const { fotoSistema } = require('./foto-sistema');
//   const foto = await fotoSistema({ reg: [{ path, name }], svc: ['Spooler'] }, ps);
//
// O `ps` é injetado para este módulo não depender do engine (evita ciclo de
// require). Se não for passado, devolve [] em vez de lançar.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ARQUIVO_PS = path.join(__dirname, 'snapshot.ps1');

/**
 * @param {object} spec  { reg:[{path,name}], svc:[nome], pwr:[{sub,set}],
 *                         bcd:[elemento], tcp:[tipo], dns:true }
 * @param {function} ps  a função que executa PowerShell e devolve {ok,out,err}
 * @returns {Promise<Array>} lista de itens fotografados (vazia em caso de falha)
 */
async function fotoSistema(spec, ps) {
  if (typeof ps !== 'function') return [];
  const s = spec || {};
  const tem =
    (s.reg && s.reg.length) ||
    (s.svc && s.svc.length) ||
    (s.pwr && s.pwr.length) ||
    (s.bcd && s.bcd.length) ||
    (s.tcp && s.tcp.length) ||
    s.dns;
  if (!tem) return [];

  let tmpl;
  try {
    tmpl = fs.readFileSync(ARQUIVO_PS, 'utf8');
  } catch (e) {
    return [];
  }

  // O spec vai em base64 para não depender de escape: o texto aparece dentro de
  // uma string do PowerShell e qualquer aspa no caminho ('D:\Jogos\Nome do Jogo')
  // quebraria a linha se fosse concatenado cru.
  const dados = Buffer.from(
    JSON.stringify({
      reg: (s.reg || []).map((r) => ({ path: r.path, name: r.name })),
      svc: s.svc || [],
      pwr: s.pwr || [],
      bcd: s.bcd || [],
      tcp: s.tcp || [],
      dns: !!s.dns,
    }),
    'utf8'
  ).toString('base64');

  // Montagem por arrays de string, sem template literal: assim nenhum cifrão do
  // PowerShell é interpretado pelo JavaScript.
  const cabeca = [
    'try {',
    "  $gdz = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + dados + "'))",
    '  $spec = $gdz | ConvertFrom-Json',
    '} catch { $spec = $null }',
    'if (-not $spec) { Write-Output (Json @()); exit 0 }',
    '',
  ].join('\n');

  let out;
  try {
    out = await ps(cabeca + '\n' + tmpl, 45000);
  } catch (e) {
    return [];
  }
  if (!out || !out.ok || !out.out) return [];

  try {
    const j = JSON.parse(out.out);
    if (!j) return [];
    return Array.isArray(j) ? j : [j];
  } catch (e) {
    return [];
  }
}

module.exports = { fotoSistema, ARQUIVO_PS };
