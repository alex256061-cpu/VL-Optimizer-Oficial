import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()

old = '<div class="startup-info"><div class="startup-name">${escapeHtml(a.name)}</div><div class="startup-cmd" title="${escapeHtml(a.cmd)}">${escapeHtml(STARTUP_SCOPE[a.scope] || \'\')} \\u00b7 ${escapeHtml(a.cmd || \'\\u2014\')}</div></div>'
# procura o trecho real sem depender de escapes
idx = s.find('<div class="startup-info"><div class="startup-name">')
if idx < 0:
    raise SystemExit("template do startup nÃ£o encontrado")
end = s.find('</div></div>', idx)
end = s.find('</div></div>', end + 1)
# monta o novo trecho: insere o impacto depois do .startup-cmd
seg = s[idx:end + len('</div></div>')]
if 'startup-impact' in seg:
    print("impacto jÃ¡ existe")
else:
    # insere antes do fechamento do .startup-info (o último </div> do trecho)
    marker = '</div></div>'
    pos = seg.rfind(marker)
    impact_html = ('<div class="startup-impact" style="color:${a.impact === \'alto\' ? \'var(--error)\' : a.impact === \'medio\' ? \'var(--warning)\' : \'var(--success)\'}">Impacto estimado: ${a.impact === \'alto\' ? \'alto\' : a.impact === \'medio\' ? \'médio\' : \'baixo\'}</div>')
    novo = seg[:pos] + impact_html + seg[pos:]
    s = s[:idx] + novo + s[end + len('</div></div>'):]
    io.open(p, "w", encoding="utf-8").write(s)
    print("impacto inserido")
print("check:", "startup-impact" in s)
