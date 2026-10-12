# dotask tracer (throwaway)

Observation-only VS Code extension. It answers what a production "auto-continue after
`STAGE_DONE ... commit`" extension can do inside a dotask container window. It is not that
extension. Findings from a real run: [REPORT.md](REPORT.md).

## Install (THROWAWAY container only, never a live dotask group)

```bash
bash scripts/task.sh up tracer && bash scripts/task.sh code tracer   # attach a window
cd scripts/dotask-tracer-ext && npx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license -o dotask-tracer.vsix
docker exec -u dev reel-task-tracer bash -c '/home/dev/.vscode-server/bin/*/bin/code-server --install-extension /workspace/scripts/dotask-tracer-ext/dotask-tracer.vsix'
```

Then run "Developer: Reload Window" in the container window.

## Outputs (inside the container, under /workspace)

| File | Content |
|------|---------|
| `.dotask-tracer.log` | JSONL trace, one record per line (also the "dotask tracer" OutputChannel) |
| `.dotask-tracer-report.md` | "dotask tracer: dump report", rebuilt from the log |
| `.dotask-tracer-status` | Fake status file written by probe g |

## Probes (Command Palette, "dotask tracer: ...")

Run them in order, a to k. Each one logs before/after tab snapshots, every command's result or
thrown error, and your answers to its modal questions. Probe d needs a second VS Code window.
Probe k needs a throwaway conversation that is streaming.
