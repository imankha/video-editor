import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Share2, Loader, Check, AlertCircle } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';

export function ShareWithTeammatesModal({ tagCounts, tagClipIds, gameId, sharedTagData, onClose, onSharedTagsChange }) {
  const unsentTags = useMemo(() =>
    Object.entries(tagCounts)
      .filter(([tag]) => {
        const sharedIds = sharedTagData[tag];
        if (!sharedIds) return true;
        const currentIds = tagClipIds[tag] || [];
        return currentIds.some(id => !sharedIds.has(id));
      })
      .sort((a, b) => b[1] - a[1]),
  [tagCounts, tagClipIds, sharedTagData]);

  const sentTags = useMemo(() =>
    Object.entries(tagCounts)
      .filter(([tag]) => {
        const sharedIds = sharedTagData[tag];
        if (!sharedIds) return false;
        const currentIds = tagClipIds[tag] || [];
        return currentIds.every(id => sharedIds.has(id));
      })
      .sort((a, b) => b[1] - a[1]),
  [tagCounts, tagClipIds, sharedTagData]);

  const [checkedTags, setCheckedTags] = useState(() =>
    new Set(unsentTags.map(([tag]) => tag))
  );
  const [tagEmails, setTagEmails] = useState({});
  const [storedMappings, setStoredMappings] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
  }, []);

  const shareableRecipients = useMemo(() => {
    return unsentTags
      .filter(([tag]) => checkedTags.has(tag) && tagEmails[tag]?.length > 0)
      .map(([tag]) => ({ tag_name: tag, emails: tagEmails[tag] }));
  }, [unsentTags, checkedTags, tagEmails]);

  const newClipCount = useCallback((tag) => {
    const sharedIds = sharedTagData[tag];
    if (!sharedIds || sharedIds.size === 0) return tagCounts[tag] || 0;
    return (tagClipIds[tag] || []).filter(id => !sharedIds.has(id)).length;
  }, [sharedTagData, tagClipIds, tagCounts]);

  const totalClips = useMemo(() => {
    let count = 0;
    for (const [tag] of unsentTags) {
      if (checkedTags.has(tag) && tagEmails[tag]?.length > 0) {
        count += newClipCount(tag);
      }
    }
    return count;
  }, [unsentTags, checkedTags, tagEmails, newClipCount]);

  const canSubmit = shareableRecipients.length > 0 && !isSubmitting;

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

      if (!shareResp.ok) {
        const data = await shareResp.json().catch(() => null);
        throw new Error(data?.detail || `Share failed (${shareResp.status})`);
      }

      const data = await shareResp.json();

      if (data.sent_tags.length > 0) {
        const updated = { ...sharedTagData };
        for (const tag of data.sent_tags) {
          const currentIds = tagClipIds[tag] || [];
          updated[tag] = new Set([...(updated[tag] || []), ...currentIds]);
        }
        onSharedTagsChange?.(updated);
      }

      if (data.failed_tags.length === 0) {
        toast.success(`Shared with ${data.sent_tags.length} teammate${data.sent_tags.length === 1 ? '' : 's'}`);
        onClose();
      } else if (data.sent_tags.length === 0) {
        setError(`Failed to send emails. Please check the addresses and try again.`);
        setIsSubmitting(false);
      } else {
        toast.success(`Shared with ${data.sent_tags.length} teammate${data.sent_tags.length === 1 ? '' : 's'}`);
        setError(`Failed to email: ${data.failed_tags.join(', ')}`);
        setIsSubmitting(false);
      }
    } catch (err) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

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
            <>
              {/* Unsent tags -- actionable */}
              {unsentTags.length > 0 && (
                <div className="space-y-3">
                  {unsentTags.length > 0 && sentTags.length > 0 && (
                    <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Not yet shared</h4>
                  )}
                  {unsentTags.map(([tag, clipCount]) => {
                    const isChecked = checkedTags.has(tag);
                    const emails = tagEmails[tag] || [];
                    const storedForTag = (storedMappings[tag] || []).map(m => m.email);
                    const nNew = newClipCount(tag);
                    const isResend = nNew < clipCount;

                    return (
                      <div
                        key={tag}
                        className={`rounded-lg border p-3 transition-colors ${
                          isChecked
                            ? 'border-cyan-600/40 bg-gray-750'
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
                            {isResend
                              ? `(${nNew} new clip${nNew !== 1 ? 's' : ''} — ${clipCount} total)`
                              : `(${clipCount} clip${clipCount !== 1 ? 's' : ''})`
                            }
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
                            <p className="text-gray-500 text-xs mt-1">Press Enter after each email</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Already shared tags -- read-only */}
              {sentTags.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Already shared</h4>
                  {sentTags.map(([tag, clipCount]) => {
                    const emails = tagEmails[tag] || [];
                    return (
                      <div
                        key={tag}
                        className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-3 opacity-60"
                      >
                        <div className="flex items-center gap-3">
                          <Check size={16} className="text-green-500 flex-shrink-0" />
                          <span className="text-gray-300 font-medium">{tag}</span>
                          <span className="text-gray-500 text-sm">
                            ({clipCount} clip{clipCount !== 1 ? 's' : ''})
                          </span>
                        </div>
                        {emails.length > 0 && (
                          <div className="ml-7 mt-1 flex flex-wrap gap-1">
                            {emails.map(email => (
                              <span key={email} className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded">
                                {email}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All shared state */}
              {unsentTags.length === 0 && (
                <div className="text-center py-4 text-gray-400 text-sm">
                  All tagged teammates have been shared with
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {unsentTags.length > 0 && (
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
