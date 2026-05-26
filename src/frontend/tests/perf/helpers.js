/**
 * Performance measurement helpers for the Playwright perf harness.
 *
 * Provides CDP-based network waterfall collection and reporting utilities.
 */

/**
 * Create a CDP-backed performance collector for a Playwright page.
 *
 * Usage:
 *   const collector = await createPerfCollector(page);
 *   collector.startCollection();
 *   // ... navigate / interact ...
 *   collector.stopCollection();
 *   const waterfall = collector.getNetworkWaterfall();
 *   await collector.dispose();
 */
export async function createPerfCollector(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('Network.enable');

  const requests = new Map();
  let collecting = false;
  let baseTimestamp = null;

  client.on('Network.requestWillBeSent', (params) => {
    if (!collecting) return;
    if (baseTimestamp === null) baseTimestamp = params.timestamp;
    requests.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      startTime: params.timestamp,
      type: params.type || 'Other',
    });
  });

  client.on('Network.responseReceived', (params) => {
    const req = requests.get(params.requestId);
    if (!req) return;
    req.status = params.response.status;
    req.mimeType = params.response.mimeType;
    req.responseTime = params.timestamp;
  });

  client.on('Network.loadingFinished', (params) => {
    const req = requests.get(params.requestId);
    if (!req) return;
    req.endTime = params.timestamp;
    req.encodedDataLength = params.encodedDataLength;
  });

  client.on('Network.loadingFailed', (params) => {
    const req = requests.get(params.requestId);
    if (!req) return;
    req.endTime = params.timestamp;
    req.error = params.errorText;
  });

  return {
    startCollection() {
      requests.clear();
      collecting = true;
      baseTimestamp = null;
    },

    stopCollection() {
      collecting = false;
    },

    getNetworkWaterfall() {
      const entries = [...requests.values()]
        .filter(r => r.endTime)
        .sort((a, b) => a.startTime - b.startTime);

      if (entries.length === 0) return [];
      const base = baseTimestamp || entries[0].startTime;

      return entries.map(r => {
        const startMs = Math.round((r.startTime - base) * 1000);
        const durationMs = Math.round((r.endTime - r.startTime) * 1000);
        return {
          url: r.url,
          method: r.method,
          status: r.status,
          type: r.type,
          mimeType: r.mimeType,
          startMs,
          endMs: startMs + durationMs,
          durationMs,
          encodedSize: r.encodedDataLength,
          error: r.error || null,
        };
      });
    },

    async dispose() {
      try {
        await client.send('Performance.disable');
        await client.send('Network.disable');
        await client.detach();
      } catch { /* already detached */ }
    },
  };
}

/**
 * Format a network waterfall as readable text lines.
 */
export function formatWaterfall(waterfall, { maxEntries = 25, apiOnly = false } = {}) {
  let entries = waterfall;
  if (apiOnly) {
    entries = entries.filter(e =>
      e.url.includes('/api/') || e.url.includes('/storage/')
    );
  }
  entries = entries.slice(0, maxEntries);

  if (entries.length === 0) return '    (no API requests captured)';

  return entries.map(e => {
    const urlShort = e.url.replace(/https?:\/\/[^/]+/, '').split('?')[0];
    const size = e.encodedSize ? ` ${fmtBytes(e.encodedSize)}` : '';
    const status = e.error ? 'ERR' : e.status;
    return `    [${pad(e.startMs, 5)}-${pad(e.endMs, 5)}ms] ${e.method} ${urlShort} -> ${status}${size} (${e.durationMs}ms)`;
  }).join('\n');
}

function pad(n, w) { return String(n).padStart(w); }

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Format all results as a markdown summary table.
 */
export function formatSummaryTable(results) {
  const header = '| Page                 | Time to Usable (ms) | API Calls | Slowest API Request                |';
  const sep    = '|----------------------|---------------------|-----------|------------------------------------|';
  const rows = results.map(r => {
    if (r.skipped) {
      return `| ${r.page.padEnd(20)} | ${'SKIPPED'.padStart(19)} |       ${'-'.padStart(3)} | -                                  |`;
    }
    const apiCalls = (r.networkWaterfall || []).filter(e =>
      e.url.includes('/api/') || e.url.includes('/storage/')
    );
    const slowest = [...apiCalls].sort((a, b) => b.durationMs - a.durationMs)[0];
    const slowestStr = slowest
      ? `${slowest.url.replace(/https?:\/\/[^/]+/, '').split('?')[0]} (${slowest.durationMs}ms)`
      : '-';
    return `| ${r.page.padEnd(20)} | ${String(r.durationMs).padStart(19)} | ${String(apiCalls.length).padStart(9)} | ${slowestStr.substring(0, 34).padEnd(34)} |`;
  });

  return [header, sep, ...rows].join('\n');
}
