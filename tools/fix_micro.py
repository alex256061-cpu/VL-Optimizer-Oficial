import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """    if ($uc) { try { $b = [byte[]]$uc; if ($b.Length -ge 4) { $micro = [BitConverter]::ToUInt32($b, 0).ToString('X') } } catch {} }"""
new = """    if ($uc) { try { $b = @($uc) | ForEach-Object { [int]$_ }; if ($b.Count -ge 4) { $micro = ('{0:X}' -f ([int64]$b[0] + [int64]$b[1] * 256 + [int64]$b[2] * 65536 + [int64]$b[3] * 16777216)) } } catch {} }"""
if old not in s:
    raise SystemExit("microcode nÃ£o encontrado")
s = s.replace(old, new, 1)

old2 = """        const m = mons.find((x) => x.active) || mons[i] || {};"""
new2 = """        const m = mons[i] || mons.find((x) => x.active) || {};"""
if old2 not in s:
    raise SystemExit("monitor map nÃ£o encontrado")
s = s.replace(old2, new2, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("ok")
