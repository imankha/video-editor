# Full-stack "task sandbox" image for parallel, permission-free Claude sessions.
#
# WHY this exists (vs the GUI .devcontainer): the `scripts/task` launcher runs
# MANY of these at once -- one container per task, on offset ports -- via raw
# `docker run`. Raw docker (not the devcontainer CLI) is what lets each task get
# its own container name, its own published host ports, and a host-Postgres
# route. This image bakes everything those containers need so startup is fast.
#
# WHAT'S BAKED:
#   - Python 3.11 + the backend's PROD deps (requirements.prod.txt). We use the
#     PROD set on purpose: the dev requirements.txt pulls torch==*+cu121 / basicsr
#     / realesrgan (the local-GPU Real-ESRGAN upscaler) which (a) needs CUDA and
#     won't run in a CPU container and (b) is offloaded to Modal in normal dev.
#     The prod set is the lean API stack and installs in ~40s from manylinux wheels.
#   - Node 20 + the Claude Code CLI (global).
#   - ffmpeg (local video ops), git, gh.
#   - A non-root `dev` user -- bypassPermissions mode REFUSES to run as root.
#
# Frontend node_modules is NOT baked (it belongs under the mounted /workspace and
# would be shadowed by the bind mount); `scripts/task` installs it on first `up`
# into a named volume so it persists and isn't shadowed.
FROM python:3.11-slim

# --- system deps -------------------------------------------------------------
# ffmpeg: local video ops. git/curl/ca-certificates: clone + tooling. gnupg: gh.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git curl ca-certificates gnupg sudo \
    && rm -rf /var/lib/apt/lists/*

# --- Node 20 (NodeSource) ----------------------------------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- GitHub CLI --------------------------------------------------------------
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# --- Claude Code CLI (global; installed as root, run as non-root later) ------
RUN npm install -g @anthropic-ai/claude-code

# --- backend PROD deps (baked into system site-packages, OUTSIDE /workspace) --
# Living outside /workspace means the /workspace bind mount never shadows them.
COPY src/backend/requirements.prod.txt /tmp/requirements.prod.txt
RUN pip install --no-cache-dir -r /tmp/requirements.prod.txt && rm /tmp/requirements.prod.txt

# --- non-root user -----------------------------------------------------------
# bypassPermissions refuses to start as root, so sessions run as `dev`.
# Passwordless sudo so in-container `apt-get` etc. still work if a task needs it.
RUN useradd -m -s /bin/bash dev \
    && echo "dev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dev \
    && chmod 0440 /etc/sudoers.d/dev

# Claude keeps its WHOLE config (incl. .claude.json: MCP approvals, trust, theme)
# under this dir, which `scripts/task` mounts as a shared named volume so you
# sign in ONCE for every task container.
ENV CLAUDE_CONFIG_DIR=/home/dev/.claude
# Belt-and-suspenders for the CLI root guard (we already run as non-root `dev`).
ENV IS_SANDBOX=1

USER dev
WORKDIR /workspace
CMD ["sleep", "infinity"]
