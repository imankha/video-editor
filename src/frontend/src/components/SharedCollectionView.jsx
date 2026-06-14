import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader, Lock, FolderOpen, Share2, Check } from 'lucide-react';
import { Button } from './shared/Button';
import { CollectionPlayer } from './collections/CollectionPlayer';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';

/**
 * SharedCollectionView - public viewer for a collection share link (T3620).
 *
 * Mobile-PRIMARY (EPIC #14): recipients open these almost exclusively on phones.
 * Fetches the live, presigned membership from /api/shared/collection/{token} and
 * feeds the presentational CollectionPlayer (the SAME story player used in-app).
 * State machine mirrors SharedVideoOverlay: 403 -> forbidden, 410 -> revoked.
 */
export function SharedCollectionView({ token }) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [copied, setCopied] = useState(false);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleClose = useCallback(() => { window.location.assign('/'); }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchCollection() {
      try {
        const resp = await apiFetch(`${API_BASE}/api/shared/collection/${token}`);
        if (cancelled) return;
        if (resp.ok) {
          const body = await resp.json();
          // Warm the first member so playback starts fast.
          if (body.members?.[0]?.presigned_url) {
            fetch(body.members[0].presigned_url, { headers: { Range: 'bytes=0-524287' } }).catch(() => {});
          }
          setData(body);
          setState(body.members?.length ? 'ready' : 'empty');
        } else if (resp.status === 403) {
          setState('forbidden');
          setErrorMessage('This collection is restricted. Sign in with the email it was shared to.');
        } else if (resp.status === 410) {
          setState('revoked');
          setErrorMessage('This share link is no longer active.');
        } else {
          setState('not_found');
          setErrorMessage('Share link not found.');
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setErrorMessage('Could not load this collection. Please try again.');
        }
      }
    }
    fetchCollection();
    return () => { cancelled = true; };
  }, [token, isAuthenticated]);

  const handleReshare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: data?.title || 'Highlights', url });
        return;
      } catch {
        // fall through to clipboard (user cancelled or unsupported)
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [data]);

  const handleSignIn = () => useAuthStore.getState().requireAuth(() => {});

  if (state === 'loading') {
    return (
      <ViewerShell>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader size={32} className="text-cyan-400 animate-spin" />
          <p className="text-gray-400">Loading highlights...</p>
        </div>
      </ViewerShell>
    );
  }

  if (state === 'ready' && data) {
    const reels = data.members.map((m) => ({
      id: m.id,
      name: m.name,
      streamUrl: m.presigned_url,
      aspect_ratio: data.aspect_ratio,
      duration: m.duration,
    }));
    return (
      <>
        <CollectionPlayer reels={reels} title={data.title} onClose={handleClose} />
        <button
          onClick={handleReshare}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-4 py-2 bg-gray-800/90 backdrop-blur rounded-full text-sm text-gray-200 hover:text-white hover:bg-gray-700/90 transition-colors"
        >
          {copied ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
          {copied ? 'Link copied' : 'Share'}
        </button>
      </>
    );
  }

  if (state === 'empty' && data) {
    return (
      <ViewerShell>
        <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
          <FolderOpen size={48} className="text-gray-500" />
          <p className="text-white text-lg">{data.title}</p>
          <p className="text-gray-400">No highlights yet — check back soon.</p>
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </div>
      </ViewerShell>
    );
  }

  return (
    <ViewerShell>
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        {state === 'forbidden'
          ? <Lock size={48} className="text-gray-500" />
          : <AlertCircle size={48} className="text-gray-500" />}
        <p className="text-gray-300 text-lg">{errorMessage}</p>
        <div className="flex gap-3">
          {state === 'forbidden' && !isAuthenticated && (
            <Button variant="primary" onClick={handleSignIn}>Sign In</Button>
          )}
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </div>
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

export default SharedCollectionView;
