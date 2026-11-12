import io

ROOT = r"C:\Users\lucas larado\Desktop\deeepvl\l-optimizer"

# 1) dashboard: skip tour when loaded with ?shot=...
p = ROOT + r"\src\dashboard.html"
s = io.open(p, encoding="utf-8").read()
old = "    try { if (localStorage.getItem('gdz-efeitos') === 'off') document.documentElement.dataset.fx = 'off'; } catch (e) {}"
add = old + "\n    // modo de captura de tela (--shots): sem tour automatico\n    try { if (location.search.indexOf('shot') >= 0) localStorage.setItem('gdz-tour', 'v-shot'); } catch (e) {}"
if "location.search.indexOf('shot')" not in s:
    s = s.replace(old, add, 1)
    io.open(p, "w", encoding="utf-8").write(s)
print("tour-gate:", "location.search.indexOf('shot')" in s)

# 2) main: pass the query when capturing
p = ROOT + r"\main.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace(
    "win.loadFile(path.join(__dirname, 'src', 'dashboard.html'));",
    "win.loadFile(path.join(__dirname, 'src', 'dashboard.html'), process.argv.includes('--shots') ? { query: { shot: '1' } } : undefined);",
)
io.open(p, "w", encoding="utf-8").write(s)
print("query:", "shot: '1'" in s)

# 3) pcinfo: disks/vols/displays shape
p = ROOT + r"\engine-extras.js"
s = io.open(p, encoding="utf-8").read()
s = s.replace(
    "$disks = @(Get-PhysicalDisk | ForEach-Object { @{ id=$_.DeviceId; name=[string]$_.FriendlyName; media=[string]$_.MediaType; bus=[string]$_.BusType; bytes=[int64]$_.Size; health=$_.HealthStatus } })",
    "$disks = @(Get-PhysicalDisk | ForEach-Object { $d = Get-Disk -Number $_.DeviceId -ErrorAction SilentlyContinue; $volsD = @(Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | ForEach-Object { $_.DriveLetter } | Where-Object { $_ }); @{ id=[string]$_.DeviceId; name=[string]$_.FriendlyName; media=[string]$_.MediaType; bus=[string]$_.BusType; bytes=[int64]$_.Size; health=$_.HealthStatus; letters=@($volsD); wear=$null; hours=$null; fw=[string]$_.FirmwareVersion; temp=$null } })",
)
s = s.replace(
    "info.displays = screen.getAllDisplays().map((d, i) => ({ name: d.label || ('Tela ' + (i + 1)), w: d.size.width, h: d.size.height, hz: d.displayFrequency || 60, primary: d.id === screen.getPrimaryDisplay().id }));",
    "info.displays = screen.getAllDisplays().map((d, i) => ({ name: d.label || ('Tela ' + (i + 1)), w: d.size.width, h: d.size.height, hz: d.displayFrequency || 60, primary: d.id === screen.getPrimaryDisplay().id, scale: Math.round((d.scaleFactor || 1) * 100), depth: 8, inches: null, year: null }));",
)
io.open(p, "w", encoding="utf-8").write(s)
print("pcinfo:", "letters=@($volsD)" in s and "scale: Math.round" in s)
