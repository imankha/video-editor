@echo off
REM Release to production
REM
REM Usage:
REM   scripts\release.bat v1.2.0
REM
REM What it does:
REM   1. Checks you're on master with a clean working tree
REM   2. Builds and deploys frontend to CF Pages (reel-ballers-prod)
REM   3. Tags the commit and pushes the tag
REM
REM Backend deploy (run separately if backend changed):
REM   cd src\backend && fly deploy --config fly.production.toml

setlocal

set VERSION=%1
if "%VERSION%"=="" (
    echo Usage: scripts\release.bat v1.2.0
    exit /b 1
)

REM Must be on master
for /f %%i in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%i
if not "%BRANCH%"=="master" (
    echo Error: must be on master (currently on %BRANCH%)
    exit /b 1
)

REM Must be clean
git diff --quiet
if %errorlevel% neq 0 (
    echo Error: working tree has unstaged changes -- commit or stash first
    exit /b 1
)
git diff --cached --quiet
if %errorlevel% neq 0 (
    echo Error: working tree has staged changes -- commit first
    exit /b 1
)

REM Must be up to date with origin
git fetch origin master --quiet
for /f %%i in ('git rev-parse HEAD') do set LOCAL=%%i
for /f %%i in ('git rev-parse origin/master') do set REMOTE=%%i
if not "%LOCAL%"=="%REMOTE%" (
    echo Error: local master is behind origin/master -- run git pull first
    exit /b 1
)

REM Tag must not already exist
git tag | findstr /x "%VERSION%" >nul 2>&1
if %errorlevel% equ 0 (
    echo Error: tag %VERSION% already exists
    exit /b 1
)

for /f %%i in ('git rev-parse --short HEAD') do set SHA=%%i
echo Releasing %VERSION% from %SHA%...
echo.

REM Deploy frontend
echo Building and deploying frontend to prod...
cd src\frontend
call npm run deploy:production
if %errorlevel% neq 0 (
    echo Frontend deploy failed -- not tagging
    exit /b 1
)
cd ..\..

REM Tag after successful deploy
git tag -a "%VERSION%" -m "Release %VERSION%"
git push origin "%VERSION%"

echo.
echo Done. %VERSION% is live on reel-ballers-prod.
echo.
echo If backend changed, run:
echo   cd src\backend ^&^& fly deploy --config fly.production.toml
