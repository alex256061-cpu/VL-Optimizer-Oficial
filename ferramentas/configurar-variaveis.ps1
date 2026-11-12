# Configurar as variáveis de ambiente no Cloudflare Pages
#
# Usa a API do Cloudflare (o wrangler já está autenticado nesta máquina).
# As variáveis ficam criptografadas no projeto do Pages e só as Functions leem.

$ErrorActionPreference = 'Continue'

$conta = 'alex256061@gmail.com'
$projeto = 'vl-optimizer'
$raiz = 'C:\Users\lucas larado\Desktop\vlotimizeroficial'
$wrangler = Join-Path $raiz 'node_modules\.bin\wrangler.cmd'

# valores
$SUPABASE_URL = 'https://wsmropvlmnyegpvmyndn.supabase.co'
$SUPABASE_SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbXJvcHZsbW55ZWdwdm15bmRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5NDUxNzI3OCwiZXhwIjoyMTEwMDkzMjc4fQ._zRMSrwLhlM1m3o1t-e5jAq8X9epDbhY7QM4M4ZRlzU'
$SITE_URL = 'https://vl-optimizer.pages.dev'

Write-Output "=== colocando as variáveis ==="
Write-Output "  SITE_URL          = $SITE_URL"
Write-Output "  SUPABASE_URL      = $SUPABASE_URL"
Write-Output "  SUPABASE_SERVICE  = $($SUPABASE_SERVICE.Substring(0,25))..."

# o wrangler pages secret usa a API do Cloudflare
# A sintaxe é: wrangler pages secret put NOME --project-name=PROJ
# com o valor vindo do stdin
function ColocarSegredo($nome, $valor) {
  Write-Output "  -> $nome"
  $valor | & $wrangler pages secret put $nome --project-name=$projeto 2>&1 | Select-Object -Last 3
}

Push-Location $raiz
ColocarSegredo 'SITE_URL' $SITE_URL
ColocarSegredo 'SUPABASE_URL' $SUPABASE_URL
ColocarSegredo 'SUPABASE_SERVICE' $SUPABASE_SERVICE
Pop-Location

Write-Output ""
Write-Output "=== conferindo ==="
Push-Location $raiz
& $wrangler pages secret list --project-name=$projeto 2>&1 | Select-Object -Last 12
Pop-Location
