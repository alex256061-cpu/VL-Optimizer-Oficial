# manter-supabase-vivo.ps1
#
# Por que existe: no plano gratuito, o Supabase pausa o projeto quando fica uma semana sem
# atividade no banco. A documentacao diz: "typically a few user requests to the database each
# day over the previous week is enough to keep the project from being paused".
#
# O que faz: uma consulta leve por dia no banco do VL Optimizer. O projeto fica ativo e nunca
# e pausado. Nao cria dado, nao altera nada: e so uma leitura.
#
# Sem isso, o login do aplicativo para de funcionar quando o projeto e pausado.

$ErrorActionPreference = 'SilentlyContinue'

# configuracao
$url = 'https://wsmropvlmnyegpvmyndn.supabase.co'
$chave = 'sb_publishable_7yffHvepz_e7LCm3BvL55w_euYmiX6o'
$log = Join-Path $env:LOCALAPPDATA 'VLOptimizer\manter-vivo.log'

# garante a pasta do log
$pastaLog = Split-Path $log -Parent
if (-not (Test-Path -LiteralPath $pastaLog)) {
  New-Item -ItemType Directory -Path $pastaLog -Force | Out-Null
}

function Registrar($msg) {
  $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Add-Content -LiteralPath $log -Value $linha -Encoding UTF8
  Write-Output $linha
}

# a consulta: le uma linha da tabela de perfis. Conta como atividade de banco.
try {
  $r = Invoke-WebRequest -Uri "$url/rest/v1/profiles?select=id&limit=1" `
    -Headers @{ apikey = $chave; Authorization = "Bearer $chave" } `
    -TimeoutSec 25 -UseBasicParsing

  if ($r.StatusCode -eq 200) {
    Registrar "OK  projeto ativo (HTTP 200)"
  } else {
    Registrar "AVISO  resposta inesperada (HTTP $($r.StatusCode))"
  }
} catch {
  $codigo = $_.Exception.Response.StatusCode.value__
  if ($codigo) {
    # 401/403 significam que o servidor respondeu: o projeto esta de pe.
    Registrar "OK  projeto respondeu (HTTP $codigo)"
  } else {
    Registrar "FALHA  $($_.Exception.Message)"
  }
}
