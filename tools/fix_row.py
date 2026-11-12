import io, re

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()

pat = re.compile(r'<div class="startup-item\$\{[^>]*>.*?</div></div></div>', re.S)
m = pat.search(s)
if not m:
    raise SystemExit("template do startup nÃ£o encontrado")
row = (
    '<div class="startup-item${a.enabled ? \'\' : \' off\'}">'
    '<div class="startup-ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 9-14 9V3z" stroke="#c8101f" stroke-width="1.8" stroke-linejoin="round"/></svg></div>'
    '<div class="startup-info">'
    '<div class="startup-name">${escapeHtml(a.name)}</div>'
    '<div class="startup-cmd" title="${escapeHtml(a.cmd)}">${escapeHtml(STARTUP_SCOPE[a.scope] || \'\')} · ${escapeHtml(a.cmd || \'—\')}</div>'
    '<div class="startup-impact" style="color:${a.impact === \'alto\' ? \'var(--error)\' : a.impact === \'medio\' ? \'var(--warning)\' : \'var(--success)\'}">Impacto estimado: ${a.impact === \'alto\' ? \'alto\' : a.impact === \'medio\' ? \'médio\' : \'baixo\'}</div>'
    '</div>'
    '<div class="toggle${a.enabled ? \' on\' : \'\'}" data-startup="${i}" title="${a.enabled ? \'Desativar na inicialização\' : \'Ativar na inicialização\'}"></div>'
    '</div>'
)
s = s[:m.start()] + row + s[m.end():]
io.open(p, "w", encoding="utf-8").write(s)
print("template corrigido")
