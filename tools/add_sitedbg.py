import io
p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\main.js"
s = io.open(p, encoding="utf-8").read()
old = "    const spots = [['01-hero', 0], ['02-recursos', 980], ['03-prints', 2050], ['04-precos', 3300], ['05-faq', 4300]];"
new = """    const dbg = await sw.webContents.executeJavaScript(`(function(){
      const f = document.querySelector('.shot-frame'); const i = document.querySelector('#shotImg');
      const cs = i ? getComputedStyle(i) : null;
      return { frame: f ? f.getBoundingClientRect().width : null, img: i ? i.getBoundingClientRect().width : null,
               cssW: cs ? cs.width : null, maxW: cs ? cs.maxWidth : null, natural: i ? i.naturalWidth : null,
               grid: getComputedStyle(document.querySelector('.showcase-grid')).gridTemplateColumns };
    })()`);
    console.log('SITEDBG ' + JSON.stringify(dbg));
    const spots = [['01-hero', 0], ['02-recursos', 980], ['03-prints', 2050], ['04-precos', 3300], ['05-faq', 4300]];"""
if old not in s:
    raise SystemExit("spots nÃ£o encontrado")
s = s.replace(old, new, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
