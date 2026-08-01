import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader, PlusCircle, Check } from 'lucide-react';
import { Button } from './shared/Button';
import { GoogleOneTap } from './GoogleOneTap';
import { useAuthStore } from '../stores/authStore';
import { useGamesDataStore, useEditorStore, useProfileStore, EDITOR_MODES } from '../stores';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { setPendingRecap } from '../utils/pendingNavigation';

/**
 * ClaimGameView - the T5730 claim & import dialog for a public game link.
 *
 * Reached at `/claim/game/{token}` (the frozen T5720 seam; the token is the LAST
 * path segment so it survives a signup reload). The claim is a CONSENT MOMENT
 * (EPIC decision 8), never a silent materialize on auth:
 *   - Not signed in  -> sign-up CTA. The token stays in the URL through auth.
 *   - Signed in      -> import dialog: profile pick (multi-profile accounts),
 *                       "Include team annotations" opt-in (default ON), Confirm.
 * Confirm POSTs the claim; success lands on the game card / recap (NOT Annotate)
 * with a tag-your-athlete nudge (post-import landing owned by ProjectManager via
 * the pendingRecap breadcrumb).
 *
 * The onboarding QuestPanel is suppressed while on this route by reusing the
 * existing `shared_annotation_flow` sessionStorage flag (cleared by App.jsx once
 * authenticated AND off the shared/claim route).
 */
export function ClaimGameView({ token, onClose }) {
  const [state, setState] = useState('loading'); // loading | ready | revoked | not_found | error
  const [share, setShare] = useState(null);
  const [profiles, setProfiles] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [importing, setImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  // Suppress the onboarding QuestPanel while claiming (reuse the T5330b flag).
  useEffect(() => {
    sessionStorage.setItem('shared_annotation_flow', 'true');
  }, []);

  // Resolve the share (game name + clip count for the dialog). Team-recap-only
  // public payload -- no auth required, so this loads before/after sign-in alike.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await apiFetch(`${API_BASE}/api/shared/game/${token}`);
        if (cancelled) return;
        if (resp.ok) {
          setShare(await resp.json());
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
    load();
    return () => { cancelled = true; };
  }, [token]);

  // Once signed in, load the profiles for the athlete pick.
  useEffect(() => {
    if (!isAuthenticated || profiles !== null) return;
    let cancelled = false;
    async function loadProfiles() {
      try {
        const resp = await apiFetch(`${API_BASE}/api/profiles`);
        if (cancelled) return;
        if (resp.ok) {
          const data = await resp.json();
          const list = data.profiles || [];
          setProfiles(list);
          const preferred = list.find(p => p.isDefault)?.id || list[0]?.id || null;
          setSelectedProfileId(preferred);
        } else {
          setProfiles([]);
        }
      } catch {
        if (!cancelled) setProfiles([]);
      }
    }
    loadProfiles();
    return () => { cancelled = true; };
  }, [isAuthenticated, profiles]);

  const handleSignIn = useCallback(() => {
    // The global AuthGateModal (mounted in main.jsx) handles the flow; the token
    // rides the URL through auth. No silent materialize -- Confirm still required.
    useAuthStore.getState().requireAuth(() => {});
  }, []);

  const handleConfirm = useCallback(async () => {
    setImporting(true);
    setErrorMessage(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/shared/game/${token}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_token: token,
          import_annotations: includeAnnotations,
          target_profile_id: selectedProfileId,
        }),
      });
      if (resp.ok) {
        const result = await resp.json();
        // Post-import landing = the game card / recap, NOT Annotate. Breadcrumb
        // the claimed game's recap (consumed by ProjectManager once games load).
        setPendingRecap(result.game_id);
        const currentProfileId = useProfileStore.getState().currentProfileId;
        if (result.profile_id && result.profile_id !== currentProfileId) {
          // The game landed in a profile other than the active one (a different
          // pick, or an annotations-upgrade re-claim forced to the original
          // profile). Switch to it: this swaps the X-Profile-ID header, resets the
          // data stores, refetches, and navigates home -- so the recap resolves.
          await useProfileStore.getState().switchProfile(result.profile_id);
        } else {
          await useGamesDataStore.getState().fetchGames();
          useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
        }
        onClose();
      } else {
        const body = await resp.json().catch(() => ({}));
        setImporting(false);
        setErrorMessage(
          body?.detail?.message ||
          (typeof body?.detail === 'string' ? body.detail : null) ||
          'Could not import this game. Please try again.',
        );
      }
    } catch {
      setImporting(false);
      setErrorMessage('Something went wrong. Please try again.');
    }
  }, [token, includeAnnotations, selectedProfileId, onClose]);

  if (state === 'loading') {
    return (
      <Shell>
        <Loader size={32} className="text-cyan-400 animate-spin" />
        <p className="text-gray-400">Loading…</p>
      </Shell>
    );
  }

  if (state === 'revoked' || state === 'not_found' || state === 'error') {
    const message = state === 'revoked'
      ? 'This link is no longer active.'
      : 'This game link could not be found.';
    return (
      <Shell>
        <AlertCircle size={48} className="text-gray-500" />
        <p className="text-gray-300 text-lg text-center">{message}</p>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </Shell>
    );
  }

  const clipCount = share?.clip_count ?? 0;
  const gameTitle = share?.game_name || 'Shared game';

  // Signed out: sign-up CTA. Nothing materializes here -- the claim completes
  // after auth via the Confirm below (EPIC decision 8).
  if (!isAuthenticated) {
    return (
      <Shell>
        <GoogleOneTap />
        <Card>
          <Heading title="Add this game to your account" subtitle={gameTitle} />
          <p className="text-gray-400 text-sm text-center mb-6">
            Sign up to save this game{clipCount > 0 ? ` and its ${clipCount} team ${clipCount === 1 ? 'play' : 'plays'}` : ''}, then tag your own athlete.
          </p>
          <Button variant="primary" size="lg" fullWidth icon={PlusCircle} onClick={handleSignIn}>
            Sign up to add this game
          </Button>
        </Card>
      </Shell>
    );
  }

  // Signed in: the import dialog (profile pick + annotations opt-in + Confirm).
  const multiProfile = (profiles?.length || 0) > 1;
  return (
    <Shell>
      <Card>
        <Heading title="Add this game to your account" subtitle={gameTitle} />

        {profiles === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader size={24} className="text-cyan-400 animate-spin" />
          </div>
        ) : (
          <>
            {multiProfile && (
              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-400 mb-2">
                  Add to which athlete?
                </label>
                <div className="space-y-2">
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProfileId(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        selectedProfileId === p.id
                          ? 'border-cyan-400 bg-cyan-400/10'
                          : 'border-gray-700 bg-gray-700/40 hover:border-gray-600'
                      }`}
                    >
                      <span className="text-sm text-gray-100 truncate">{p.name || 'Athlete'}</span>
                      {selectedProfileId === p.id && <Check size={16} className="text-cyan-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-start gap-3 mb-6 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAnnotations}
                onChange={e => setIncludeAnnotations(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500"
              />
              <span className="text-sm text-gray-200">
                Include team annotations
                {clipCount > 0 && <span className="text-gray-400"> ({clipCount} {clipCount === 1 ? 'play' : 'plays'})</span>}
                <span className="block text-xs text-gray-500 mt-0.5">
                  Adds the shared team plays to your Team layer. The game is always added.
                </span>
              </span>
            </label>

            {errorMessage && (
              <p className="text-sm text-red-400 mb-4 text-center">{errorMessage}</p>
            )}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              icon={importing ? undefined : PlusCircle}
              disabled={importing || !selectedProfileId}
              onClick={handleConfirm}
            >
              {importing ? 'Adding…' : 'Add to my account'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="w-full mt-3 text-sm text-gray-400 hover:text-white transition-colors"
              disabled={importing}
            >
              Not now
            </button>
          </>
        )}
      </Card>
    </Shell>
  );
}

function Heading({ title, subtitle }) {
  return (
    <>
      <h1 className="text-white text-xl font-bold text-center mb-1">{title}</h1>
      <p className="text-cyan-400 text-sm text-center mb-5 truncate">{subtitle}</p>
    </>
  );
}

function Card({ children }) {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl bg-gray-800/90 backdrop-blur-sm border border-gray-700 p-8">
        {children}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-4 px-6">
      {children}
    </div>
  );
}

export default ClaimGameView;
