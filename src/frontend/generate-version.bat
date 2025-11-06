@echo off
REM Generate version info from git

REM Get git info
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%i
for /f "delims=" %%i in ('git rev-parse --short HEAD 2^>nul') do set COMMIT=%%i
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set COMMIT_FULL=%%i

REM Get timestamp (format: YYYY-MM-DD HH:MM:SS UTC)
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set BUILD_DATE=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set BUILD_TIME=%%a:%%b

REM Set defaults if git not available
if "%BRANCH%"=="" set BRANCH=unknown
if "%COMMIT%"=="" set COMMIT=unknown
if "%COMMIT_FULL%"=="" set COMMIT_FULL=unknown

REM Create version.json
(
echo {
echo   "branch": "%BRANCH%",
echo   "commit": "%COMMIT%",
echo   "commitFull": "%COMMIT_FULL%",
echo   "buildTime": "%BUILD_DATE% %BUILD_TIME% UTC"
echo }
) > src\version.json

echo Generated version info:
type src\version.json
