# Claude Container (VS Code command)

A tiny VS Code extension that adds one Command Palette command:

> **Claude Container** — `Ctrl+Shift+P` → type "Claude Container"

It launches a bypass-permissions Claude Code session inside this repo's
**on-demand dev container** by running the `Claude Container` task from
[`.vscode/tasks.json`](../../.vscode/tasks.json). Requires Docker Desktop
running. Host stays the default — this is the opt-in container path.

## Build & install

From this folder:

```bash
npx --yes @vscode/vsce package --no-dependencies
code --install-extension claude-container-0.0.1.vsix --force
```

Then reload VS Code (`Developer: Reload Window`). The command appears in the
palette as **Claude Container**.

## Why an extension?

VS Code only lets you *type* a named command in the Command Palette if an
extension contributes it. Tasks otherwise hide behind "Tasks: Run Task". This
extension is the thin shim that surfaces the task as a first-class command.
