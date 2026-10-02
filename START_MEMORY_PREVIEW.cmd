@echo off
setlocal
cd /d "%~dp0"
call START_PREVIEW.cmd --user-data-dir "%~dp0..\Runtime\MemoryPreview\user-data" --memoweft-config "%~dp0..\Runtime\MemoryPreview\memoweft.local.json" %*
exit /b %errorlevel%
