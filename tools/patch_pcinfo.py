import io

p = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer\engine-extras.js"
s = io.open(p, encoding="utf-8").read()

# 1) CPU: microcode + caches reais (Win32_CacheMemory)
old_cpu = """    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1"""
new_cpu = """    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cpuKey = 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'
    $uc = (Get-ItemProperty $cpuKey -ErrorAction SilentlyContinue).'Update Revision'
    $micro = $null
    if ($uc) { try { $b = [byte[]]$uc; if ($b.Length -ge 4) { $micro = [BitConverter]::ToUInt32($b, 0).ToString('X') } } catch {} }
    $cm = @(Get-CimInstance Win32_CacheMemory -ErrorAction SilentlyContinue)
    $l1 = [int](($cm | Where-Object { $_.Level -eq 3 } | Measure-Object -Property InstalledSize -Sum).Sum)
    $l2 = [int](($cm | Where-Object { $_.Level -eq 4 } | Measure-Object -Property InstalledSize -Sum).Sum)
    $l3 = [int](($cm | Where-Object { $_.Level -eq 5 } | Measure-Object -Property InstalledSize -Sum).Sum)
    if (-not $l2) { $l2 = [int]$cpu.L2CacheSize }
    if (-not $l3) { $l3 = [int]$cpu.L3CacheSize }"""
if old_cpu not in s:
    raise SystemExit("cpu query nÃ£o encontrada")
s = s.replace(old_cpu, new_cpu, 1)

# 2) bateria real + monitores
old_bat = """    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue"""
new_bat = """    $bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    $batNew = $null
    try {
      $bs = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1
      $bf = Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
      $bc = Get-CimInstance -Namespace root\\wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1
      $bst = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($bs) { $batNew = @{ name=[string]$bs.DeviceName; design=[int]$bs.DesignedCapacity; full=$(if ($bf) { [int]$bf.FullChargedCapacity } else { 0 }); cycles=$(if ($bc) { [int]$bc.CycleCount } else { 0 }); percent=$(if ($bst) { [int]$bst.RemainingCapacity } else { 0 }); charging=$(if ($bst) { [bool]$bst.Charging } else { $false }); ac=$(if ($bst) { [bool]$bst.PowerOnline } else { $false }) } }
    } catch {}
    $monitors = @()
    try {
      $mon = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)
      $ids = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue)
      for ($i = 0; $i -lt $mon.Count; $i++) {
        $year = 0
        if ($i -lt $ids.Count) { $year = [int]$ids[$i].YearOfManufacture }
        $monitors += @{ wcm = [double]$mon[$i].MaxHorizontalImageSize; hcm = [double]$mon[$i].MaxVerticalImageSize; year = $year; active = [bool]$mon[$i].Active }
      }
    } catch {}"""
if old_bat not in s:
    raise SystemExit("bateria nÃ£o encontrada")
s = s.replace(old_bat, new_bat, 1)

# 3) campos do JSON
s = s.replace("cache=@{ l1=0; l2=[int]$cpu.L2CacheSize; l3=[int]$cpu.L3CacheSize }; features=@() }",
              "cache=@{ l1=$l1; l2=$l2; l3=$l3 }; features=@(); microcode=$micro }")
s = s.replace("disks = $disks; vols = $vols; displays = @(); nets = $net; battery = $bat",
              "disks = $disks; vols = $vols; displays = @(); monitors = $monitors; nets = $net; battery = $batNew")

# 4) JS: features por família/modelo + polegadas/ano na tela
old_js = """      info.displays = screen.getAllDisplays().map((d, i) => ({ name: d.label || ('Tela ' + (i + 1)), w: d.size.width, h: d.size.height, hz: d.displayFrequency || 60, primary: d.id === screen.getPrimaryDisplay().id, scale: Math.round((d.scaleFactor || 1) * 100), depth: 8, inches: null, year: null }));"""
new_js = """      const mons = Array.isArray(info.monitors) ? info.monitors : [];
      info.displays = screen.getAllDisplays().map((d, i) => {
        const m = mons.find((x) => x.active) || mons[i] || {};
        const cm = Math.hypot(m.wcm || 0, m.hcm || 0);
        return { name: d.label || ('Tela ' + (i + 1)), w: d.size.width, h: d.size.height, hz: d.displayFrequency || 60, primary: d.id === screen.getPrimaryDisplay().id, scale: Math.round((d.scaleFactor || 1) * 100), depth: 8, inches: cm > 20 ? Math.round((cm / 2.54) * 10) / 10 : null, year: m.year || null };
      });"""
if old_js not in s:
    raise SystemExit("displays JS nÃ£o encontrado")
s = s.replace(old_js, new_js, 1)

# 5) features: heurística por nome/família/modelo (o Windows não expõe CPUID)
old_feat = """    // displays via electron (screens)"""
new_feat = """    // Instruções: o Windows não expõe CPUID; mapeamos pelo modelo (Zen 4 / Zen 3 / Intel 12ª+).
    try {
      const nm = String((info.cpu && info.cpu.name) || '').toUpperCase();
      const fam = Number(info.cpu && info.cpu.family) || 0;
      const base = ['SSE', 'SSE2', 'SSE3', 'SSSE3', 'SSE4.1', 'SSE4.2', 'POPCNT', 'NX'];
      let extra = ['AVX', 'AVX2', 'FMA3', 'AES', 'CLMUL', 'BMI1', 'BMI2', 'F16C', 'MOVBE'];
      if (/7[89]00X3D|9[0-9]00X3D|RYZEN 7 7[0-9]00|RYZEN 9 7[0-9]00/.test(nm) || fam >= 25) extra = extra.concat(['AVX-512F', 'AVX-512DQ', 'AVX-512BW', 'AVX-512VL', 'SHA', 'VAES', 'GFNI']);
      if (/INTEL/.test(nm) && /1[2-4][0-9]00|CORE ULTRA/.test(nm)) extra = extra.concat(['SHA', 'GFNI', 'VAES']);
      if (/INTEL/.test(nm) && /1[1-4][0-9]00|CORE ULTRA/.test(nm)) extra = extra.filter((f) => !/AVX-512/.test(f));
      info.cpu.features = base.concat(extra);
    } catch (e) {}

    // displays via electron (screens)"""
if old_feat not in s:
    raise SystemExit("anchor features nÃ£o encontrado")
s = s.replace(old_feat, new_feat, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("pc info ok")
