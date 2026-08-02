import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader, PlusCircle } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

/**
 * SharedGameView - public watch page for a broadcast game link (T5720).
 *
 * The SPA fallthrough target for `functions/shared/game/[token].js` AND the
 * in-app viewing experience. Anonymous scope is the TEAM RECAP ONLY: the resolve
 * API returns no full-game URL and no athlete-layer data, so there is nothing to
 * gate here. State machine mirrors SharedCollectionView: 410 -> inactive,
 * 404/error -> not found.
 *
 * The "Add this game to your account" CTA carries the token toward T5730's claim
 * flow (`/claim/game/{token}`), which does not exist yet -- until it lands the
 * route falls through to signup with the token preserved; nothing
 * auto-materializes on auth (EPIC decision 8).
 */
export function SharedGameView({ token }) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);

  const handleClaim = useCallback(() => {
    window.location.assign(`/claim/game/${token}`);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    async function fetchGameLink() {
      try {
        const resp = await apiFetch(`${API_BASE}/api/shared/game/${token}`);
        if (cancelled) return;
        if (resp.ok) {
          const body = await resp.json();
          if (body.recap_url) {
            fetch(body.recap_url, { headers: { Range: 'bytes=0-524287' } }).catch(() => {});
          }
          setData(body);
          setState('ready');
        } else if (resp.status === 410) {
          setState('revoked');
        } else {
          setState('not_found');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    }
    fetchGameLink();
    return () => { cancelled = true; };
  }, [token]);

  if (state === 'loading') {
    return (
      <ViewerShell>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader size={32} className="text-cyan-400 animate-spin" />
          <p className="text-gray-400">Loading team recap...</p>
        </div>
      </ViewerShell>
    );
  }

  if (state === 'ready' && data) {
    const title = data.game_date ? `${data.game_name} — ${data.game_date}` : data.game_name;
    const clips = Array.isArray(data.clips) ? data.clips : [];
    return (
      <div className="fixed inset-0 z-[70] bg-gray-950 flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
          <h1 className="text-sm font-semibold text-white truncate pr-4">{title}</h1>
          <span className="text-xs font-bold text-cyan-400 tracking-wide whitespace-nowrap">REEL BALLERS</span>
        </header>
        {data.sharer_name && (
          <div className="px-4 py-1.5 text-xs text-gray-400 bg-gray-900 border-b border-gray-800/60">
            Filmed by {data.sharer_name}&apos;s family
          </div>
        )}
        <main className="flex-1 flex items-center justify-center bg-black overflow-hidden min-h-[40vh]">
          {data.recap_url ? (
            <video
              src={data.recap_url}
              poster={data.poster_url || undefined}
              autoPlay
              muted
              playsInline
              controls
              preload="auto"
              className="max-w-full max-h-full w-auto h-auto bg-black"
            />
          ) : (
            <p className="text-gray-400 px-6 text-center">This recap is temporarily unavailable.</p>
          )}
        </main>
        {clips.length > 0 && (
          <ol className="list-none flex gap-2 overflow-x-auto px-3 py-2 bg-gray-900 border-t border-gray-800">
            {clips.map((c, i) => (
              <li
                key={i}
                className="flex-none flex flex-col gap-0.5 px-3 py-2 bg-gray-800 border border-amber-500/30 rounded-lg min-w-[120px]"
              >
                <span className="text-xs font-semibold text-amber-200">{c.name}</span>
                {Array.isArray(c.player_tags) && c.player_tags.length > 0 && (
                  <span className="text-[11px] text-gray-400">{c.player_tags.join(', ')}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        <footer className="flex items-center justify-center px-4 py-3.5 border-t border-gray-800 bg-gray-900">
          <button
            onClick={handleClaim}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-cyan-400 text-cyan-950 font-bold text-sm hover:bg-cyan-300 transition-colors"
          >
            <PlusCircle size={18} />
            Add this game to your account
          </button>
        </footer>
      </div>
    );
  }

  const message = state === 'revoked'
    ? 'This link is no longer active.'
    : 'This game link could not be found.';

  return (
    <ViewerShell>
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        <AlertCircle size={48} className="text-gray-500" />
        <p className="text-gray-300 text-lg">{message}</p>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>Close</Button>
      </div>
    </ViewerShell>
  );
}

function ViewerShell({ children }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col md:inset-12 md:rounded-xl md:overflow-hidden">
      {children}
    </div>
  );
}

export default SharedGameView;
