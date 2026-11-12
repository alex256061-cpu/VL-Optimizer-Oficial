import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
old = "} catch (e) { return { success: false, error: 'resposta inválida' }; }"
new = "} catch (e) { return { success: false, error: 'resposta inválida', raw: String(r.out || '').slice(0, 900) }; }"
if old not in s:
    raise SystemExit("nao achou")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
