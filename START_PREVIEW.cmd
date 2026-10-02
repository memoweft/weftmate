@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please use the prepared development environment.
  exit /b 1
)
node dogfood\run.mjs --dsh vendor --user-data-dir "%~dp0..\Runtime\Preview\user-data" %*
exit /b %errorlevel%
