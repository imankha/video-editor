import { useState, useEffect } from 'react';
import { Loader, AlertCircle, Play, Film } from 'lucide-react';
import { Button } from './shared/Button';
import { Logo } from './Logo';
import { GoogleOneTap } from './GoogleOneTap';
import { useAuthStore } from '../stores/authStore';
import { useGamesDataStore } from '../stores';
import { useEditorStore } from '../stores';
import { API_BASE } from '../config';

export function SharedAnnotationView({ shareToken, onClose }) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    let cancelled = false;
    async function fetchShare() {
      try {
        const resp = await fetch(`${API_BASE}/api/shared/teammate/${shareToken}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (resp.ok) {
          const json = await resp.json();
          setData(json);
          setState(json.materialized ? 'materialized' : 'ready');
        } else if (resp.status === 410) {
          setState('error');
          setErrorMessage('This share link is no longer active.');
        } else {
          setState('error');
          setErrorMessage('Share link not found.');
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setErrorMessage('Could not load shared content. Please try again.');
        }
      }
    }
    fetchShare();
    return () => { cancelled = true; };
  }, [shareToken]);

  // Materialized: find the game and navigate to annotate
  useEffect(() => {
    if (state !== 'materialized' || !data || !isAuthenticated) return;
    navigateToGame(data.game_blake3, data.sharer_email, data.first_clip_start, onClose);
  }, [state, data, isAuthenticated, onClose]);

  // Authenticated + unmaterialized: resolve pending shares, then navigate
  useEffect(() => {
    if (state !== 'ready' || !data || !isAuthenticated) return;
    if (!data.pending_ids || data.pending_ids.length === 0) {
      navigateToGame(data.game_blake3, data.sharer_email, data.first_clip_start, onClose);
      return;
    }

    async function resolve() {
      try {
        console.log('[SharedAnnotationView] Resolving pending shares:', data.pending_ids);
        const profileResp = await fetch(`${API_BASE}/api/profiles`, { credentials: 'include' });
        if (!profileResp.ok) {
          console.error('[SharedAnnotationView] /api/profiles failed:', profileResp.status);
          setState('error');
          setErrorMessage('Could not load your profile. Please try again.');
          return;
        }
        const profileData = await profileResp.json();
        const profiles = profileData.profiles || [];
        console.log('[SharedAnnotationView] Profiles:', profiles.length);
        const profileId = profiles.find(p => p.isDefault)?.id || profiles[0]?.id;
        if (!profileId) {
          console.error('[SharedAnnotationView] No profile found in response');
          setState('error');
          setErrorMessage('No profile found. Please try again.');
          return;
        }

        console.log('[SharedAnnotationView] Resolving with profile:', profileId);
        const resp = await fetch(`${API_BASE}/api/clips/resolve-pending-shares`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pending_ids: data.pending_ids, profile_id: profileId }),
        });
        if (resp.ok) {
          const result = await resp.json();
          console.log('[SharedAnnotationView] Resolve result:', result);
          if (result.errors?.length > 0) {
            console.error('[SharedAnnotationView] Resolve had errors:', result.errors);
            setState('error');
            setErrorMessage('Failed to load shared clips. Please try again.');
            return;
          }
          console.log('[SharedAnnotationView] Fetching games after materialization');
          await useGamesDataStore.getState().fetchGames();
          const games = useGamesDataStore.getState().games;
          console.log('[SharedAnnotationView] Games after fetch:', games.length, 'looking for hash:', data.game_blake3);
          navigateToGame(data.game_blake3, data.sharer_email, data.first_clip_start, onClose);
        } else {
          const text = await resp.text();
          console.error('[SharedAnnotationView] Resolve failed:', resp.status, text);
          setState('error');
          setErrorMessage('Failed to load shared clips. Please try again.');
        }
      } catch (err) {
        console.error('[SharedAnnotationView] Resolve error:', err);
        setState('error');
        setErrorMessage('Something went wrong. Please try again.');
      }
    }
    resolve();
  }, [state, data, isAuthenticated, onClose]);

  if (state === 'error') {
    return (
      <Shell>
        <AlertCircle size={48} className="text-gray-500" />
        <p className="text-gray-300 text-lg">{errorMessage}</p>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </Shell>
    );
  }

  // Authenticated: effects handle resolve + navigation — show loading
  if (isAuthenticated || state === 'loading' || !data) {
    return (
      <Shell>
        <Loader size={32} className="text-cyan-400 animate-spin" />
        <p className="text-gray-400">Loading shared clips...</p>
      </Shell>
    );
  }

  // Not authenticated: show sign-in prompt with share context
  const clipCount = data.clip_count || data.clip_names?.length || 0;
  return (
    <Shell>
      <GoogleOneTap />
      <div className="w-full max-w-md">
        {/* Card with gradient border */}
        <div className="rounded-2xl bg-gradient-to-br from-purple-500/20 via-indigo-500/10 to-cyan-500/20 p-[1px]">
          <div className="rounded-2xl bg-gray-800/90 backdrop-blur-sm p-8">
            {/* Clip preview area */}
            <div className="flex items-center justify-center mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Play size={36} className="text-white ml-1" fill="white" fillOpacity={0.9} />
              </div>
            </div>

            {/* Game title */}
            <h1 className="text-white text-2xl font-bold text-center mb-1">
              {data.game_name}
            </h1>
            <p className="text-gray-400 text-sm text-center mb-5">
              {clipCount} {clipCount === 1 ? 'clip' : 'clips'} from {data.sharer_email}
            </p>

            {/* Clip list */}
            {data.clip_names?.length > 0 && (
              <div className="space-y-2 mb-6">
                {data.clip_names.map((name, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-700/50">
                    <Film size={16} className="text-purple-400 shrink-0" />
                    <span className="text-gray-200 text-sm truncate">{name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              icon={Play}
              onClick={() => useAuthStore.getState().requireAuth(() => {})}
            >
              Sign in to watch
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-4 px-6">
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <Logo size={32} />
        <span className="text-white font-semibold">Reel Ballers</span>
      </div>
      {children}
    </div>
  );
}

function navigateToGame(blake3Hash, sharerEmail, firstClipStart, onClose) {
  const games = useGamesDataStore.getState().games;
  const game = blake3Hash ? games.find(g => g.blake3_hash === blake3Hash) : null;

  if (sharerEmail) {
    sessionStorage.setItem('shareAttribution', sharerEmail);
  }
  if (firstClipStart != null) {
    sessionStorage.setItem('pendingClipSeekTime', firstClipStart.toString());
  }

  if (game) {
    sessionStorage.setItem('pendingGameId', game.id.toString());
    useEditorStore.getState().setEditorMode('annotate');
    onClose();
  } else {
    useGamesDataStore.getState().fetchGames().then(() => {
      const refreshed = useGamesDataStore.getState().games;
      const found = blake3Hash ? refreshed.find(g => g.blake3_hash === blake3Hash) : null;
      if (found) {
        sessionStorage.setItem('pendingGameId', found.id.toString());
        useEditorStore.getState().setEditorMode('annotate');
      }
      onClose();
    });
  }
}
