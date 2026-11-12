@echo off
setlocal
title VL Optimizer - Medicao de travadas
cd /d "%~dp0"

echo ============================================================
echo   MEDICAO DE TRAVADAS - VL OPTIMIZER
echo ============================================================
echo.
echo   Este teste roda o PresentMon como administrador, porque
echo   sem elevacao ele perde a maioria dos eventos e nao mede.
echo.
echo   ANTES DE CONTINUAR:
echo     - O jogo precisa estar ABERTO e no GAMEPLAY
echo       (no menu o jogo para de gerar quadros e nao mede)
echo     - Nao mexa no mouse nem no teclado durante cada medicao
echo.
echo   O teste leva cerca de 2 minutos e mede dois cenarios:
echo     A) escala + geracao de quadros
echo     B) escala sem geracao de quadros
echo.
echo ============================================================
echo.
pause

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node.js ou rode o teste pelo VL Optimizer.
  echo.
  pause
  exit /b 1
)

echo Iniciando...
echo.
node "%~dp0medir-cmd.js"

echo.
echo ============================================================
echo   FIM. Copie o resultado acima e envie.
echo ============================================================
echo.
pause
