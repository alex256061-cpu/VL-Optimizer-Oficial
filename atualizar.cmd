@echo off
rem Atualiza o VL Optimizer para o build novo (dist2 -> dist) e abre.
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
taskkill /IM "VL Optimizer.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul
if exist dist rmdir /s /q dist
move dist2 dist
start "" "dist\VL Optimizer-win32-x64\VL Optimizer.exe"
endlocal
