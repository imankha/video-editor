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

## Two ways in

### A. One command (terminal Claude) -- recommended for "never ask me"

| Goal | Command |
|------|---------|
| **Go in** (start a bypassed Claude session) | `.devcontainer/claude-docker.sh` (or `claude-docker.bat`) |
| **Leave the session** (keep container warm) | exit Claude: `Ctrl-C` / `/exit` -- you're back on the host instantly |
| **Stop the container** (free RAM) | `.devcontainer/claude-docker-stop.sh` (or `.bat`) |

`claude-docker` builds/starts the container if needed (first run takes a few
minutes; later runs are instant because the container is reused) and drops you
straight into a `claude` session that **never asks for permission**. Run it
instead of `claude` whenever you want a no-prompts session. Args are forwarded,
so `claude-docker.sh --resume` works.

You don't need a command to "leave" -- just exit Claude and you're back on the
host. The container stays running so the next launch is fast. Run
`claude-docker-stop` only when you want to fully shut it down.

### B. VS Code extension (your usual UI)

1. Command Palette -> **Dev Containers: Reopen in Container**.
2. Wait for build (first time installs ffmpeg, the Claude CLI, and frontend deps).
3. The Claude Code extension reinstalls inside the container and runs with no
   permission prompts.

To go back: **Dev Containers: Reopen Folder Locally**.

**This is effectively "auto-default" for the extension:** VS Code *remembers your
choice per folder*. After you Reopen in Container once, opening this folder
reopens it in the container automatically every time after -- until you
explicitly Reopen Folder Locally. So the one-time click sticks.

## The "spin up on demand" caveat

A Claude session already running on the host **cannot** be moved into the
container mid-conversation -- containerization happens at launch. So "jump into
Docker the moment it wants permission" isn't possible for a live session; the
fix is to *start* in the container. Either path above does that: `claude-docker`
for a fresh terminal session, or Reopen in Container for the extension (which
then sticks as the default for this folder).

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
