import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\limpeza.js"
s = io.open(p, encoding="utf-8").read()

# 1) estado de medição
s = s.replace(
    "  const cl = { cats: null, sel: new Set(), done: new Map(), busy: false, error: null };",
    "  const cl = { cats: null, sel: new Set(), done: new Map(), busy: false, error: null, measure: null, polling: false };",
)

# 2) após receber o scan, liga o acompanhamento
s = s.replace(
    "    const first = !cl.cats;\n    cl.cats = r.cats;\n    cl.done.clear();",
    "    const first = !cl.cats;\n    cl.cats = r.cats;\n    cl.done.clear();\n    cl.measure = { measuring: !!r.measuring, index: r.index || 0, total: r.total || r.cats.length };\n    if (r.measuring) pollMeasure();",
)

# 3) função de acompanhamento (inserida antes de render)
anchor = "  function render() {"
poll = r"""  async function pollMeasure() {
    if (cl.polling) return;
    cl.polling = true;
    while (cl.polling) {
      await new Promise((r) => setTimeout(r, 800));
      const st = await invoke('clean-status');
      if (!st || !st.success) continue;
      cl.cats = st.cats;
      cl.measure = { measuring: !!st.measuring, index: st.index || 0, total: st.total || st.cats.length };
      const usableNow = st.cats.filter((c) => !c.open && c.bytes > 0);
      if (!st.measuring) {
        if (!cl.sel.size) cl.sel = new Set(usableNow.filter((c) => c.on).map((c) => c.id));
        else cl.sel = new Set([...cl.sel].filter((id) => usableNow.some((c) => c.id === id)));
      }
      render();
      if (!st.measuring) { cl.polling = false; break; }
    }
    cl.polling = false;
  }

  function render() {"""
if anchor not in s:
    raise SystemExit("render nÃ£o encontrado")
s = s.replace(anchor, poll, 1)

# 4) linha: "Medindo…" enquanto não mediu
old = """    } else if (c.bytes > 0) {
      sz.textContent = size(c.bytes);"""
new = """    } else if (!c.measured && cl.measure && cl.measure.measuring) {
      sz.classList.add('none');
      sz.textContent = 'Medindo…';
    } else if (c.bytes > 0) {
      sz.textContent = size(c.bytes);"""
if old not in s:
    raise SystemExit("linha do tamanho nÃ£o encontrada")
s = s.replace(old, new, 1)

# 5) rodapé com progresso
old_foot = "    else if (cl.cats) total.append(el('b', null, size(bytes)), el('span', null, sel.length ? `em ${sel.length} ${sel.length === 1 ? 'item' : 'itens'}` : 'nada selecionado'));"
new_foot = "    else if (cl.cats) total.append(el('b', null, size(bytes)), el('span', null, sel.length ? `em ${sel.length} ${sel.length === 1 ? 'item' : 'itens'}` : 'nada selecionado'));\n    if (cl.measure && cl.measure.measuring) total.append(el('span', 'cl-measuring', ` · medindo ${cl.measure.index}/${cl.measure.total}…`));"
if old_foot not in s:
    raise SystemExit("rodapÃ© nÃ£o encontrado")
s = s.replace(old_foot, new_foot, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("limpeza ui ok")
