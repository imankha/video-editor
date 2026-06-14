import React, { useState, useEffect } from 'react';
import { X, Share2, Check, Loader, Globe, Lock, Copy } from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

const collectionLink = (token) => `${window.location.origin}/shared/collection/${token}`;

/**
 * CollectionShareModal - share a (scope, filter, ratio[, budget]) collection
 * definition as a LIVE public link or email it to recipients (T3620). Sibling of
 * the per-video ShareModal; it targets /api/collections/share and the
 * /shared/collection/{token} link. Live links always show the current reels, so
 * there is no per-recipient share list to manage here.
 *
 * @param {Object}   definition - the collection definition (scope/filter/aspect_ratio[/budget_sec])
 * @param {string=}  title      - display title for the header
 * @param {Function} onClose
 */
export function CollectionShareModal({ definition, title, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [publicLink, setPublicLink] = useState(null);
  const [creatingPublicLink, setCreatingPublicLink] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/gallery/contacts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setContacts(data.contacts); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createShare = async (recipientEmails, makePublic) => {
    const resp = await apiFetch(`${API_BASE}/api/collections/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition, recipient_emails: recipientEmails, is_public: makePublic }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error(data?.detail || `Failed to share (${resp.status})`);
    }
    return resp.json();
  };

  const handleTogglePublic = async () => {
    if (isPublic) { setIsPublic(false); return; }
    setIsPublic(true);
    if (publicLink) return;
    setCreatingPublicLink(true);
    try {
      const data = await createShare([], true);
      if (data.shares?.length) setPublicLink(collectionLink(data.shares[0].share_token));
    } catch (e) {
      setError(e.message);
      setIsPublic(false);
    } finally {
      setCreatingPublicLink(false);
    }
  };

  const handleCopy = async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
    } catch {
      const input = document.createElement('input');
      input.value = publicLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async () => {
    if (emails.length === 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const data = await createShare(emails, isPublic);
      setDone(true);
      const emailed = data.shares.filter((s) => s.email_sent !== null);
      if (emailed.length) {
        const failed = emailed.filter((s) => s.email_sent === false);
        if (failed.length === 0) toast.success('Shares sent');
        else if (failed.length === emailed.length) toast.error('Failed to send share emails');
        else toast.error(`Failed to email ${failed.map((s) => s.recipient_email).join(', ')}`,
          { message: 'The rest were sent successfully' });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 size={18} className="text-cyan-400 shrink-0" />
            <h3 className="text-lg font-semibold text-white truncate">
              {title ? `Share "${title}"` : 'Share highlights'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 -mr-1">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-xs text-gray-500">
            This link always shows the current reels for this collection.
          </p>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Add people</label>
            <UserPicker
              emails={emails}
              onChange={(updated) => { setEmails(updated); setError(null); }}
              contacts={contacts}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2 text-sm text-gray-300 group-hover:text-white transition-colors">
                {isPublic ? <Globe size={16} className="text-green-400" /> : <Lock size={16} className="text-gray-400" />}
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
                    <button onClick={handleCopy} className="text-gray-400 hover:text-white transition-colors p-1 flex-shrink-0" title="Copy link">
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </>
                ) : (
                  <span className="text-sm text-gray-500">Creating link...</span>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {done && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-3">
              <p className="text-green-400 text-sm font-medium">Collection shared</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{done ? 'Done' : 'Cancel'}</Button>
          {!done && (
            <Button variant="primary" onClick={handleSubmit} disabled={emails.length === 0 || isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Sharing...</span>
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

export default CollectionShareModal;
