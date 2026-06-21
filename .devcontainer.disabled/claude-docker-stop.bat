@echo off
REM Stop (shut down) the video-editor dev container to free memory/CPU.
REM
REM You do NOT need this just to leave a Claude session -- exiting Claude
REM (Ctrl-C / /exit) already returns you to the host and leaves the container
REM running warm for a fast next launch. Use THIS only to fully stop it. The
REM next claude-docker.bat will start it again.
setlocal
cd /d "%~dp0\.."

REM find-container.js matches the running dev container for this repo regardless
REM of how the host path was formatted in the container label (see that file).
set "CID="
for /f "usebackq delims=" %%i in (`node .devcontainer\find-container.js`) do set "CID=%%i"

if not defined CID (
  echo [claude-docker-stop] no running dev container found for this repo. Nothing to stop.
  goto :eof
)

echo [claude-docker-stop] stopping container %CID%...
docker stop %CID% >nul
echo [claude-docker-stop] stopped. Run claude-docker.bat to start again.
endlocal
