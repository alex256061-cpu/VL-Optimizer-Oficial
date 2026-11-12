# Verificar a sintaxe das Functions e publicar
$ErrorActionPreference = 'Continue'

$P = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$site = Join-Path $P 'site'
$wrangler = Join-Path $P 'node_modules\.bin\wrangler.cmd'

Write-Output "=== sintaxe ==="
$arquivos = @(
  'site\functions\api\pix.js',
  'site\functions\api\pix-status.js',
  'site\functions\api\comprar.js',
  'site\functions\api\webhook.js',
  'site\checkout.js'
)
foreach ($rel in $arquivos) {
  $completo = Join-Path $P $rel
  & node --check $completo 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Output "  OK    $rel" } else { Write-Output "  ERRO  $rel" }
}

Write-Output ""
Write-Output "=== functions na pasta ==="
Get-ChildItem -LiteralPath (Join-Path $site 'functions\api') | ForEach-Object { Write-Output "  $($_.Name)  ($([math]::Round($_.Length/1KB,1)) KB)" }

Write-Output ""
Write-Output "=== publicando ==="
Push-Location $site
& $wrangler pages deploy . --project-name=vl-optimizer --branch=main --commit-dirty=true 2>&1 | Select-Object -Last 8
Pop-Location
