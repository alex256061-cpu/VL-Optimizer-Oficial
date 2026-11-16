// ══════════════════════════════════════════════════════════════════════════
// NOME DA MARCA DENTRO DE TAGS
//
// O nome do produto aparece no HTML quebrado em pedaços estilizados:
//
//   <div class="marca-ic">VL</div>                          -> a sigla no quadrado
//   <div class="marca-nome">VL <span>Optimizer</span></div> -> "VL " + "Optimizer"
//   <span class="tb-app"><b>VL</b><i>Optimizer</i></span>   -> topo do dashboard
//   <div class="about-title">VL <span>Optimizer</span></div> -> cartão Sobre
//
// Um replace simples de "VL Optimizer" não pega nenhum destes: não existe a string
// "VL Optimizer" contínua, ela é montada por marcação. Foi por isso que o ZONEX abriu
// com "<b>VL</b><i>Optimizer</i>" no topo mesmo com todo o resto trocado.
//
// Aqui cada padrão é reconhecido e o nome da marca é injetado:
//   - a sigla vira as iniciais da marca (ZONEX -> ZX, Optimizer Pro -> OP)
//   - o nome dentro das tags vira a marca, com a primeira palavra em <b> e o resto em
//     <span>/<i> para manter o estilo de duas cores do tema
// ══════════════════════════════════════════════════════════════════════════

// Iniciais da marca: "ZONEX" -> "ZX"; "Optimizer Pro" -> "OP".
function sigla(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 1) {
    const p = partes[0];
    // uma palavra: primeira e ultima letra de verdade
    return (p[0] + (p.length > 1 ? p[p.length - 1] : '')).toUpperCase();
  }
  return partes.map((p) => p[0]).join('').slice(0, 3).toUpperCase();
}

// Divide o nome em duas partes para manter as duas cores do tema.
function duasPartes(nome) {
  const n = String(nome || '').trim();
  const i = n.indexOf(' ');
  if (i < 0) return [n, ''];
  return [n.slice(0, i), n.slice(i + 1)];
}

/**
 * Troca o nome dentro das tags.
 * @param {string} html  conteúdo do arquivo
 * @param {string} nome  nome da marca ("ZONEX")
 * @returns {string}
 */
function trocarNomeEmTags(html, nome) {
  const S = sigla(nome);
  const [a, b] = duasPartes(nome);
  let c = String(html);

  // 1. quadrado com a sigla: <div class="marca-ic">VL</div> / <span class="brand-ic">VL</span>
  c = c.replace(
    /(<[a-z]+\s+class="[^"]*(?:marca-ic|brand-ic|logo-ic|sb-logo-ic)[^"]*"[^>]*>)\s*VL\s*(<\/[a-z]+>)/gi,
    '$1' + S + '$2'
  );

  // 2. "VL <span>Optimizer</span>"
  c = c.replace(
    /VL\s*<span[^>]*>\s*Optimizer\s*<\/span>/g,
    a + (b ? ' <span>' + b + '</span>' : '')
  );

  // 3. "<b>VL</b><i>Optimizer</i>" (topo do dashboard)
  c = c.replace(
    /<b>\s*VL\s*<\/b>\s*<i>\s*Optimizer\s*<\/i>/g,
    '<b>' + a + '</b>' + (b ? '<i>' + b + '</i>' : '')
  );

  // 4. "VL Optimizer" com entidades (&nbsp; etc.) — cobre o resto
  c = c.replace(/VL&nbsp;Optimizer/g, nome);

  return c;
}

module.exports = { trocarNomeEmTags, sigla, duasPartes };
