/**
 * T13810: sync trace -- one memory-only ring buffer that names, for every
 * client holder of server-derived state, WHEN it was last refreshed, WHY, and
 * which write (by request id) should have refreshed it.
 *
 * Import-free on purpose (no React, no stores, no analytics) so stores can
 * import it without cycles. Nothing here persists or renders anything.
 *
 *   window.__syncTrace.dump()     -> prints compact [SYNC] lines
 *   window.__syncTrace.entries()  -> array, for Playwright
 *   window.__syncCheck(ids)       -> installed by syncCheck.js (diffs vs server)
 */

const MAX_ENTRIES = 500;
let _buffer = [];
let _seq = 0;
const _holders = new Map();

/**
 * @param {{kind: 'fetch'|'write'|'signal'|'derive'|'check', holder: string,
 *          reason: string, reqId?: string, summary?: object}} entry
 */
export function recordSync({ kind, holder, reason, reqId = null, summary = {} }) {
  const entry = { seq: ++_seq, t: Date.now(), kind, holder, reason, reqId, summary };
  _buffer.push(entry);
  while (_buffer.length > MAX_ENTRIES) _buffer.shift();
  return entry;
}

/** Small, comparable digest of the /collections/summary payload (never the whole payload). */
export function summarizeCollections(data) {
  return {
    total: data?.total_reel_count ?? null,
    mixes: data?.mixes?.reel_count ?? null,
    games: (data?.games || []).map((g) => [g.game_id, g.reel_count]),
  };
}

/** A mutating gesture's request: names the request id and whether the server accepted it. */
export function recordWrite(holder, reason, response, summary = {}) {
  return recordSync({
    kind: 'write', holder, reason, reqId: response?.reqId ?? null,
    summary: { ...summary, ok: !!response?.ok, status: response?.status ?? null },
  });
}

export function syncEntries() {
  return [..._buffer];
}

export function resetSyncTrace() {
  _buffer = [];
  _seq = 0;
  _holders.clear();
}

/** Compact one-line-per-entry form; also logs each line to the console. */
export function syncDump() {
  const lines = _buffer.map((e) => {
    const time = new Date(e.t).toISOString().slice(11, 23);
    return `[SYNC] ${time} ${e.kind} ${e.holder} reason=${e.reason} req=${e.reqId ?? '-'} ${JSON.stringify(e.summary)}`;
  });
  lines.forEach((l) => console.log(l));
  return lines;
}

/**
 * A caller that passes no reason is flagged in the trace itself:
 * `unspecified:<first stack frame outside the stores/trace>`.
 */
export function resolveReason(reason) {
  if (reason) return reason;
  const frames = (new Error().stack || '').split('\n').slice(2);
  const caller = frames.find((f) => !/syncTrace|\/stores\//.test(f)) || frames[0] || '';
  const m = caller.match(/([^/\\\s(]+:\d+):\d+\)?\s*$/);
  return `unspecified:${m ? m[1] : 'unknown'}`;
}

export function lastRefresh(holder) {
  for (let i = _buffer.length - 1; i >= 0; i--) {
    const e = _buffer[i];
    if (e.holder === holder && (e.kind === 'fetch' || e.kind === 'signal')) return e;
  }
  return null;
}

/** Most recent `write` entry newer than `seq` (the refresh it should have triggered). */
export function lastWriteAfter(_holder, seq) {
  for (let i = _buffer.length - 1; i >= 0; i--) {
    const e = _buffer[i];
    if (e.seq <= seq) break;
    if (e.kind === 'write') return e;
  }
  return null;
}

/** Component-held state (collections, annotate instances): written where the state is set. */
export function registerHolder(name, getter) {
  _holders.set(name, getter);
}
export function unregisterHolder(name) {
  _holders.delete(name);
}
export function getRegisteredHolder(name) {
  const getter = _holders.get(name);
  return getter ? getter() : undefined;
}
export function registeredHolderNames() {
  return [..._holders.keys()];
}

/**
 * Pure diff: client holder values vs server truth, same keys. Each mismatch row
 * carries the holder's last refresh and the newer write that did not refresh it.
 */
export function diffHolders(client, server, attributeTo = {}) {
  const rows = [];
  for (const holder of Object.keys(client)) {
    if (JSON.stringify(client[holder]) === JSON.stringify(server[holder])) continue;
    // A derived value (e.g. clip stages) is attributed to the holder it is derived from.
    const source = attributeTo[holder] || holder;
    const refresh = lastRefresh(source);
    const write = lastWriteAfter(source, refresh ? refresh.seq : 0);
    rows.push({
      holder,
      client: client[holder],
      server: server[holder],
      lastRefresh: refresh ? { reason: refresh.reason, reqId: refresh.reqId } : null,
      lastRefreshAgeMs: refresh ? Date.now() - refresh.t : null,
      newerWrite: write ? pick(write) : null,
    });
  }
  return rows;
}

function pick(w) {
  return { reason: w.reason, reqId: w.reqId, ageMs: Date.now() - w.t, holder: w.holder };
}

if (typeof window !== 'undefined') {
  window.__syncTrace = { entries: syncEntries, dump: syncDump };
}
