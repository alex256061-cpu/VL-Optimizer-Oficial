// ══════════════════════════════════════════════════════════════════════════
// restaurar-sistema — o desfazer dos 8 tipos de item da foto.
//
// Espelho do fotoSistema(): o foto-sistema.js TIRA a foto (snapshot.ps1) e este
// RESTAURA a foto (restore.ps1). Fonte: o "desfazer" do GDZ Optimizer, seção
// restoreItems de C:\VLTemp\TIME\t1-backup.md e o RESTORE_PS de
// C:\VLTemp\TIME\t8-templates.md.
//
// Os 8 tipos:
//   reg     -> Set-ItemProperty com o kind certo (Binary = byte[], MultiString = array)
//              ou Remove-ItemProperty quando o valor não existia antes
//   svc     -> sc.exe config start= <auto|delayed-auto|demand|disabled> + Start-Service
//   scheme  -> powercfg /setactive <GUID>
//   pwr     -> powercfg /setacvalueindex + reativar o plano no fim
//   bcd     -> bcdedit /set ou /deletevalue
//   tcp     -> netsh int tcp set global (rss / autotuninglevel) ou set heuristics
//   dns     -> Set-DnsClientServerAddress (ou -ResetServerAddresses)
//   drs     -> [GDZ.Drs]::Set/Del, do bloco NVAPI em drs.ps1
//
// Diferenças de ENCANAMENTO em relação ao GDZ (nenhuma de comportamento):
//   - o GDZ embute o script num template literal e troca __DATA__; aqui o script
//     mora em restore.ps1 (cifrão e barra invertida não brigam com o JS) e o
//     dado vai por uma linha de cabeçalho que define $itens.
//   - o GDZ prefixa o DRS_PS sempre que há item drs (withDrs); aqui o mesmo
//     critério concatena o drs.ps1.
//   - o GDZ usa ACTION_TIMEOUT = 90000 ms; aqui é o mesmo.
//
// Uso:
//   const { desfazerFoto } = require('./restaurar-sistema');
//   const r = await desfazerFoto(foto.fotoExtra, ps);
//   // r = { ok, aplicados, falhas }
//
// O `ps` é injetado para este módulo não depender do engine (evita ciclo de
// require). Se não vier, devolve ok:false sem mexer no sistema.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ARQUIVO_PS = path.join(__dirname, 'restore.ps1');
const ARQUIVO_DRS = path.join(__dirname, 'drs.ps1');

// 90000 ms: o ACTION_TIMEOUT do GDZ para restauração (t1-backup.md, L22).
const TIMEOUT = 90000;

// Só os tipos que o restore.ps1 conhece. Item de outro tipo é lixo de backup
// antigo e não entra na conta de "aplicados".
const TIPOS = ['reg', 'svc', 'scheme', 'pwr', 'bcd', 'tcp', 'dns', 'drs'];

function ler(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch (e) { return null; }
}

// Identifica o item para a lista de falhas. O GDZ monta essa etiqueta no próprio
// PowerShell ("$($i.t) $($i.name)$($i.el)$($i.k)$($i.id)"); aqui ela é montada
// igual no Node, para a falha ter nome legível mesmo se o script não disser qual foi.
function etiqueta(i) {
  const t = String(i && i.t || '?');
  if (t === 'reg') return 'reg ' + (i.path || '') + '\\' + (i.name || '');
  if (t === 'svc') return 'svc ' + (i.name || '');
  if (t === 'scheme') return 'scheme ' + (i.value || '');
  if (t === 'pwr') return 'pwr ' + (i.sub || '') + ' ' + (i.set || '');
  if (t === 'bcd') return 'bcd ' + (i.el || '');
  if (t === 'tcp') return 'tcp ' + (i.k || '');
  if (t === 'dns') return 'dns ' + (i.guid || '');
  if (t === 'drs') return 'drs ' + (i.id == null ? '' : i.id);
  return t;
}

// Nome curto do item, no mesmo formato que o PowerShell usa em $fail
// ("$($i.t) $($i.name)$($i.el)$($i.k)$($i.id)"). É por este texto que se sabe
// qual item o restaurar-sistema.js reportou como falho.
function chavePs(i) {
  const t = String(i && i.t || '');
  const s = (x) => (x == null ? '' : String(x));
  return t + ' ' + s(i.name) + s(i.el) + s(i.k) + s(i.id);
}

/**
 * Restaura uma lista de itens fotografados.
 *
 * @param {Array} itens  lista de itens no formato do snapshot.ps1
 *                       ({ t:'reg', path, name, exists, kind, value }, ...)
 * @param {function} ps  a função que executa PowerShell e devolve {ok,out,err}
 * @returns {Promise<{ok:boolean, aplicados:number, falhas:Array}>}
 *          `falhas` = [{ tipo, item, motivo }]
 */
async function desfazerFoto(itens, ps) {
  const lista = Array.isArray(itens) ? itens.filter(Boolean) : [];
  if (!lista.length) return { ok: true, aplicados: 0, falhas: [] };
  if (typeof ps !== 'function') {
    return { ok: false, aplicados: 0, falhas: [] };
  }

  // Tipo que o restore.ps1 não conhece não é enviado: ele ficaria sem ramo e
  // calado, e "aplicado" sem ter sido aplicado é pior do que "não sei".
  const validos = lista.filter((i) => TIPOS.includes(String(i && i.t)));
  const ignorados = lista.filter((i) => !TIPOS.includes(String(i && i.t)));
  if (!validos.length) {
    return {
      ok: true,
      aplicados: 0,
      falhas: ignorados.map((i) => ({ tipo: String(i && i.t), item: etiqueta(i), motivo: 'tipo desconhecido' })),
    };
  }

  const corpo = ler(ARQUIVO_PS);
  if (!corpo) return { ok: false, aplicados: 0, falhas: [{ tipo: '', item: 'restore.ps1', motivo: 'nao encontrado' }] };

  // O bloco NVAPI só entra se existir item 'drs' — é o withDrs() do GDZ.
  // Sem ele, o restore.ps1 nem toca na nvapi64.dll.
  let cabecaDrs = '';
  if (validos.some((i) => String(i.t) === 'drs')) {
    const drs = ler(ARQUIVO_DRS);
    if (!drs) return { ok: false, aplicados: 0, falhas: [{ tipo: 'drs', item: 'drs.ps1', motivo: 'nao encontrado' }] };
    cabecaDrs = drs + '\n';
  }

  // O dado vai em base64 para não depender de escape: o texto aparece dentro de
  // uma string do PowerShell e qualquer aspa no caminho ('D:\Jogos\Nome do Jogo')
  // quebraria a linha se fosse concatenado cru.
  const dados = Buffer.from(JSON.stringify(validos), 'utf8').toString('base64');

  // Montagem por arrays de string, sem template literal: assim nenhum cifrão do
  // PowerShell é interpretado pelo JavaScript.
  //
  // A primeira linha é o PS_UTF8 do GDZ. O erro de restauração cita o item e vai
  // para a tela; sem esta linha o texto acentuado sai trocado em algumas máquinas.
  const cabeca = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    'try {',
    "  $gdz = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + dados + "'))",
    '  $itens = $gdz | ConvertFrom-Json',
    '} catch { $itens = $null }',
    '',
  ].join('\n');

  let out;
  try {
    out = await ps(cabecaDrs + cabeca + '\n' + corpo, TIMEOUT);
  } catch (e) {
    return { ok: false, aplicados: 0, falhas: [{ tipo: '', item: '', motivo: String((e && e.message) || e) }] };
  }

  // O restore.ps1 do GDZ acumula os itens que falharam e só no fim emite uma
  // linha "GDZ_ERRO: não foi possível restaurar: <lista>". A restauração é
  // parcial de propósito: um item que falha não impede os outros.
  const bruto = String((out && out.out) || '');
  const mErro = /^GDZ_ERRO:\s*(.+)$/m.exec(bruto);
  const falhas = [];
  if (mErro) {
    const texto = mErro[1].trim();
    const prefixo = 'não foi possível restaurar:';
    const pos = texto.indexOf(prefixo);
    const listaTxt = pos >= 0 ? texto.slice(pos + prefixo.length) : texto;
    for (const parte of listaTxt.split(',')) {
      const chave = parte.trim();
      if (!chave) continue;
      // Casa a etiqueta do PowerShell com o item original, para a falha voltar
      // com o tipo e o nome legível e não só com o texto cru.
      const dono = validos.find((i) => chavePs(i) === chave);
      falhas.push({ tipo: dono ? String(dono.t) : chave.split(' ')[0], item: dono ? etiqueta(dono) : chave, motivo: 'nao restaurado' });
    }
    if (!falhas.length) falhas.push({ tipo: '', item: '', motivo: texto });
  }

  // Erro do próprio PowerShell (sem permissão, script recusado): o script inteiro
  // não rodou. Isso não é "item falhou", é "nada foi restaurado".
  const erroFora = String((out && out.err) || '').trim();
  if ((!out || !out.ok) && !mErro) {
    return { ok: false, aplicados: 0, falhas: [{ tipo: '', item: '', motivo: erroFora || 'o PowerShell nao executou a restauracao' }] };
  }

  const aplicados = Math.max(0, validos.length - falhas.length);
  return { ok: falhas.length === 0, aplicados, falhas };
}

module.exports = { desfazerFoto, ARQUIVO_PS, ARQUIVO_DRS, TIPOS };
