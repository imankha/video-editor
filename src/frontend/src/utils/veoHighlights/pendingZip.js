/**
 * T13240 - memory-only handoff of a dropped Veo zip to the Annotate screen of the game the
 * user chose (a File cannot ride sessionStorage). Taken once when that game opens.
 */
let pending = null; // { gameId, file }

export function setPendingVeoZip(gameId, file) {
  pending = { gameId: Number(gameId), file };
}

/** Returns the zip for `gameId` and clears it; other games' zips stay queued. */
export function takePendingVeoZip(gameId) {
  if (!pending || pending.gameId !== Number(gameId)) return null;
  const { file } = pending;
  pending = null;
  return file;
}
