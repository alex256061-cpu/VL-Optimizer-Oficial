# MODELO PUBLICO (sem segredo). Copie este arquivo para o nome sem .exemplo e preencha.
# O arquivo preenchido fica fora do git (veja .gitignore).

# Configurar o MP_ACCESS_TOKEN no Cloudflare Pages
$ErrorActionPreference = 'Continue'

$P = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$wrangler = Join-Path $P 'node_modules\.bin\wrangler.cmd'
$token = '<COLE AQUI O ACCESS TOKEN DO MERCADO PAGO>'

Write-Output "=== gravando MP_ACCESS_TOKEN ==="
$token | & $wrangler pages secret put MP_ACCESS_TOKEN --project-name=vl-optimizer 2>&1 | Select-Object -Last 3

Write-Output ""
Write-Output "=== variaveis do projeto ==="
& $wrangler pages secret list --project-name=vl-optimizer 2>&1 | Select-Object -Last 10
