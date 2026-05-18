import React, { useState, useEffect } from 'react';
import { X, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';

export function SharePlaybackDialog({ gameId, gameName, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/gallery/contacts`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setContacts(data.contacts); })
      .catch(() => {});
  }, []);

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
      const resp = await fetch(`${API_BASE}/api/games/${gameId}/share-playback`, {
        method: 'POST',
        credentials: 'include',
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white truncate pr-4">
            Share Annotations: {gameName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

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
