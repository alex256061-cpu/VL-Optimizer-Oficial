import os, re, sys

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
SRC = os.path.join(ROOT, "src")

HEX = {
    "#6b35d4": "#c8101f",
    "#9480c0": "#ff6b74",
    "#a78bfa": "#ff5560",
    "#7c3aed": "#e0101f",
    "#8b5cf6": "#ff1f2e",
    "#c4b5fd": "#ff9aa2",
    "#5b21b6": "#a30f1a",
    "#d8ccff": "#ffe3e5",
    "#d4c8ff": "#ffdfe2",
    "#6d28d9": "#b3101c",
    "#c9b8ff": "#ffd4d8",
    "#4c1d95": "#8f0c15",
    "#ece6ff": "#ffedee",
    "#a855f7": "#ff1f2e",
    "#7c5cff": "#ff3341",
    "#9d6bff": "#ff5560",
    "#b794f6": "#ff8a91",
    "#e9e2ff": "#ffeef0",
    "#f3eeff": "#fff4f5",
    "#2d1b69": "#3a0508",
    "#1e1442": "#26070a",
}
RGB = {
    "124,58,237": "224,16,31",
    "139,92,246": "255,31,46",
    "167,139,250": "255,85,96",
    "107,53,212": "200,12,25",
    "196,181,253": "255,154,162",
    "76,29,149": "143,12,21",
    "237,233,254": "255,237,238",
    "91,33,182": "163,15,26",
    "192,132,252": "255,110,120",
    "237,232,251": "255,240,241",
    "109,40,217": "179,16,28",
    "236,226,255": "255,238,240",
    "46,16,101": "70,8,12",
    "221,214,254": "255,226,229",
    "216,204,255": "255,227,230",
    "192,38,211": "230,16,30",
    "59,35,117": "80,10,15",
    "74,123,224": "224,60,70",
}

BRAND = [
    ("GDZ Optimizer", "L Optimizer"),
    ("GDZ Scaling", "L Scaling"),
    ("GDZOptimizer.ico", "LOptimizer.ico"),
    ("GDZ FG", "L FG"),
    ("GDZ", "L"),
    ("Gdz", "L"),
]

def fix(text):
    for a, b in HEX.items():
        text = text.replace(a, b)
        text = text.replace(a.upper(), b)
    for a, b in RGB.items():
        text = text.replace(a, b)
    for a, b in BRAND:
        text = text.replace(a, b)
    return text

changed = []
for dp, dn, fn in os.walk(SRC):
    for f in fn:
        if not f.endswith(('.css', '.js', '.html')):
            continue
        p = os.path.join(dp, f)
        s = open(p, encoding='utf-8', errors='strict').read()
        n = fix(s)
        # sidebar logo: inline base64 image -> external asset
        n = re.sub(r'<img[^>]*src="data:image/png;base64,[^"]*"[^>]*>', '<img src="../assets/logo.png" alt="" style="width:30px;height:30px;object-fit:contain;flex-shrink:0"/>', n)
        # titlebar / gyro logo
        n = n.replace('src="logo.png"', 'src="../assets/logo.png"')
        if n != s:
            open(p, 'w', encoding='utf-8').write(n)
            changed.append(f)

print("changed:", len(changed))
for c in sorted(changed):
    print(" ", c)
