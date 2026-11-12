# Publicar no Cloudflare Pages — VL Optimizer
#
# REGRA IMPORTANTE: roda de dentro da pasta site/, NUNCA da raiz.
# Com um wrangler.toml na raiz, o wrangler trata o projeto como "Pages com config" e
# IGNORA a pasta functions/ (o deploy sobe só os arquivos estáticos).
# Foi o que aconteceu no deploy 28fe32dd: as Functions sumiram.
#
# Então: sem wrangler.toml. Os cabeçalhos ficam em site/_headers.
# A pasta site/functions/ é detectada automaticamente pelo wrangler.

$ErrorActionPreference = 'Continue'

$raiz = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$site = Join-Path $raiz 'site'
$wrangler = Join-Path $raiz 'node_modules\.bin\wrangler.cmd'

Write-Output "=== conferindo ==="
Write-Output "  functions: $((Get-ChildItem -LiteralPath (Join-Path $site 'functions') -Recurse -File).Count) arquivo(s)"
Write-Output "  _headers:  $(Test-Path -LiteralPath (Join-Path $site '_headers'))"
Write-Output "  wrangler.toml na raiz: $(Test-Path -LiteralPath (Join-Path $raiz 'wrangler.toml'))  (deve ser False)"

Write-Output ""
Write-Output "=== publicando ==="
Push-Location $site
& $wrangler pages deploy . --project-name=vl-optimizer --branch=main --commit-dirty=true 2>&1 | Select-Object -Last 10
Pop-Location

Write-Output ""
Write-Output "=== conferindo se as Functions subiram ==="
Start-Sleep -Seconds 5
try {
  $r = Invoke-WebRequest -Uri 'https://vl-optimizer.pages.dev/api/webhook' -UseBasicParsing -TimeoutSec 25
  Write-Output "  /api/webhook: HTTP $($r.StatusCode)  $($r.Content)"
} catch {
  Write-Output "  /api/webhook: FALHOU - as Functions nao subiram"
}
