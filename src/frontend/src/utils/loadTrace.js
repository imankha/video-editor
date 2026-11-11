/**
 * T16050: console instrumentation for loading screens, so a stuck spinner
 * names what it is still waiting for instead of leaving an empty console
 * (the gap that cost an hour on T16040, and before that T15220/T15410/T15490).
 *
 * `[LOAD]` is the common prefix a filter finds. All lines go through
 * console.info/warn/error (never console.log, which `vite.config.js`
 * strips in production), so they survive the production build.
 *
 * Usage (one trace per screen-open, started on the transition into a project/
 * item, never on every render):
 *   const trace = startLoadTrace('Frame', { projectId }, ['highlight', 'plays', 'video']);
 *   trace.arrived('highlight', { name: project.name });
 *   trace.empty('plays');                 // resolved, but nothing came back
 *   trace.failed('video', err);
 *   trace.settled();                      // or trace.settled({ emptyNeed: 'plays' })
 */

const PREFIX = '[LOAD]';
const STUCK_MS = 10000;

function formatIds(ids) {
  if (!ids) return '';
  const parts = Object.entries(ids)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function formatDetail(detail) {
  if (detail === undefined || detail === null) return '';
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ` ${String(detail)}`;
  }
}

/**
 * @param {string} screen - greppable screen name, e.g. 'Frame'
 * @param {Record<string, unknown>} ids - identifiers to log alongside (projectId, reqId, ...)
 * @param {string[]} needs - greppable need names this screen is waiting on
 */
export function startLoadTrace(screen, ids, needs) {
  const t0 = performance.now();
  const pending = new Set(needs);
  let settled = false;

  console.info(`${PREFIX} ${screen} waiting for ${needs.join(', ')}${formatIds(ids)}`);

  const stuckTimer = setTimeout(() => {
    if (settled || pending.size === 0) return;
    console.warn(
      `${PREFIX} ${screen} still waiting after ${STUCK_MS}ms for: ${[...pending].join(', ')}${formatIds(ids)}`
    );
  }, STUCK_MS);

  function elapsedMs() {
    return Math.round(performance.now() - t0);
  }

  function resolve(need) {
    pending.delete(need);
  }

  return {
    arrived(need, detail) {
      resolve(need);
      console.info(`${PREFIX} ${screen} ${need} arrived in ${elapsedMs()}ms${formatDetail(detail)}`);
    },
    failed(need, err) {
      resolve(need);
      const message = err?.message ?? String(err ?? 'unknown error');
      console.info(`${PREFIX} ${screen} ${need} failed in ${elapsedMs()}ms: ${message}`);
    },
    empty(need) {
      resolve(need);
      console.info(`${PREFIX} ${screen} ${need} empty in ${elapsedMs()}ms`);
    },
    settled(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(stuckTimer);
      if (outcome?.emptyNeed) {
        console.error(
          `${PREFIX} ${screen} settled with nothing to show: ${outcome.emptyNeed} empty${formatIds(ids)}`
        );
      } else {
        console.info(`${PREFIX} ${screen} settled in ${elapsedMs()}ms${formatIds(ids)}`);
      }
    },
  };
}
