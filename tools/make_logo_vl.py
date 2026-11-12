from PIL import Image, ImageDraw

W = 2048
S = W / 512.0

V = [(50, 140), (120, 140), (175, 340), (230, 140), (300, 140), (205, 412), (145, 412)]
L = [(330, 140), (410, 140), (410, 352), (500, 352), (500, 412), (330, 412)]

def poly(pts):
    return [(x * S, y * S) for (x, y) in pts]

# máscara das duas letras
mask = Image.new("L", (W, W), 0)
d = ImageDraw.Draw(mask)
d.polygon(poly(V), fill=255)
d.polygon(poly(L), fill=255)

# gradiente vertical vermelho
grad = Image.new("RGBA", (W, W))
px = grad.load()
top = (255, 51, 64)
bot = (176, 0, 14)
for y in range(W):
    t = y / (W - 1)
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    for x in range(W):
        px[x, y] = (r, g, b, 255)

logo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
logo.paste(grad, (0, 0), mask)
logo512 = logo.resize((512, 512), Image.LANCZOS)
logo512.save(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\assets\logo.png")

# variante branca (mesma forma)
white = Image.new("RGBA", (W, W), (255, 255, 255, 255))
wlogo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
wlogo.paste(white, (0, 0), mask)
wlogo.resize((512, 512), Image.LANCZOS).save(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\assets\logo-branco.png")

# ícone
logo512.save(r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\assets\icon.png")
logo512.save(
    r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\assets\icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("logo VL gerado")
