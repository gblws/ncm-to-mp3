@echo off
setlocal
cd /d "%~dp0"
set "NCM_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NCM_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Node.js 18+ is required. Download it from https://nodejs.org/
    pause
    exit /b 1
  )
)
"%NCM_NODE%" src\launch.js
if errorlevel 1 pause
