import React, { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, Loader, Lock, Download, Share2 } from 'lucide-react';
import { MediaPlayer } from './MediaPlayer';
import { BrandedEndCard } from './BrandedEndCard';
import { SharePageInstallBanner } from './SharePageInstallBanner';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { shareInvite } from '../utils/inviteEmail';

export function SharedVideoOverlay({ shareToken, onClose }) {
  const [state, setState] = useState('loading');
  const [share, setShare] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showEndCard, setShowEndCard] = useState(false);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  const handleInviteClick = useCallback(() => shareInvite(), []);

  useEffect(() => {
    let cancelled = false;
    async function fetchShare() {
      try {
        const resp = await apiFetch(`${API_BASE}/api/shared/${shareToken}`);
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
    const handleDownload = async () => {
      try {
        const resp = await fetch(share.video_url);
        if (!resp.ok) return;
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = share.video_name || 'shared-video.mp4';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Cross-origin or network failure — user can retry
      }
    };

    const handleReplay = () => {
      setShowEndCard(false);
    };

    return (
      <Overlay onClose={onClose} title={share.video_name} onDownload={handleDownload}>
        <div className="relative w-full h-full">
          <MediaPlayer
            src={share.video_url}
            autoPlay={!showEndCard}
            onClose={onClose}
            onEnded={() => setShowEndCard(true)}
          />
          <BrandedEndCard visible={showEndCard} onReplay={handleReplay} />
        </div>
        <SharePageInstallBanner />
        {isAuthenticated && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={handleInviteClick}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800/90 backdrop-blur rounded-full text-sm text-gray-200 hover:text-white hover:bg-gray-700/90 transition-colors"
            >
              <Share2 size={16} />
              Invite a Friend to Reel Ballers
            </button>
          </div>
        )}
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

function Overlay({ children, onClose, title, onDownload }) {
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
        className="fixed inset-0 bg-black z-[60]"
        onClick={onClose}
      />
      <div className="fixed inset-0 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-black overflow-hidden md:rounded-xl md:bg-gray-900 md:shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2 md:p-4 border-b border-gray-700 bg-gray-800">
          <h3 className="text-white text-sm md:text-base font-medium truncate">
            {title || 'Shared Video'}
          </h3>
          <div className="flex items-center gap-1">
            {onDownload && (
              <button
                onClick={onDownload}
                className="text-gray-400 hover:text-white transition-colors p-1"
                aria-label="Download video"
              >
                <Download size={20} />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
