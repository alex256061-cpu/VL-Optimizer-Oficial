import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

old = """    $vramQ = 0
    try {
      $cls = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\d{4}$' }
      foreach ($k in $cls) {
        $pp = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        $q = $pp.'HardwareInformation.qwMemorySize'
        if ($q) { $vramQ = [int64]$q; break }
      }
    } catch {}"""
new = """    $vramMap = @{}
    try {
      $cls = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\d{4}$' }
      foreach ($k in $cls) {
        $pp = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        $q = $pp.'HardwareInformation.qwMemorySize'
        if ($q -and $pp.DriverDesc) { $vramMap[[string]$pp.DriverDesc] = [int64]$q }
      }
    } catch {}"""
if old not in s:
    raise SystemExit("vramQ nÃ£o encontrado")
s = s.replace(old, new, 1)

old2 = """vram=$(if ($_.AdapterRAM -gt 0 -and $_.AdapterRAM -lt 2147483648 -and $vramQ -gt 0) { $vramQ } else { [int64]$_.AdapterRAM });"""
new2 = """vram=$(if ($vramMap.ContainsKey([string]$_.Name)) { $vramMap[[string]$_.Name] } else { [int64]$_.AdapterRAM });"""
if old2 not in s:
    raise SystemExit("vram field nÃ£o encontrado")
s = s.replace(old2, new2, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("vram ok")
