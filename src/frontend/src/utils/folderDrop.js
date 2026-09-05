/**
 * T8810 — Folder drag-drop support for the universal footage dropzone.
 *
 * When a user drags a whole camera FOLDER onto the dropzone, the browser exposes
 * each dropped item as a `FileSystemEntry` via `DataTransferItem.webkitGetAsEntry()`.
 * A directory entry has no `.files` — it must be walked with a `createReader()`
 * that hands back children in BATCHES (you must call `readEntries` repeatedly until
 * it returns an empty batch). These helpers flatten an entry tree into a flat
 * `File[]` so it can go straight into `useFootageIntake.addFiles`, which owns all
 * junk/proxy/MIME filtering (do NOT filter here — folder-dropped files routinely
 * report an empty MIME type and T8800's extension fallback in `isVideoFile`
 * handles them).
 *
 * The caller MUST collect the entries SYNCHRONOUSLY inside the drop handler
 * (`DataTransferItemList` is emptied once the event returns), then hand the
 * collected entries here for the async walk.
 */

/** Resolve a single file entry to its File object. */
function _entryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Drain a directory reader — readEntries yields batches until an empty one. */
function _readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const collected = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(collected);
          return;
        }
        collected.push(...batch);
        pump(); // more may remain — keep draining
      }, reject);
    };
    pump();
  });
}

/** Recursively flatten one FileSystemEntry (file or directory) to a File[]. */
export async function entryToFiles(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    return [await _entryFile(entry)];
  }
  if (entry.isDirectory) {
    const children = await _readAllEntries(entry.createReader());
    const nested = [];
    for (const child of children) {
      nested.push(...(await entryToFiles(child)));
    }
    return nested;
  }
  return [];
}

/** Flatten an array of already-collected entries into a single File[]. */
export async function collectFilesFromEntries(entries) {
  const out = [];
  for (const entry of entries || []) {
    out.push(...(await entryToFiles(entry)));
  }
  return out;
}

/**
 * True when a drop contains at least one directory. Reads the entries that were
 * collected synchronously in the drop handler.
 */
export function hasDirectoryEntry(entries) {
  return (entries || []).some((e) => e && e.isDirectory);
}

/**
 * Synchronously pull the FileSystemEntry list off a drop event's DataTransfer.
 * MUST be called inside the drop handler, before any await. Returns [] when the
 * browser doesn't support the entry API (older/Firefox) — the caller then falls
 * back to `dataTransfer.files`.
 */
export function entriesFromDataTransfer(dataTransfer) {
  const items = dataTransfer?.items;
  if (!items || !items.length) return [];
  const entries = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}
