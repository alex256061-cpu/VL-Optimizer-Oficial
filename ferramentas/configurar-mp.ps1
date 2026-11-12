# Configurar o MP_ACCESS_TOKEN no Cloudflare Pages
$ErrorActionPreference = 'Continue'

$P = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$wrangler = Join-Path $P 'node_modules\.bin\wrangler.cmd'
$token = 'APP_USR-7387612655304312-111219-ad9e75c2b966b560640b2813443ebb42-1121070912'

Write-Output "=== gravando MP_ACCESS_TOKEN ==="
$token | & $wrangler pages secret put MP_ACCESS_TOKEN --project-name=vl-optimizer 2>&1 | Select-Object -Last 3

Write-Output ""
Write-Output "=== variaveis do projeto ==="
& $wrangler pages secret list --project-name=vl-optimizer 2>&1 | Select-Object -Last 10
