import React, { useState, useEffect, useCallback } from 'react';
import { X, Share2, Link, Check, Loader, Globe, Lock, Trash2, Copy } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';

export function ShareModal({ videoId, videoName, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successShares, setSuccessShares] = useState(null);
  const [existingShares, setExistingShares] = useState(null);
  const [loadingShares, setLoadingShares] = useState(true);
  const [copiedToken, setCopiedToken] = useState(null);
  const [publicLink, setPublicLink] = useState(null);
  const [creatingPublicLink, setCreatingPublicLink] = useState(false);

  const fetchExistingShares = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/gallery/${videoId}/shares`, {
        credentials: 'include',
      });
      if (resp.ok) {
        setExistingShares(await resp.json());
      }
    } catch {
      // Non-critical — modal still works without the list
    } finally {
      setLoadingShares(false);
    }
  }, [videoId]);

  useEffect(() => {
    fetchExistingShares();
    fetch(`${API_BASE}/api/gallery/contacts`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setContacts(data.contacts); })
      .catch(() => {});
  }, [fetchExistingShares]);

  useEffect(() => {
    if (!existingShares) return;
    const activePublic = existingShares.find(s => s.is_public && !s.revoked_at);
    if (activePublic) {
      setPublicLink(`${window.location.origin}/shared/${activePublic.share_token}`);
      setIsPublic(true);
    }
  }, [existingShares]);

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

  const handleTogglePublic = async () => {
    if (isPublic) {
      setIsPublic(false);
      if (publicLink) {
        const token = publicLink.split('/shared/')[1];
        if (token) handleRevoke(token);
        setPublicLink(null);
      }
      return;
    }
    setIsPublic(true);
    if (publicLink) return;
    setCreatingPublicLink(true);
    try {
      const resp = await fetch(`${API_BASE}/api/gallery/${videoId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_emails: [], is_public: true }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.shares.length > 0) {
          setPublicLink(`${window.location.origin}/shared/${data.shares[0].share_token}`);
        }
        fetchExistingShares();
      }
    } catch {
      // Non-critical
    } finally {
      setCreatingPublicLink(false);
    }
  };

  const canSubmit = emails.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (emails.length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/gallery/${videoId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_emails: emails, is_public: isPublic }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail || `Failed to share (${resp.status})`);
      }
      const data = await resp.json();
      setSuccessShares(data.shares);
      setEmails([]);
      fetchExistingShares();

      const emailed = data.shares.filter((s) => s.email_sent !== null);
      if (emailed.length > 0) {
        const failed = emailed.filter((s) => s.email_sent === false);
        if (failed.length === 0) {
          toast.success('Shares sent');
        } else if (failed.length === emailed.length) {
          toast.error('Failed to send share emails');
        } else {
          const failedNames = failed.map((s) => s.recipient_email).join(', ');
          toast.error(`Failed to email ${failedNames}`, {
            message: 'The rest were sent successfully',
          });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (shareToken) => {
    try {
      const resp = await fetch(`${API_BASE}/api/shared/${shareToken}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (resp.ok) {
        fetchExistingShares();
      }
    } catch {
      // Silent — list will refresh on next open
    }
  };

  const handleCopyLink = async (shareToken) => {
    const url = `${window.location.origin}/shared/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(shareToken);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedToken(shareToken);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  };

  const activeShares = existingShares?.filter(s => !s.revoked_at) || [];
  const activeEmails = new Set(activeShares.map(s => s.recipient_email.toLowerCase()));
  const filteredContacts = contacts.filter(c => !activeEmails.has(c.toLowerCase()));

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
              Share "{videoName}"
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
        <div className="px-6 py-4 space-y-4">
          {/* Email input */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Add people
            </label>
            <UserPicker
              emails={emails}
              onChange={(updated) => { setEmails(updated); setError(null); setSuccessShares(null); }}
              contacts={filteredContacts}
            />
          </div>

          {/* Visibility toggle */}
          <div className="space-y-2">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2 text-sm text-gray-300 group-hover:text-white transition-colors">
                {isPublic ? (
                  <Globe size={16} className="text-green-400" />
                ) : (
                  <Lock size={16} className="text-gray-400" />
                )}
                <span>{isPublic ? 'Anyone with the link' : 'Restricted to recipients'}</span>
              </div>
              <div
                role="switch"
                aria-checked={isPublic}
                onClick={handleTogglePublic}
                className={`relative w-9 h-5 rounded-full transition-colors ${isPublic ? 'bg-green-500' : 'bg-gray-600'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isPublic ? 'translate-x-4' : ''}`} />
              </div>
            </label>
            {isPublic && (
              <div className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
                {creatingPublicLink ? (
                  <Loader size={14} className="text-gray-400 animate-spin" />
                ) : publicLink ? (
                  <>
                    <input
                      type="text"
                      readOnly
                      value={publicLink}
                      className="flex-1 bg-transparent text-sm text-gray-300 outline-none truncate"
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      onClick={() => handleCopyLink(publicLink.split('/shared/')[1])}
                      className="text-gray-400 hover:text-white transition-colors p-1 flex-shrink-0"
                      title="Copy link"
                    >
                      {copiedToken === publicLink.split('/shared/')[1] ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </>
                ) : (
                  <span className="text-sm text-gray-500">Creating link...</span>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          {/* Success */}
          {successShares && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-3">
              <p className="text-green-400 text-sm font-medium">
                Shared with {successShares.length} {successShares.length === 1 ? 'person' : 'people'}
              </p>
              <div className="mt-2 space-y-1">
                {successShares.map((s) => (
                  <div key={s.share_token} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">
                      {s.recipient_email}
                      {!s.is_existing_user && (
                        <span className="text-yellow-500 ml-1" title="Not yet a user">(invite)</span>
                      )}
                    </span>
                    <button
                      onClick={() => handleCopyLink(s.share_token)}
                      className="text-gray-400 hover:text-white transition-colors p-1"
                      title="Copy share link"
                    >
                      {copiedToken === s.share_token ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Link size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* People with access */}
          {activeShares.length > 0 && (
            <div>
              <h4 className="text-sm text-gray-400 mb-2">People with access</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {activeShares.map((share) => (
                  <div key={share.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-700/50 group">
                    <div className="flex items-center gap-2 min-w-0">
                      {share.is_public ? (
                        <Globe size={14} className="text-green-400 flex-shrink-0" />
                      ) : (
                        <Lock size={14} className="text-gray-500 flex-shrink-0" />
                      )}
                      <span className="text-sm text-gray-300 truncate">{share.recipient_email}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleCopyLink(share.share_token)}
                        className="text-gray-500 hover:text-white transition-colors p-1 opacity-0 group-hover:opacity-100"
                        title="Copy share link"
                      >
                        {copiedToken === share.share_token ? (
                          <Check size={14} className="text-green-400" />
                        ) : (
                          <Link size={14} />
                        )}
                      </button>
                      <button
                        onClick={() => handleRevoke(share.share_token)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"
                        title="Revoke access"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingShares && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader size={14} className="animate-spin" />
              Loading shares...
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {successShares ? 'Done' : 'Cancel'}
          </Button>
          {!successShares && (
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={emails.length === 0 || isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader size={14} className="animate-spin" />
                  Sharing...
                </span>
              ) : (
                `Share${emails.length > 0 ? ` (${emails.length})` : ''}`
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
