import io, re

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# ── janela separada: tradução completa ──
p = ROOT + r"\src\gdz-scaling.html"
s = io.open(p, encoding="utf-8").read()

pairs = [
    ('<div class="sb-hdr-title">Game Profiles</div>', '<div class="sb-hdr-title">Perfis de jogo</div>'),
    ("""onclick="selectProfile(this,'Default')">Default</div>""", """onclick="selectProfile(this,'Default')">Padrão</div>"""),
    ('<span class="pbar-lbl">Profile:</span>', '<span class="pbar-lbl">Perfil:</span>'),
    ('<span class="pbar-name" id="pbar-name">"Default"</span>', '<span class="pbar-name" id="pbar-name">"Padrão"</span>'),
    ('>Frame Generation<', '>Geração de quadros<'),
    ('>Scaling<', '>Redimensionamento<'),
    ('>Capture<', '>Captura<'),
    ('>Rendering<', '>Renderização<'),
    ('>Auto Scale<', '>Escala automática<'),
    ('class="flbl">Type<', 'class="flbl">Tipo<'),
    ('class="flbl">Mode<', 'class="flbl">Modo<'),
    ('class="flbl">Target<', 'class="flbl">Alvo<'),
    ('class="flbl">Flow scale<', 'class="flbl">Escala de fluxo<'),
    ('class="flbl">Performance mode<', 'class="flbl">Modo desempenho<'),
    ('class="flbl">Scale factor<', 'class="flbl">Fator de escala<'),
    ('class="flbl">Sharpness<', 'class="flbl">Nitidez<'),
    ('class="flbl">Resize before scaling<', 'class="flbl">Redimensionar antes de escalar<'),
    ('class="flbl">Capture API<', 'class="flbl">API de captura<'),
    ('class="flbl">Queue target<', 'class="flbl">Alvo da fila<'),
    ('class="flbl">Clip cursor<', 'class="flbl">Prender cursor<'),
    ('class="flbl">Scale cursor<', 'class="flbl">Escalar cursor<'),
    ('class="flbl">Sync mode<', 'class="flbl">Modo de sincronização<'),
    ('class="flbl">Max frame latency<', 'class="flbl">Latência máxima de quadros<'),
    ('class="flbl">HDR support<', 'class="flbl">Suporte a HDR<'),
    ('class="flbl">Draw FPS<', 'class="flbl">Mostrar FPS<'),
    ('class="flbl">Variable rate scaling<', 'class="flbl">Sombreamento variável (VRS)<'),
    ('class="flbl">Auto Scale<', 'class="flbl">Escala automática<'),
    ('class="flbl">Start minimized<', 'class="flbl">Iniciar minimizado<'),
    ('class="flbl">Start as Admin<', 'class="flbl">Iniciar como administrador<'),
    ('<option value="off">Off</option>', '<option value="off">Desligado</option>'),
    ('<option value="off" selected>Off</option>', '<option value="off" selected>Desligado</option>'),
    ('<option value="adaptive" selected>Adaptive</option>', '<option value="adaptive" selected>Adaptativo</option>'),
    ('<option value="adaptive">Adaptive</option>', '<option value="adaptive">Adaptativo</option>'),
    ('<option value="fixed">Fixed</option>', '<option value="fixed">Fixo</option>'),
    ('<option value="fusion" selected>Fusion</option>', '<option value="fusion" selected>Fusão</option>'),
    ('<option value="auto" selected>Auto</option>', '<option value="auto" selected>Automático</option>'),
    ('<option value="custom">Custom</option>', '<option value="custom">Personalizado</option>'),
    ('<option value="integer">Integer</option>', '<option value="integer">Inteiro</option>'),
    ('<option value="nearest">Nearest Neighbor</option>', '<option value="nearest">Vizinho mais próximo</option>'),
    ('<option value="standard" selected>Default</option>', '<option value="standard" selected>Padrão</option>'),
    ('>Inactive<', '>Inativo<'),
    ('>Stop<', '>Parar<'),
    ('>Scale<', '>Aplicar<'),
]
for a, b in pairs:
    if a in s:
        s = s.replace(a, b)
    else:
        print('AVISO janela:', a[:60])
io.open(p, "w", encoding="utf-8").write(s)
print('janela ok')

# ── aba do dashboard: só o trecho da página de scaling ──
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
start = s.find('<div id="pg-scaling" class="page">')
end = s.find('<!-- ═══ ', start + 10)
if start < 0:
    raise SystemExit("pg-scaling nÃ£o encontrado")
seg = s[start:end]
rep = [
    ('Painel completo de Frame Generation e Upscaling', 'Painel completo de geração de quadros e redimensionamento'),
    ('>Target FPS<', '>FPS alvo<'),
    ('>Flow Scale<', '>Escala de fluxo<'),
    ('>Capture API<', '>API de captura<'),
    ('Rastreamento (Upscaling)', 'Redimensionamento'),
    ('Tipo de Upscaling', 'Tipo de redimensionamento'),
    ('Modo de Scaling', 'Modo de redimensionamento'),
    ('Modo Performance', 'Modo desempenho'),
    ('Variable Rate Scaling', 'Sombreamento variável (VRS)'),
    ('>FSR Tipo<', '>Tipo de FSR<'),
    ('>Fullscreen<', '>Tela cheia<'),
    ('>Stretch<', '>Esticar<'),
    ('>Fit<', '>Ajustar<'),
    ('>Integer<', '>Inteiro<'),
    ('>Nearest Neighbor<', '>Vizinho mais próximo<'),
    ('>Auto<', '>Automático<'),
    ('>Custom<', '>Personalizado<'),
]
for a, b in rep:
    if a in seg:
        seg = seg.replace(a, b)
    else:
        print('AVISO dashboard:', a)
s = s[:start] + seg + s[end:]
io.open(p, "w", encoding="utf-8").write(s)
print('dashboard ok')
