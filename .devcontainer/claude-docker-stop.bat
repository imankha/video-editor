@echo off
REM Stop (shut down) the video-editor dev container to free memory/CPU.
REM
REM You do NOT need this just to leave a Claude session -- exiting Claude
REM (Ctrl-C / /exit) already returns you to the host and leaves the container
REM running warm for a fast next launch. Use THIS only to fully stop it. The
REM next claude-docker.bat will start it again.
setlocal
cd /d "%~dp0\.."

REM Resolve the same absolute host path the devcontainer CLI labels containers with.
for /f "usebackq delims=" %%p in (`node -e "process.stdout.write(require('path').resolve('.'))"`) do set "FOLDER=%%p"

set "CID="
for /f "usebackq delims=" %%i in (`docker ps -q --filter "label=devcontainer.local_folder=%FOLDER%"`) do set "CID=%%i"

if not defined CID (
  echo [claude-docker-stop] no running dev container found for this repo. Nothing to stop.
  goto :eof
)

echo [claude-docker-stop] stopping container %CID%...
docker stop %CID% >nul
echo [claude-docker-stop] stopped. Run claude-docker.bat to start again.
endlocal
