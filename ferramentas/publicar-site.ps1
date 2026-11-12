# Publicar no Cloudflare Pages
#
# Usa o wrangler já autenticado nesta máquina (conta alex256061@gmail.com).
# Projeto: vl-optimizer (vl-optimizer.pages.dev)
#
# O wrangler detecta a pasta functions/ e publica como Pages Functions automaticamente.

$ErrorActionPreference = 'Continue'

$raiz = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$site = Join-Path $raiz 'site'
$wrangler = Join-Path $raiz 'node_modules\.bin\wrangler.cmd'

Write-Output "=== conferindo o que vai subir ==="
$arquivos = Get-ChildItem -LiteralPath $site -Recurse -File | Where-Object { $_.Name -ne 'README.md' }
Write-Output "  arquivos: $($arquivos.Count)"
Write-Output "  tamanho total: $([math]::Round(($arquivos | Measure-Object Length -Sum).Sum/1MB,2)) MB"

Write-Output ""
Write-Output "  paginas:"
$arquivos | Where-Object { $_.Extension -eq '.html' } | ForEach-Object { Write-Output "    $($_.Name)" }
Write-Output "  functions:"
$arquivos | Where-Object { $_.FullName -match '\\functions\\' } | ForEach-Object { Write-Output "    $($_.FullName.Replace($site + '\', ''))" }

Write-Output ""
Write-Output "=== publicando (deploy de producao) ==="
Push-Location $site
& $wrangler pages deploy . --project-name=vl-optimizer --branch=main --commit-dirty=true 2>&1 | Select-Object -Last 25
Pop-Location
