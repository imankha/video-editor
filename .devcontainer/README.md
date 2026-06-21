# Permission-free Claude Code dev container

This `.devcontainer/` runs Claude Code inside Docker with **all permission
prompts disabled**, safely scoped to the container. Your **host** checkout is
untouched and keeps its normal prompts.

## Open it (the GUI panel)

Command Palette (`Ctrl+Shift+P`) -> **Dev Containers: Reopen in Container**.

VS Code builds the container (first time: a few minutes — installs ffmpeg, the
Claude Code CLI + extension, Node, Python, gh) and the **Claude Code panel runs
inside the container** with no permission prompts.

To leave: **Dev Containers: Reopen Folder Locally** (back to the host panel).

> VS Code remembers this choice per folder: once you Reopen in Container, it
> keeps reopening there until you explicitly Reopen Folder Locally. To run host
> and container side by side, see "Two windows" below.

## Sign in once (important)

The Claude Code **extension** authenticates with its **own** sign-in flow — it
does **not** read a copied `.credentials.json` the way the CLI does. So the
first time you open the container:

1. Open the Claude panel. If it says **"Language model unavailable"** / "Not
   logged in", click **Sign in** (or run `claude` in the integrated terminal and
   complete `/login`). If the browser callback doesn't return to the container,
   copy the code and paste it at the terminal prompt.
2. Run **Developer: Reload Window** if the panel doesn't pick it up immediately.

That login is stored in a **named volume** mounted at `~/.claude`, so it
**persists across rebuilds — you only sign in once.** Same Claude subscription
as your host (Pro/Max); **no API key needed**.

> Why this changed: an earlier version copied the host's `.credentials.json`
> into the container. That works for the CLI but **not** the extension panel,
> which is why the panel showed "Language model unavailable". The volume +
> one-time sign-in is the supported fix.

## How it works

- `bypassPermissions` is written into the container's **own**
  `~/.claude/settings.json` ([setup.sh](setup.sh)) — the host is never modified.
- `~/.claude` is a **persisted named volume** (see [devcontainer.json](devcontainer.json)),
  so sign-in/settings/history survive rebuilds.
- [auth-sync.sh](auth-sync.sh) seeds the host's **CLI** token into that volume
  only if it's empty (never overwrites your in-container sign-in).
- Runs as the non-root `vscode` user, which bypass mode requires.

## Two windows (host + container)

To keep a host session and a container session at once, open the folder in two
windows: leave one **local** (host panel) and **Reopen in Container** in the
other. Because VS Code's reopen choice is per-folder, this can be fiddly for the
same folder; a clean alternative is a second checkout (or `/worktree`) for the
container window so the two never fight over the preference.

## Terminal CLI (alternative to the panel)

If you'd rather have the **CLI** than the panel, a launcher builds/starts the
same container and drops you into a bypassed `claude` session:

| Goal | Command |
|------|---------|
| **Go in** | `.devcontainer/claude-docker.sh` (or `claude-docker.bat`) |
| **Leave** (keep container warm) | exit Claude (`Ctrl-C` / `/exit`) |
| **Stop the container** (free RAM) | `.devcontainer/claude-docker-stop.sh` (or `.bat`) |

Args are forwarded, e.g. `claude-docker.sh --resume`.

## Notes / gotchas

- **First launch** may show a one-time folder-trust dialog; accept it once.
- **Backend + Postgres:** the host's `src/backend/.venv` is Windows-only and
  won't run here. `setup.sh` installs backend deps into the container's Python
  best-effort. To reach the shared dev Postgres on the Windows host, use
  `host.docker.internal:5432` (wired via `--add-host`) instead of `localhost`.
- **macOS host difference:** the CLI seed reuses the Linux/Windows file token;
  on a Mac host the token is in Keychain, so the seed simply no-ops and you sign
  in inside the container (which you do anyway for the extension).
