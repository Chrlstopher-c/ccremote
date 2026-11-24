@echo off
where node >nul 2>nul
if not errorlevel 1 (
  node "%~dp0entree.mjs" %*
  exit /b
)
bun "%~dp0entree.mjs" %*
