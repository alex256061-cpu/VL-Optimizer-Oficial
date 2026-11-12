from PIL import Image, ImageDraw, ImageFont

base = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\shots"
frames = [Image.open(base + "\\anim-%d.png" % i).convert("RGBA") for i in range(4)]
w, h = frames[0].size
pad = 14
label_h = 34
sheet = Image.new("RGBA", (w * 2 + pad * 3, (h + label_h) * 2 + pad * 3), (12, 8, 14, 255))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 20)
except Exception:
    font = ImageFont.load_default()
labels = ["0 s", "0,75 s", "1,5 s", "2,25 s"]
for i, f in enumerate(frames):
    col, row = i % 2, i // 2
    x = pad + col * (w + pad)
    y = pad + row * (h + label_h + pad)
    sheet.paste(f, (x, y + label_h), f)
    d.text((x + 4, y + 6), labels[i], fill=(235, 230, 240, 255), font=font)
sheet.save(base + "\\anim-sheet.png")
print("sheet", sheet.size)
