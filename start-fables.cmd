@echo off
setlocal
cd /d "%~dp0"

rem ===== Optional power-ups: remove the "rem " and fill in to enable =====
rem set "ANTHROPIC_API_KEY=sk-ant-..."
rem set "FABLES_COMFY_URL=http://127.0.0.1:8188"
rem set "FABLES_OLLAMA_URL=http://127.0.0.1:11434"
rem (see the "Add power-ups" section of README.md for the full list)
rem ======================================================================

where pnpm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Fables needs two free tools first: Node.js and pnpm.
  echo  Open README.md and follow "Install Fables - the gentle, step-by-step guide".
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  First-time setup: downloading components ^(a few minutes, one time^)...
  call pnpm install || ( echo  Setup failed. & pause & exit /b 1 )
)

if not exist "apps\server\dist\server.js" (
  echo  First-time setup: building Fables ^(a few minutes, one time^)...
  call pnpm build || ( echo  Build failed. & pause & exit /b 1 )
)

rem Free port 4870 in case a previous Fables server is still running (closing the
rem window doesn't always stop the node process), so we don't hit EADDRINUSE.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":4870 .*LISTENING"') do taskkill /F /PID %%a >nul 2>nul

echo.
echo  Starting Fables. Keep this window open while you use it.
echo  Opening http://localhost:4870 in your browser...
start "" "http://localhost:4870"
call pnpm start
pause
