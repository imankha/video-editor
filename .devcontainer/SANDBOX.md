# Parallel task sandboxes (`scripts/task`)

Run **many tasks in parallel**, each in its own **permission-free, sandboxed**
container — and point **multiple conversations at the same task** so they
collaborate on one shared checkout.

```
TASK t3940 ─ container reel-task-t3940 ─ host :8001 / :5174 ─┬─ conv 1 (claude)
                                                             ├─ conv 2 (claude)   same files
                                                             └─ conv 3 (claude)
TASK bug-x ─ container reel-task-bug-x ─ host :8002 / :5175 ─── conv (claude)     fully parallel + isolated
```

- **Safe** — a command can only touch the container + that task's checkout dir
  (`/c/work/tasks/<id>`). Your OS, `~/.ssh`, and other tasks are untouched.
- **Permission-free** — `bypassPermissions` is baked into the container's own
  `~/.claude`; no prompts, no flag.
- **Parallel + isolated** — each task is a separate container on **offset ports**
  with its own local clone, so two tasks never collide.
- **Shared per task** — every `claude` session for a task `docker exec`s into the
  *same* container, so multiple chats see the same files.

## Commands

```bash
bash scripts/task.sh <id>          # open a permission-free Claude session (creates the sandbox on first run)
bash scripts/task.sh claude <id>   # open ANOTHER session in the same task (run N times for N conversations)
bash scripts/task.sh stack <id>    # start the app (backend+frontend) on this task's offset ports
bash scripts/task.sh up <id>       # just create/start the container (no Claude)
bash scripts/task.sh list          # all task containers + their host ports
bash scripts/task.sh down <id>     # stop + remove the container (keeps the checkout)
bash scripts/task.sh nuke <id>     # down + delete the checkout dir
```

Windows: `scripts\task.bat <id>` does the same via Git Bash.

## The kickoff flow (task board → sandbox)

The task board (`scripts/task-manager.py`, http://localhost:8089) has a per-task
**🔒 Sandbox cmd** button that copies `bash scripts/task.sh <id>`:

1. On the board, pick a task → click **🔒 Sandbox cmd** (copies the launch command).
2. Paste it in a Git Bash terminal at the repo root → a permission-free Claude
   session opens in that task's sandbox.
3. In that session, paste the task's **Copy kickoff prompt** as usual.
4. Want a second conversation on the same task? Run the same command in another
   terminal — it attaches to the same container/files.

## First run (per machine / per task)

- **Image build** happens once (`reel-task:latest`, a couple of minutes). Reused after.
- **Sign in once** — the first container seeds your host CLI login; if Claude says
  it's not logged in, run `/login` once. The login lives in a **shared volume**
  (`reel-claude-config`), so every task container — and the GUI "Reopen in
  Container" path — inherits it.
- **Frontend deps** install on first `up` into a per-task volume (~1–2 min, in the
  background). Backend (prod) deps are **baked into the image** already.

## Running the app

`task stack <id>` starts uvicorn + Vite inside the container on the task's offset
host ports (e.g. `http://localhost:5174`). The container reaches the **shared dev
Postgres** on the Windows host via `host.docker.internal:5432` (the launcher
rewrites the `.env` `DATABASE_URL` host automatically).

> The backend image uses `requirements.prod.txt` (the lean API stack). The dev
> `requirements.txt` GPU/upscaler deps (`torch+cu121`, `realesrgan`, `basicsr`)
> are **not** installed — they need CUDA and are offloaded to Modal in normal dev.

## Caveats (read these)

1. **Secrets live in the sandbox.** To run the app, the container has your `.env`
   (R2 keys, etc.) and network access. The sandbox protects your **OS and files**
   from destructive commands — it does **not** stop genuinely malicious code from
   using those app secrets. Big win against accidents; not a zero-trust airgap.
2. **Conversations on one task share one tree.** Two chats doing `git add`/`commit`
   on the same files at once can still step on each other (the thing worktrees
   prevent). Fine if they work on different files / commit often — you're opting
   into shared editing on purpose.
3. **Push from the host** by default — the container never holds long-lived git
   push creds. Commit inside, push from the host checkout (or run `gh auth login`
   inside if you want to push from the container).

## Teardown

`task down <id>` removes the container (keeps the checkout so you can inspect/push
from the host). `task nuke <id>` also deletes `/c/work/tasks/<id>`. The shared dev
Postgres and the `reel-claude-config` login volume are left alone.
