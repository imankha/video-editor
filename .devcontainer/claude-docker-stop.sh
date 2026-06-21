#!/usr/bin/env bash
# Stop (shut down) the video-editor dev container to free memory/CPU.
#
# You do NOT need this just to leave a Claude session -- exiting Claude
# (Ctrl-C / /exit) already returns you to the host and leaves the container
# running warm for a fast next launch. Use THIS only when you want the
# container fully stopped. The next `claude-docker.sh` will start it again.
#
# USAGE:  .devcontainer/claude-docker-stop.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# find-container.js matches the running dev container for this repo regardless
# of how the host path was formatted in the container label (see that file).
CID="$(node "$SCRIPT_DIR/find-container.js")"

if [ -z "$CID" ]; then
  echo "[claude-docker-stop] no running dev container found for this repo. Nothing to stop."
  exit 0
fi

echo "[claude-docker-stop] stopping container ${CID:0:12}..."
docker stop "$CID" >/dev/null
echo "[claude-docker-stop] stopped. Run .devcontainer/claude-docker.sh to start again."
