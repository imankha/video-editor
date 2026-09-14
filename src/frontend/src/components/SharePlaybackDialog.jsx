import React, { useState, useEffect } from 'react';
import { X, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { Z } from '../constants/zLayers';
import { SHARING } from '../config/displayNames';

export function SharePlaybackDialog({ gameId, gameName, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactsFailed, setContactsFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // T9810: the dialog cannot POST invitations without a game context. Missing
  // gameId is an internal wiring bug, not a valid state — fail VISIBLY with an
  // actionable message instead of firing at /api/games/null/share-playback.
  const canOpen = gameId != null;

  useEffect(() => {
    if (!canOpen) return undefined;
    let cancelled = false;
    apiFetch(`${API_BASE}/api/gallery/contacts`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (data) setContacts(data.contacts);
        else setContactsFailed(true);
      })
      // T9810: contacts are an external autocomplete convenience (not required to
      // send an invitation), so a failure is non-blocking — but never swallowed
      // silently: surface a small note so the user knows suggestions are missing.
      .catch(() => { if (!cancelled) setContactsFailed(true); });
    return () => { cancelled = true; };
  }, [canOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const canSubmit = emails.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const resp = await apiFetch(`${API_BASE}/api/games/${gameId}/share-playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail || `Failed to share (${resp.status})`);
      }
      const data = await resp.json();
      if (data.all_sent) {
        toast.success(`Annotations shared with ${emails.length} recipient${emails.length !== 1 ? 's' : ''}`);
        onClose();
      } else {
        const failed = data.results.filter(r => !r.sent).map(r => r.email);
        toast.error(`Failed to send to: ${failed.join(', ')}`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // T9810: open-failure state — an actionable error instead of a broken form,
  // satisfying "one click opens the same game form OR an actionable error".
  if (!canOpen) {
    return (
      <div className={`fixed inset-0 ${Z.SHARE} flex items-center justify-center bg-black/60 backdrop-blur-sm`}>
        <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md mx-4 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white truncate pr-4">
              {SHARING.SHARE_PLAYS}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-300 mb-4">{SHARING.OPEN_ERROR}</p>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 ${Z.SHARE} flex items-center justify-center bg-black/60 backdrop-blur-sm`}>
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white truncate pr-4">
            {SHARING.SHARE_PLAYS}: {gameName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* T9810: honest permission-scope disclosure. Verified server-side against
            share-playback -> _copy_game + _materialize_clips: recipients get the full
            game recording plus every marked play. */}
        <p className="text-sm text-gray-400 mb-4">{SHARING.SCOPE_DISCLOSURE}</p>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1.5">Add people</label>
          <UserPicker
            emails={emails}
            onChange={setEmails}
            contacts={contacts}
            placeholder="Enter email addresses..."
          />
          {emails.length === 0 && (
            <p className="text-xs text-gray-500 mt-1">Type an email and press Enter to add</p>
          )}
          {contactsFailed && (
            <p className="text-xs text-amber-400/80 mt-1">
              {"Couldn't load your contacts — you can still type email addresses."}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="cyan"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader size={14} className="animate-spin" />
                Sharing...
              </span>
            ) : (
              'Share'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
