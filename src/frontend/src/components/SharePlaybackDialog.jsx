import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';

export function SharePlaybackDialog({ gameId, gameName, tags, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTag, setSelectedTag] = useState(tags.length === 1 ? tags[0] : '');

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

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const canSubmit = emails.length > 0 && selectedTag && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/games/${gameId}/share-playback`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, tag_name: selectedTag }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail || `Failed to share (${resp.status})`);
      }
      const data = await resp.json();
      if (data.all_sent) {
        toast.success(`Highlights shared with ${emails.length} recipient${emails.length !== 1 ? 's' : ''}`);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white truncate pr-4">
            Share Highlights: {gameName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {tags.length > 1 && (
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1.5">Select athlete</label>
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose an athlete...</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>
        )}

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
