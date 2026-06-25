# open-task-window.ps1 -- open a NEW Git Bash (mintty) window that launches a
# permission-free task sandbox and feeds Claude a kickoff prompt. Used by the
# /dotask skill so the user never has to paste a long prompt into a terminal.
#
#   powershell -ExecutionPolicy Bypass -File scripts/open-task-window.ps1 `
#       -Id t3940 -PromptFile C:\tmp\kickoff-t3940.md
#
# It opens mintty (the proper Git Bash terminal -> real TUI for Claude) running:
#   bash scripts/task.sh <Id> --prompt-file <msys-path-of-PromptFile>
# task.sh seeds the prompt INTO the container over stdin (no arg/quote mangling)
# and starts Claude with it. The window stays open after Claude exits (exec bash).
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Repo = "C:\Users\imank\projects\video-editor"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PromptFile)) { throw "prompt file not found: $PromptFile" }

# Windows path -> MSYS path (C:\a\b -> /c/a/b) for use inside bash.
function To-Msys([string]$p) {
  $p = $p -replace '\\', '/'
  if ($p -match '^([A-Za-z]):(.*)$') { return '/' + $matches[1].ToLower() + $matches[2] }
  return $p
}
$pfMsys   = To-Msys $PromptFile
$repoMsys = To-Msys $Repo

# The bash command the new window runs. Single-quoted MSYS paths are safe.
$bashCmd = "cd '$repoMsys' && bash scripts/task.sh $Id --prompt-file '$pfMsys'; " +
           "echo; echo '[dotask] Claude session ended -- window kept open'; exec bash"

$mintty = "C:\Program Files\Git\usr\bin\mintty.exe"
if (Test-Path $mintty) {
  # mintty gives a real pty; task.sh's winpty bridge handles docker exec -it.
  Start-Process $mintty -ArgumentList '-h', 'always', '/usr/bin/bash', '-lc', $bashCmd
} else {
  # Fallback: raw Git Bash console.
  $bash = "C:\Program Files\Git\bin\bash.exe"
  if (-not (Test-Path $bash)) { $bash = "bash" }
  Start-Process $bash -ArgumentList '-l', '-c', $bashCmd
}
Write-Output "[dotask] launched sandbox window for $Id"
