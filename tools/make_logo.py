import os
from PIL import Image

SRC = r"C:\Users\lucas larado\.dsh\attachments\v1\objects\ac\ac641454d76fc5446d22105be7c1b49a13e3c64363105185cb9d152b4d9c61bb"
ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"
OUT = os.path.join(ROOT, "assets")
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# 1) the mark's shape is the alpha channel (transparent background)
alpha = img.getchannel("A")
bbox = alpha.getbbox()
alpha = alpha.crop(bbox)
cw, ch = alpha.size

# 2) red gradient + subtle diagonal sheen
grad = Image.new("RGB", (cw, ch))
gp = grad.load()
top = (255, 45, 56)
bot = (196, 0, 14)
for y in range(ch):
    t = (y / max(1, ch - 1)) ** 0.9
    r = int(top[0] + (bot[0] - top[0]) * t)
    g = int(top[1] + (bot[1] - top[1]) * t)
    b = int(top[2] + (bot[2] - top[2]) * t)
    for x in range(cw):
        s = (x / max(1, cw)) * 0.22
        gp[x, y] = (min(255, int(r + 40 * s)), min(255, int(g + 18 * s)), min(255, int(b + 20 * s)))

logo = Image.new("RGBA", (cw, ch))
logo.paste(grad, (0, 0), alpha)

# 3) padded square canvas
side = max(cw, ch)
pad = int(side * 0.08)
side_p = side + pad * 2
canvas = Image.new("RGBA", (side_p, side_p), (0, 0, 0, 0))
canvas.paste(logo, ((side_p - cw) // 2, (side_p - ch) // 2), logo)

# 4) exports
base = canvas.resize((1024, 1024), Image.LANCZOS)
base.save(os.path.join(OUT, "icon.png"))
base.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "logo.png"))
base.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "src", "logo.png"))
ico_sizes = (16, 24, 32, 48, 64, 128, 256)
ico_imgs = [base.resize((s, s), Image.LANCZOS) for s in ico_sizes]
ico_imgs[-1].save(os.path.join(OUT, "icon.ico"), format="ICO", sizes=[(s, s) for s in ico_sizes])

# 5) white variant for dark surfaces (sidebar, login)
white = Image.new("RGBA", (cw, ch), (255, 255, 255, 0))
white.putalpha(alpha)
canvas_w = Image.new("RGBA", (side_p, side_p), (0, 0, 0, 0))
canvas_w.paste(white, ((side_p - cw) // 2, (side_p - ch) // 2), white)
canvas_w.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "logo-branco.png"))

print("mark bbox:", bbox, "canvas:", side_p)
