# publicar.ps1 — atalho para publicar uma versao nova do VL Optimizer.
#
# Todo o trabalho e feito por publicar.js. Este arquivo so repassa os argumentos.
#
# Uso:
#   .\publicar.ps1 1.4.18
#   .\publicar.ps1 1.4.18 -PularSite
#   .\publicar.ps1 1.4.18 -Seco

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Versao,

  [switch]$PularSite,
  [switch]$Seco
)

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$js = Join-Path $Raiz 'publicar.js'

if (-not (Test-Path $js)) {
  Write-Host "Nao achei publicar.js ao lado deste arquivo." -ForegroundColor Red
  exit 1
}

$argumentos = @($js, $Versao)
if ($PularSite) { $argumentos += '--pular-site' }
if ($Seco) { $argumentos += '--seco' }

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& node @argumentos
exit $LASTEXITCODE
