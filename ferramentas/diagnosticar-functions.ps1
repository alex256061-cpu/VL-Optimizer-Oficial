# Diagnóstico: por que /api/pix e /api/comprar dão 404 e o webhook não?
$
ErrorActionPreference = 'Continue'
$P = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'

Write-Output "=== os arquivos existem? ==="
Get-ChildItem -LiteralPath (Join-Path $P 'site\functions\api') | ForEach-Object {
  Write-Output ("  {0}  {1} bytes" -f $_.Name, $_.Length)
}

Write-Output ""
Write-Output "=== o export esta no formato certo? ==="
foreach ($nome in @('pix.js', 'pix-status.js', 'comprar.js', 'webhook.js')) {
  $caminho = Join-Path $P "site\functions\api\$nome"
  $c = [System.IO.File]::ReadAllText($caminho, [System.Text.Encoding]::UTF8)
  Write-Output "  --- $nome ---"
  Write-Output ("    export async function onRequestPost: " + $c.Contains('export async function onRequestPost'))
  Write-Output ("    export async function onRequestGet:  " + $c.Contains('export async function onRequestGet'))
  Write-Output ("    export async function onRequestOptions: " + $c.Contains('export async function onRequestOptions'))
}

Write-Output ""
Write-Output "=== testar GET e POST em cada rota ==="
$rotas = @('/api/pix', '/api/comprar', '/api/webhook', '/api/pix-status')
foreach ($rota in $rotas) {
  $getStatus = 'n/a'
  try {
    $r = Invoke-WebRequest -Uri "https://vl-optimizer.pages.dev$rota" -UseBasicParsing -TimeoutSec 20
    $getStatus = $r.StatusCode
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { $getStatus = $resp.StatusCode.value__ } else { $getStatus = 'ERR' }
  }
  Write-Output ("  GET  {0,-18} {1}" -f $rota, $getStatus)
}
