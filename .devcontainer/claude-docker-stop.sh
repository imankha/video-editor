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
cd "$(dirname "$0")/.."

# The devcontainer CLI labels each container with the absolute host folder it
# was started from. Resolve the same path the CLI would (Node, same cwd).
FOLDER="$(node -e "process.stdout.write(require('path').resolve('.'))")"
CID="$(docker ps -q --filter "label=devcontainer.local_folder=$FOLDER")"

if [ -z "$CID" ]; then
  # Fallback: match any running devcontainer whose folder basename is this repo
  # (covers drive-letter/slash normalization differences across shells).
  base="$(basename "$(pwd)")"
  CID="$(docker ps -q --filter "label=devcontainer.local_folder" | while read -r c; do
    lf="$(docker inspect -f '{{ index .Config.Labels "devcontainer.local_folder" }}' "$c" 2>/dev/null)"
    case "$(basename "$lf")" in "$base") printf '%s\n' "$c"; break;; esac
  done)"
fi

if [ -z "$CID" ]; then
  echo "[claude-docker-stop] no running dev container found for this repo. Nothing to stop."
  exit 0
fi

echo "[claude-docker-stop] stopping container ${CID:0:12}..."
docker stop "$CID" >/dev/null
echo "[claude-docker-stop] stopped. Run .devcontainer/claude-docker.sh to start again."
