import { useState, useEffect } from 'react';
import { Loader, AlertCircle } from 'lucide-react';
import { Button } from './shared/Button';
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
    navigateToGame(data.game_blake3, data.sharer_email, onClose);
  }, [state, data, isAuthenticated, onClose]);

  // Authenticated + unmaterialized: resolve pending shares, then navigate
  useEffect(() => {
    if (state !== 'ready' || !data || !isAuthenticated) return;
    if (!data.pending_ids || data.pending_ids.length === 0) {
      navigateToGame(data.game_blake3, data.sharer_email, onClose);
      return;
    }

    async function resolve() {
      try {
        const profileResp = await fetch(`${API_BASE}/api/profiles`, { credentials: 'include' });
        if (!profileResp.ok) return;
        const profiles = await profileResp.json();
        const profileId = profiles.find(p => p.is_default)?.id || profiles[0]?.id;
        if (!profileId) return;

        const resp = await fetch(`${API_BASE}/api/clips/resolve-pending-shares`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ pending_ids: data.pending_ids, profile_id: profileId }),
        });
        if (resp.ok) {
          await useGamesDataStore.getState().fetchGames();
          navigateToGame(data.game_blake3, data.sharer_email, onClose);
        }
      } catch {
        // Fall through to show error
      }
    }
    resolve();
  }, [state, data, isAuthenticated, onClose]);

  if (state === 'loading' || (state === 'materialized' && isAuthenticated)) {
    return (
      <Shell>
        <Loader size={32} className="text-cyan-400 animate-spin" />
        <p className="text-gray-400">Loading shared clips...</p>
      </Shell>
    );
  }

  if (state === 'error' || !data) {
    return (
      <Shell>
        <AlertCircle size={48} className="text-gray-500" />
        <p className="text-gray-300 text-lg">{errorMessage}</p>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </Shell>
    );
  }

  // Not authenticated: show sign-in prompt with share context
  return (
    <Shell>
      <div className="text-center max-w-sm">
        <p className="text-gray-400 text-sm mb-1">
          {data.sharer_email} shared clips with you from
        </p>
        <p className="text-white text-xl font-semibold mb-1">{data.game_name}</p>
        {data.tag_name && (
          <p className="text-cyan-400 text-sm mb-6">Tagged: {data.tag_name}</p>
        )}
        <p className="text-gray-300 text-sm mb-4">
          Sign in to view the clips in your account
        </p>
        <div className="flex gap-3 justify-center">
          {data.recipient_has_account ? (
            <Button variant="primary" onClick={() => useAuthStore.getState().requireAuth(() => {})}>
              Sign In
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => useAuthStore.getState().requireAuth(() => {})}>
                Sign Up
              </Button>
              <Button variant="secondary" onClick={() => useAuthStore.getState().requireAuth(() => {})}>
                Sign In
              </Button>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-4 px-8">
      <div className="absolute top-4 left-4">
        <span className="text-white font-semibold text-sm">Reel Ballers</span>
      </div>
      {children}
    </div>
  );
}

function navigateToGame(blake3Hash, sharerEmail, onClose) {
  const games = useGamesDataStore.getState().games;
  const game = blake3Hash ? games.find(g => g.blake3_hash === blake3Hash) : null;

  if (sharerEmail) {
    sessionStorage.setItem('shareAttribution', sharerEmail);
  }

  if (game) {
    sessionStorage.setItem('pendingGameId', game.id.toString());
    useEditorStore.getState().setEditorMode('annotate');
    onClose();
  } else {
    // Game not found yet -- refresh games and retry once
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
