# Permission-free Claude Code dev container

This `.devcontainer/` runs Claude Code (VS Code extension + CLI) with **all
permission prompts disabled**, safely scoped to the container.

## How it works

- The container writes `permissions.defaultMode = bypassPermissions` into its
  **own** `~/.claude/settings.json` ([setup.sh](setup.sh)). Your host checkout
  is untouched and keeps its normal prompts.
- Your host Claude login is reused: `~/.claude/.credentials.json` is mounted
  read-only and copied in on every start ([auth-sync.sh](auth-sync.sh)), so you
  don't have to `/login` again.
- The container runs as the non-root `vscode` user, which bypass mode requires.

## Using it

1. Command Palette -> **Dev Containers: Reopen in Container**.
2. Wait for build (first time installs ffmpeg, the Claude CLI, and frontend deps).
3. The Claude Code extension reinstalls inside the container and runs with no
   permission prompts.

To go back: **Dev Containers: Reopen Folder Locally**.

## The "spin up on demand" caveat

A Claude session already running on the host **cannot** be moved into the
container mid-conversation -- containerization happens at launch. So the
practical trigger is: **whenever you're about to start permission-heavy work,
Reopen in Container** and the fresh session runs fully bypassed. There's no way
to auto-jump an in-flight host session into a container.

## Notes / gotchas

- **First launch** may show a one-time folder-trust dialog from the extension;
  accept it once.
- **Backend + Postgres:** the host's `src/backend/.venv` is Windows-only and
  won't run here. `setup.sh` installs backend deps into the container's Python
  best-effort. To reach the shared dev Postgres running on the Windows host,
  use `host.docker.internal:5432` (already wired via `--add-host`) instead of
  `localhost:5432`.
- **macOS host difference:** this reuses the Linux/Windows file-based token. On
  a Mac host the token is in Keychain (not a file), so you'd `/login` once
  inside the container instead.
- These files are committed, so any session that reopens in-container gets the
  bypass -- matching the goal of running Claude sessions containerized.
