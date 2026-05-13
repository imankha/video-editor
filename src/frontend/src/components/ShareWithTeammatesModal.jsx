import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Share2, Loader, Check, AlertCircle } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';

export function ShareWithTeammatesModal({ tagCounts, gameId, onClose, onShareSuccess }) {
  const [checkedTags, setCheckedTags] = useState(() => new Set(Object.keys(tagCounts)));
  const [tagEmails, setTagEmails] = useState({});
  const [storedMappings, setStoredMappings] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchMappings() {
      try {
        const resp = await fetch(`${API_BASE}/api/clips/teammate-emails`, {
          credentials: 'include',
        });
        if (!resp.ok) throw new Error('Failed to load email mappings');
        const data = await resp.json();
        if (cancelled) return;
        setStoredMappings(data);
        const prefilled = {};
        for (const tag of Object.keys(tagCounts)) {
          const stored = data[tag];
          prefilled[tag] = stored ? stored.map(m => m.email) : [];
        }
        setTagEmails(prefilled);
      } catch {
        if (!cancelled) {
          setTagEmails(
            Object.fromEntries(Object.keys(tagCounts).map(t => [t, []]))
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchMappings();
    return () => { cancelled = true; };
  }, [tagCounts]);

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

  const handleToggleTag = useCallback((tag) => {
    setCheckedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const handleEmailsChange = useCallback((tag, emails) => {
    setTagEmails(prev => ({ ...prev, [tag]: emails }));
    setError(null);
    setSuccess(false);
  }, []);

  const shareableRecipients = useMemo(() => {
    return Object.keys(tagCounts)
      .filter(tag => checkedTags.has(tag) && tagEmails[tag]?.length > 0)
      .map(tag => ({ tag_name: tag, emails: tagEmails[tag] }));
  }, [tagCounts, checkedTags, tagEmails]);

  const totalClips = useMemo(() => {
    let count = 0;
    for (const tag of Object.keys(tagCounts)) {
      if (checkedTags.has(tag) && tagEmails[tag]?.length > 0) {
        count += tagCounts[tag];
      }
    }
    return count;
  }, [tagCounts, checkedTags, tagEmails]);

  const canSubmit = shareableRecipients.length > 0 && !isSubmitting && !success;

  const handleShare = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const newMappings = [];
      for (const { tag_name, emails } of shareableRecipients) {
        const storedEmails = new Set(
          (storedMappings[tag_name] || []).map(m => m.email)
        );
        for (const email of emails) {
          if (!storedEmails.has(email)) {
            newMappings.push({ tag_name, email });
          }
        }
      }

      if (newMappings.length > 0) {
        const saveResp = await fetch(`${API_BASE}/api/clips/teammate-emails`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newMappings),
        });
        if (!saveResp.ok) {
          throw new Error('Failed to save email mappings');
        }
      }

      const shareResp = await fetch(`${API_BASE}/api/clips/share-with-teammates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: gameId,
          recipients: shareableRecipients,
        }),
      });

      if (shareResp.status === 404) {
        setSuccess(true);
        onShareSuccess?.();
        toast.success(`Sharing queued for ${shareableRecipients.length} player${shareableRecipients.length === 1 ? '' : 's'}`);
      } else if (!shareResp.ok) {
        const data = await shareResp.json().catch(() => null);
        throw new Error(data?.detail || `Share failed (${shareResp.status})`);
      } else {
        setSuccess(true);
        onShareSuccess?.();
        toast.success(`Shared with ${shareableRecipients.length} player${shareableRecipients.length === 1 ? '' : 's'}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedTags = useMemo(() =>
    Object.entries(tagCounts).sort((a, b) => b[1] - a[1]),
  [tagCounts]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 border border-gray-700">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-cyan-400" />
            <h3 className="text-lg font-semibold text-white">
              Share With Teammates
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 -mr-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4 justify-center">
              <Loader size={16} className="animate-spin" />
              Loading email mappings...
            </div>
          ) : (
            sortedTags.map(([tag, clipCount]) => {
              const isChecked = checkedTags.has(tag);
              const emails = tagEmails[tag] || [];
              const storedForTag = (storedMappings[tag] || []).map(m => m.email);

              return (
                <div
                  key={tag}
                  className={`rounded-lg border p-3 transition-colors ${
                    isChecked
                      ? 'border-gray-600 bg-gray-750'
                      : 'border-gray-700/50 bg-gray-800/50 opacity-60'
                  }`}
                >
                  <label className="flex items-center gap-3 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleTag(tag)}
                      className="w-4 h-4 rounded border-gray-500 bg-gray-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-gray-800"
                    />
                    <span className="text-white font-medium">{tag}</span>
                    <span className="text-gray-400 text-sm">
                      ({clipCount} clip{clipCount !== 1 ? 's' : ''})
                    </span>
                  </label>
                  {isChecked && (
                    <div className="ml-7">
                      <UserPicker
                        emails={emails}
                        onChange={(updated) => handleEmailsChange(tag, updated)}
                        contacts={storedForTag}
                        placeholder="Enter email addresses"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2">
              <Check size={16} className="text-green-400" />
              <span className="text-green-400 text-sm font-medium">
                Clips shared successfully
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {success ? 'Done' : 'Cancel'}
          </Button>
          {!success && (
            <Button
              variant="cyan"
              onClick={handleShare}
              disabled={!canSubmit}
              loading={isSubmitting}
            >
              {isSubmitting
                ? 'Sharing...'
                : `Share${totalClips > 0 ? ` (${totalClips} clip${totalClips !== 1 ? 's' : ''})` : ''}`
              }
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
