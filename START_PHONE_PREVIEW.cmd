@echo off
setlocal
cd /d "%~dp0"
call START_PREVIEW.cmd --user-data-dir "%~dp0..\Runtime\MemoryPreview\user-data" --memoweft-config "%~dp0..\Runtime\MemoryPreview\memoweft.local.json" --ai-game-runtime-root "%~dp0..\Runtime\PhonePreview\bundle-observe-compact\ai-game-managed-runtime" --phone-config "%~dp0..\Runtime\PhonePreview\phone.local.json" %*
exit /b %errorlevel%
