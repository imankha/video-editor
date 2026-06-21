@echo off
REM One command -> a permission-free Claude Code session inside the dev container.
REM
REM Inside the container, ~/.claude/settings.json has bypassPermissions (set by
REM setup.sh), so Claude never asks you to approve anything. This script builds/
REM starts the container if needed, then drops you into a bypassed `claude`
REM session. Double-click it, or run `\.devcontainer\claude-docker.bat` from cmd.
REM Any args are forwarded to claude (e.g. claude-docker.bat --resume).
REM
REM Requires: Docker Desktop running, Node (for npx). First run builds the image
REM (several minutes); later runs reuse the container and are fast.
setlocal
cd /d "%~dp0\.."

echo [claude-docker] starting dev container (first run builds the image; be patient)...
REM `up` is idempotent. Capture its result JSON (stdout) and parse the containerId.
set "CID="
for /f "usebackq delims=" %%i in (`npx --yes @devcontainers/cli up --workspace-folder . ^| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=s.trim().split('\n').reverse().find(x=>x.trim().startsWith('{'))||'{}';let o={};try{o=JSON.parse(l)}catch(e){}process.stdout.write(o.containerId||'')})"`) do set "CID=%%i"

if not defined CID (
  echo [claude-docker] could not resolve container id; using devcontainer exec fallback...
  call npx --yes @devcontainers/cli exec --workspace-folder . claude %*
  goto :eof
)

echo [claude-docker] entering bypassed Claude session...
docker exec -it -u vscode -w /workspaces/video-editor %CID% bash -lc "exec claude \"$@\"" _ %*
endlocal
