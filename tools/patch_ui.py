import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── main: games com estado do modo automático ──
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace(
    "H('games-scan', () => ex.gamesScan());\nH('games-status', () => ex.gamesStatus());",
    "H('games-scan', async () => { const r = await ex.gamesScan(); const a = feat.autoState(); return { ...r, autoMode: a.on, autoGame: a.game }; });\nH('games-status', async () => { const r = await ex.gamesStatus(); const a = feat.autoState(); return { ...r, autoMode: a.on, autoGame: a.game }; });",
)
io.open(p, "w", encoding="utf-8").write(s)
print("main games ok", "autoMode: a.on" in s)

# ── dashboard: banner de admin + toast do atalho ──
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
if "adm-bar" not in s:
    script = """
<script>
// Modo limitado: avisa quando o app nao conseguiu rodar como administrador.
(function () {
  if (!window.electron || !window.electron.invoke) return;
  window.electron.invoke('admin-status').then(function (st) {
    if (!st || st.admin) return;
    var bar = document.createElement('div');
    bar.className = 'adm-bar';
    var t = document.createElement('span');
    t.textContent = 'Modo limitado: servicos, DISM e plano de energia precisam de administrador.';
    var b = document.createElement('button');
    b.className = 'adm-btn';
    b.textContent = 'Reabrir como admin';
    b.onclick = function () {
      window.electron.invoke('elevate-now').then(function (r) {
        if (!r || !r.success) { try { toast('Elevacao cancelada.'); } catch (e) {} }
      });
    };
    bar.append(t, b);
    var main = document.querySelector('.main');
    if (main) main.prepend(bar);
  }).catch(function () {});
  window.electron.on('fps-hotkey', function (r) {
    try {
      toast(r && r.success ? 'Base marcada: ' + Math.round(r.base.fps) + ' FPS.' : 'Abra um jogo para marcar a base.');
    } catch (e) {}
  });
})();
</script>
"""
    s = s.replace("</body>", script + "\n</body>", 1)
    io.open(p, "w", encoding="utf-8").write(s)
    print("dashboard banner ok")
else:
    print("banner jÃ¡ existe")

# ── tema-l.css: estilo do banner ──
p = ROOT + r"\src\tema-l.css"
s = io.open(p, encoding="utf-8").read()
if ".adm-bar" not in s:
    s += """
/* ── Aviso de modo limitado (sem administrador) ── */
.adm-bar {
  display: flex; align-items: center; gap: 12px; margin: 10px 28px 0; padding: 10px 14px;
  border-radius: 10px; background: rgba(255, 31, 46, 0.10); border: 1px solid rgba(255, 85, 96, 0.35);
  color: var(--text2); font-size: 12.5px; font-weight: 500;
}
.adm-bar span { flex: 1; min-width: 0; }
.adm-btn {
  flex-shrink: 0; padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer;
  background: var(--grad-cta); color: #0a0910; font-family: inherit; font-weight: 800; font-size: 12px;
}
.adm-btn:hover { filter: brightness(1.06); }
"""
    io.open(p, "w", encoding="utf-8").write(s)
    print("css ok")
