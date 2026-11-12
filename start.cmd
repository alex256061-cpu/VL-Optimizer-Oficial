@echo off
rem VL Optimizer — inicia o app limpando ELECTRON_RUN_AS_NODE (faz o Electron rodar como Node)
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund
)
call node_modules\.bin\electron.cmd .
endlocal
