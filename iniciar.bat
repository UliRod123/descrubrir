@echo off
cd /d "%~dp0"
cls
echo.
echo  ==========================================
echo    Descrubrir - Descubridor de musica
echo  ==========================================
echo.

REM Instalar dependencias si no existen
if not exist "node_modules\" (
  echo  Instalando dependencias por primera vez, espera...
  call npm install
  echo.
)

echo  Iniciando servidor...
echo  El navegador abrira en unos segundos.
echo  NO cierres esta ventana mientras usas la app.
echo.

REM Abrir el navegador despues de 10 segundos
start /min "" powershell -Command "Start-Sleep 10; Start-Process 'http://localhost:3000'"

REM Iniciar servidor
call npm run dev
