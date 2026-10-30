import { Fragment, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// T13931: pure view of GET /api/admin/r2-usage -- receives the raw payload as props,
// does no fetching, derives every total at render. `untagged`/`unmatched` are fix-me
// signals (an R2 issuer with no source tag), so they are highlighted, never hidden.

const FIXME_SOURCES = new Set(['untagged', 'unmatched']);
const STALE_SHARD_MS = 2 * 60 * 60 * 1000;

const fmt = (n) => n.toLocaleString();

function sourceTotals(daily) {
  const bySource = new Map();
  for (const row of daily) {
    const key = `${row.env}|${row.source}`;
    let total = bySource.get(key);
    if (!total) {
      total = { key, env: row.env, source: row.source, class_a: 0, class_b: 0, free: 0, unclassified: 0, days: [] };
      bySource.set(key, total);
    }
    total.class_a += row.class_a;
    total.class_b += row.class_b;
    total.free += row.free;
    total.unclassified += row.unclassified;
    total.days.push(row);
  }
  return [...bySource.values()].sort((a, b) => b.class_a - a.class_a || b.class_b - a.class_b);
}

function CycleBar({ cycle, coverage }) {
  const pct = Math.min(100, (cycle.class_a / cycle.free_tier_class_a) * 100);
  const projectedOver = cycle.projected_class_a > cycle.free_tier_class_a;
  return (
    <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-4">
      <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
        Billing cycle {cycle.start} to {cycle.end} (all envs, day {cycle.elapsed_days})
      </div>
      <div className="text-lg font-bold text-white">
        {fmt(cycle.class_a)} / {fmt(cycle.free_tier_class_a)} Class A
      </div>
      <div className="h-2 rounded bg-white/10 mt-2 overflow-hidden">
        <div className={`h-full ${pct >= 50 ? 'bg-yellow-400' : 'bg-purple-400'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={`text-xs mt-1 ${projectedOver ? 'text-red-400' : 'text-gray-400'}`}>
        Projected at current pace: {fmt(cycle.projected_class_a)} Class A -- {fmt(cycle.class_b)} Class B so far
      </div>
      <div className="text-[10px] mt-1 text-gray-500">Coverage: {coverage}</div>
    </div>
  );
}

function SourceTable({ totals }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto mb-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Env</th>
            <th className="text-left px-3 py-2.5">Source (30 days)</th>
            <th className="text-right px-3 py-2.5">Class A</th>
            <th className="text-right px-3 py-2.5">Class B</th>
            <th className="text-right px-3 py-2.5">Free</th>
            <th className="text-right px-3 py-2.5">Unclassified</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => {
            const fixme = FIXME_SOURCES.has(t.source);
            return (
              <Fragment key={t.key}>
                <tr
                  data-testid={`r2-source-${t.key}`}
                  data-fixme={fixme ? 'true' : 'false'}
                  onClick={() => toggle(t.key)}
                  className={`border-b border-white/5 cursor-pointer transition-colors ${
                    fixme ? 'bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <td className="px-3 py-2 text-xs">{t.env}</td>
                  <td className="px-3 py-2 text-xs font-mono break-all">
                    {t.source}
                    {fixme && <span className="ml-2 text-[10px] uppercase text-yellow-400">fix me: tag this issuer</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-right">{fmt(t.class_a)}</td>
                  <td className="px-3 py-2 text-xs text-right">{fmt(t.class_b)}</td>
                  <td className="px-3 py-2 text-xs text-right text-gray-500">{fmt(t.free)}</td>
                  <td className="px-3 py-2 text-xs text-right text-gray-500">{fmt(t.unclassified)}</td>
                </tr>
                {expanded.has(t.key) && t.days.map((d) => (
                  <tr
                    key={d.day}
                    data-testid={`r2-day-${t.key}|${d.day}`}
                    className="border-b border-white/5 text-gray-500"
                  >
                    <td />
                    <td className="px-3 py-1.5 text-xs pl-8">{d.day}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmt(d.class_a)}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmt(d.class_b)}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmt(d.free)}</td>
                    <td className="px-3 py-1.5 text-xs text-right">{fmt(d.unclassified)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShardList({ shards, generatedAt }) {
  const now = Date.parse(generatedAt);
  return (
    <ul className="text-xs text-gray-400 space-y-1">
      {shards.map((s) => {
        const stale = s.last_modified != null && now - Date.parse(s.last_modified) > STALE_SHARD_MS;
        return (
          <li key={`${s.env}|${s.writer}`} data-testid={`r2-shard-${s.env}|${s.writer}`}>
            {s.env} / {s.writer ?? '--'} -- last upload {s.last_modified ?? '--'}
            {s.schema != null && ` -- schema ${s.schema}`}
            {stale && <span className="ml-2 text-yellow-400">stale (&gt; 2h)</span>}
            {s.error && <span className="ml-2 text-red-400">{s.error}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function R2UsagePanel({ data, loading, error, onRefresh }) {
  const unreadable = data ? data.shards.filter((s) => s.error).length : 0;
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load R2 usage'}
        </button>
        <span className="text-gray-500 text-xs">
          On-demand -- R2 operations by source, merged from every machine&apos;s analytics shard (cached 10 min).
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}

      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && (
        <>
          <div className="text-gray-500 text-xs mb-3">Generated {data.generated_at}</div>

          {data.partial && (
            <p className="text-red-400 text-sm mb-3">
              Partial result -- {unreadable} shard(s) or env listing(s) could not be read; totals exclude them.
            </p>
          )}

          <CycleBar cycle={data.cycle} coverage={data.coverage} />

          <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Today top sources (Class A)</div>
          {data.today_top.length === 0 ? (
            <p className="text-gray-500 text-sm mb-4">No R2 operations counted today.</p>
          ) : (
            <ol data-testid="r2-today-top" className="text-xs text-gray-300 space-y-1 mb-4 list-decimal pl-5">
              {data.today_top.map((r) => (
                <li key={`${r.env}|${r.source}`}>
                  <span className="font-mono">{r.env} {r.source}</span> -- {fmt(r.class_a)} A / {fmt(r.class_b)} B
                </li>
              ))}
            </ol>
          )}

          {data.daily.length === 0 ? (
            <p className="text-gray-500 text-sm py-3 mb-4">No R2 operations counted in the last 30 days.</p>
          ) : (
            <SourceTable totals={sourceTotals(data.daily)} />
          )}

          <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Shards</div>
          <ShardList shards={data.shards} generatedAt={data.generated_at} />
        </>
      )}
    </div>
  );
}
