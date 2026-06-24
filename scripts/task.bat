@echo off
REM Windows wrapper for scripts/task.sh -- run a permission-free Claude sandbox.
REM   task <id>          open a permission-free Claude session for a task
REM   task up <id>       start the task's container (no Claude)
REM   task claude <id>   open ANOTHER session in the same task (run N times)
REM   task stack <id>    start the app (backend+frontend) on the task's offset ports
REM   task down <id>     stop + remove the container
REM   task list          list task containers
REM
REM Runs the bash implementation via Git Bash. Adjust BASH if yours lives elsewhere.
setlocal
set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" "%~dp0task.sh" %*
endlocal
