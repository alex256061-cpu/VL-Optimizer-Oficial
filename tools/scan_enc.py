import os, io
SRC = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\src"
for dp, dn, fn in os.walk(SRC):
    for f in fn:
        if not f.endswith((".css", ".js", ".html")):
            continue
        p = os.path.join(dp, f)
        raw = open(p, "rb").read()
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as e:
            print("NAO UTF8:", p, e)
print("scan ok")
