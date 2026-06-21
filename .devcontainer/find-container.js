#!/usr/bin/env node
// Print the docker container id of the running dev container for THIS repo, or
// nothing if none is running. Used by claude-docker-stop.{sh,bat}.
//
// The devcontainer CLI labels each container with `devcontainer.local_folder` =
// the absolute host path it was started from. That path's FORMAT varies by
// platform/shell (drive-letter case, forward vs back slashes), so we don't try
// to reconstruct it exactly -- we just match the last path segment (the repo
// folder name) case-insensitively. Callers must `cd` to the repo root first.
const { execSync } = require("child_process");
const path = require("path");

const base = path.basename(process.cwd()).toLowerCase();
const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

const ids = sh("docker ps -q --filter label=devcontainer.local_folder")
  .split(/\s+/)
  .filter(Boolean);

for (const id of ids) {
  const lf = sh(`docker inspect -f "{{ index .Config.Labels \\"devcontainer.local_folder\\" }}" ${id}`);
  const last = lf.replace(/[\\/]+$/, "").split(/[\\/]/).pop().toLowerCase();
  if (last === base) {
    process.stdout.write(id);
    break;
  }
}
