import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Loader, Lock } from 'lucide-react';
import { MediaPlayer } from './MediaPlayer';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { useAuthStore } from '../stores/authStore';

export function SharedVideoOverlay({ shareToken, onClose }) {
  const [state, setState] = useState('loading');
  const [share, setShare] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    let cancelled = false;
    async function fetchShare() {
      try {
        const resp = await fetch(`${API_BASE}/api/shared/${shareToken}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (resp.ok) {
          const data = await resp.json();
          if (data.video_url) {
            fetch(data.video_url, { headers: { Range: 'bytes=0-524287' } }).catch(() => {});
          }
          setShare(data);
          setState('ready');
        } else if (resp.status === 403) {
          setState('forbidden');
          setErrorMessage('This video is restricted. Sign in with the email it was shared to.');
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
          setErrorMessage('Could not load shared video. Please try again.');
        }
      }
    }
    fetchShare();
    return () => { cancelled = true; };
  }, [shareToken, isAuthenticated]);

  const handleSignIn = () => {
    useAuthStore.getState().requireAuth(() => {});
  };

  if (state === 'loading') {
    return (
      <Overlay onClose={onClose}>
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader size={32} className="text-cyan-400 animate-spin" />
          <p className="text-gray-400">Loading shared video...</p>
        </div>
      </Overlay>
    );
  }

  if (state === 'ready' && share) {
    return (
      <Overlay onClose={onClose} title={share.video_name}>
        <MediaPlayer
          src={share.video_url}
          autoPlay
          onClose={onClose}
        />
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
        {state === 'forbidden' ? (
          <Lock size={48} className="text-gray-500" />
        ) : (
          <AlertCircle size={48} className="text-gray-500" />
        )}
        <p className="text-gray-300 text-lg">{errorMessage}</p>
        <div className="flex gap-3">
          {state === 'forbidden' && !isAuthenticated && (
            <Button variant="primary" onClick={handleSignIn}>
              Sign In
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose, title }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 z-[60]"
        onClick={onClose}
      />
      <div className="fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
          <h3 className="text-white font-medium truncate">
            {title || 'Shared Video'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
