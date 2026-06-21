# Permission-free Claude Code dev container (on-demand)

This `.devcontainer-ondemand/` runs Claude Code (CLI) with **all permission
prompts disabled**, safely scoped to the container.

## Default vs. on-demand

**The host is the default.** This folder is deliberately *not* named
`.devcontainer`, so VS Code does **not** auto-reopen the project in a container.
Open the folder normally and the Claude Code panel is a plain **host** session
with its usual permission prompts.

**The container is opt-in**, launched explicitly when you want a no-prompts
session. Because the config lives here (not in `.devcontainer/`), every launcher
points the devcontainer CLI at it with `--config` -- you don't need to rename
anything.

## How it works

- The container writes `permissions.defaultMode = bypassPermissions` into its
  **own** `~/.claude/settings.json` ([setup.sh](setup.sh)). Your host checkout
  is untouched and keeps its normal prompts.
- Your host Claude login is reused: `~/.claude/.credentials.json` is mounted
  read-only and copied in on every start ([auth-sync.sh](auth-sync.sh)), so you
  don't have to `/login` again.
- The container runs as the non-root `vscode` user, which bypass mode requires.

## How to start a bypassed session

Run the launcher in a terminal (Git Bash / WSL / cmd):

| Goal | Command |
|------|---------|
| **Go in** (start a bypassed Claude session) | `.devcontainer-ondemand/claude-docker.sh` (or `claude-docker.bat`) |
| **Leave the session** (keep container warm) | exit Claude: `Ctrl-C` / `/exit` -- you're back on the host instantly |
| **Stop the container** (free RAM) | `.devcontainer-ondemand/claude-docker-stop.sh` (or `.bat`) |

`claude-docker` builds/starts the container if needed (first run takes a few
minutes; later runs are instant because the container is reused) and drops you
straight into a `claude` session that **never asks for permission**. Args are
forwarded, so `claude-docker.sh --resume` works.

You don't need a command to "leave" -- just exit Claude and you're back on the
host. The container stays running so the next launch is fast. Run
`claude-docker-stop` only when you want to fully shut it down.

## Want the full extension-in-container GUI instead?

The launcher gives you the **CLI** inside the container. If you specifically want
the VS Code **extension** running in-container (so the Claude *panel* is
containerized), VS Code's "Reopen in Container" only auto-detects a folder named
`.devcontainer`. Temporarily rename this folder to opt in:

```
git mv .devcontainer-ondemand .devcontainer   # enable GUI auto-reopen
# ... Command Palette -> Dev Containers: Reopen in Container ...
git mv .devcontainer .devcontainer-ondemand   # back to host-default
```

Note: a host session already running **cannot** be moved into the container
mid-conversation -- containerization happens at launch, so you must *start* in
the container.

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
- These files are committed, so anyone who launches the on-demand container gets
  the bypass -- while normal (host) opens stay prompt-guarded.
