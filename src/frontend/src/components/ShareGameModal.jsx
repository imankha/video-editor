import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Loader, Link2, Check, ChevronDown, ChevronUp,
  Globe, Lock, AlertTriangle, Star,
} from 'lucide-react';
import { Button } from './shared/Button';
import { UserPicker } from './shared/UserPicker';
import { toast } from './shared/Toast';
import {
  RATING_ADJECTIVES, RATING_BADGE_COLORS, RATING_BACKGROUND_COLORS,
} from './shared/clipConstants';
import {
  SHARE_CLIP_SCOPE,
  SHARE_CLIP_SCOPE_LABEL,
  SHARE_CLIP_SCOPE_OPTIONS,
  DEFAULT_SHARE_CLIP_SCOPE,
} from '../constants/shareClipScope';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

// Public link lifecycle within this modal session. Starts UNKNOWN (we don't
// hydrate prior state on open — see Phase B note), becomes ACTIVE on copy/create
// and REVOKED after a confirmed revoke, which drives the General access UI.
const LINK_STATUS = { UNKNOWN: 'unknown', ACTIVE: 'active', REVOKED: 'revoked' };

function fmtTimestamp(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Which clip list the recipient receives for the currently-selected scope.
// Returns null when the preview isn't known yet (loading / failed) so callers
// can show "unknown" rather than a misleading 0.
function clipsForScope(preview, scope) {
  if (!preview || preview.loading || preview.error) return null;
  if (scope === SHARE_CLIP_SCOPE.ALL_TEAM) return preview.all_team || [];
  if (scope === SHARE_CLIP_SCOPE.TAGGED_ONLY) return preview.tagged || [];
  return []; // GAME_ONLY — game/recap only, zero clips
}

function ClipPreviewList({ clips }) {
  return (
    <div className="ml-4 mt-1 mb-2 border-l border-gray-700 pl-3 space-y-1 max-h-40 overflow-y-auto">
      {clips.map((c) => (
        <div key={c.id} className="flex items-center gap-2 py-1 text-sm">
          <span className="flex-1 min-w-0 truncate text-gray-300">
            {c.name || `Clip @ ${fmtTimestamp(c.start_time)}`}
          </span>
          {c.rating != null && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold shrink-0"
              style={{
                color: RATING_BADGE_COLORS[c.rating],
                backgroundColor: RATING_BACKGROUND_COLORS[c.rating],
                borderColor: `${RATING_BADGE_COLORS[c.rating]}4D`,
              }}
              title={RATING_ADJECTIVES[c.rating]}
            >
              <Star size={10} />{RATING_ADJECTIVES[c.rating]}
            </span>
          )}
          <span className="shrink-0 text-xs text-gray-500 tabular-nums">
            {fmtTimestamp(c.start_time)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RecipientRow({
  email, scope, preview, expanded,
  onScopeChange, onToggleExpand, onRemove,
}) {
  const clips = clipsForScope(preview, scope);
  const loading = preview?.loading;
  const count = clips == null ? null : clips.length;
  const isUntagged = scope === SHARE_CLIP_SCOPE.TAGGED_ONLY && count === 0;
  const canExpand = count != null && count > 0;

  return (
    <div className="px-2 py-2 rounded-lg hover:bg-gray-700/40">
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
        {/* identity */}
        <div className="flex items-center gap-2 min-w-0 sm:flex-1">
          <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" aria-hidden />
          <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{email}</span>
        </div>
        {/* controls */}
        <div className="flex items-center gap-2 pl-4 sm:pl-0">
          <select
            aria-label={`Clips for ${email}`}
            value={scope}
            onChange={(e) => onScopeChange(email, e.target.value)}
            className={`shrink-0 rounded-lg bg-gray-700 border text-sm text-gray-200 px-2.5 py-1.5
                        focus:outline-none focus:ring-2 focus:ring-cyan-400 coarse-pointer:min-h-11
                        ${isUntagged ? 'border-amber-500/60' : 'border-gray-600'}`}
          >
            {SHARE_CLIP_SCOPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{SHARE_CLIP_SCOPE_LABEL[opt]}</option>
            ))}
          </select>

          <span className="shrink-0 text-xs text-gray-400 tabular-nums w-14 text-right">
            {loading ? '…' : count == null ? '—' : `${count} clip${count === 1 ? '' : 's'}`}
          </span>

          {canExpand ? (
            <button
              type="button"
              onClick={() => onToggleExpand(email)}
              aria-label={expanded ? 'Hide clips' : 'Show clips'}
              className="shrink-0 p-1 text-gray-500 hover:text-white rounded coarse-pointer:min-h-11 coarse-pointer:min-w-11"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          ) : (
            <span className="shrink-0 w-6" aria-hidden />
          )}

          <button
            type="button"
            onClick={() => onRemove(email)}
            aria-label={`Remove ${email}`}
            className="shrink-0 p-1 text-gray-500 hover:text-white rounded coarse-pointer:min-h-11 coarse-pointer:min-w-11"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* untagged / zero-clips warning — visible BEFORE send, inline on the row */}
      {isUntagged && (
        <div className="mt-1 ml-4 flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            0 clips — <strong>{email}</strong> will receive the game only. Switch to
            {' '}&ldquo;All team clips&rdquo; to include highlights.
          </span>
        </div>
      )}

      {/* expandable clip preview */}
      {expanded && canExpand && <ClipPreviewList clips={clips} />}
    </div>
  );
}

function RevokeConfirmDialog({ busy, onKeep, onConfirm }) {
  return (
    // Backdrop is INERT — no onClick (project rule: no modal closes on backdrop
    // click). Escape (handled by the parent) or the buttons dismiss it.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-sm mx-4 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-white">Revoke this game link?</h3>
            <p className="text-sm text-gray-400 mt-1">
              Anyone you&rsquo;ve already shared the link with will lose access. People you
              added above keep their access. You can create a new link later, but it will be
              a different URL.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onKeep}>Keep link</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? (
              <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Revoking…</span>
            ) : 'Revoke link'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ShareGameModal({ gameId, gameName, onClose }) {
  const [emails, setEmails] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // per-recipient state, keyed by email
  const [scopeByEmail, setScopeByEmail] = useState({});
  const [previewByEmail, setPreviewByEmail] = useState({});
  const [expandedEmails, setExpandedEmails] = useState(() => new Set());
  // T5720: public game link ("here's the game" broadcast link)
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkStatus, setLinkStatus] = useState(LINK_STATUS.UNKNOWN);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Fetch the per-scope clip preview for one recipient. A READ triggered by the
  // ADD gesture (below), never a reactive state-watcher — the preview list must
  // agree with what the share sends (same backend resolver).
  const fetchPreview = useCallback(async (email) => {
    setPreviewByEmail((prev) => ({ ...prev, [email]: { loading: true } }));
    try {
      const resp = await apiFetch(
        `${API_BASE}/api/games/${gameId}/share-preview?email=${encodeURIComponent(email)}`,
      );
      if (!resp.ok) throw new Error(`preview ${resp.status}`);
      const data = await resp.json();
      setPreviewByEmail((prev) => ({ ...prev, [email]: data }));
    } catch {
      setPreviewByEmail((prev) => ({ ...prev, [email]: { error: true } }));
    }
  }, [gameId]);

  // UserPicker add/remove gesture: diff the list, default new recipients to
  // "All team clips", fetch their preview, and clean up removed ones.
  const handleEmailsChange = useCallback((next) => {
    const added = next.filter((e) => !emails.includes(e));
    const removed = emails.filter((e) => !next.includes(e));
    setEmails(next);
    if (added.length) {
      setScopeByEmail((prev) => {
        const out = { ...prev };
        added.forEach((e) => { out[e] = DEFAULT_SHARE_CLIP_SCOPE; });
        return out;
      });
      added.forEach((e) => fetchPreview(e));
    }
    if (removed.length) {
      setScopeByEmail((prev) => {
        const out = { ...prev };
        removed.forEach((e) => delete out[e]);
        return out;
      });
      setPreviewByEmail((prev) => {
        const out = { ...prev };
        removed.forEach((e) => delete out[e]);
        return out;
      });
      setExpandedEmails((prev) => {
        const out = new Set(prev);
        removed.forEach((e) => out.delete(e));
        return out;
      });
    }
  }, [emails, fetchPreview]);

  const handleScopeChange = useCallback((email, scope) => {
    setScopeByEmail((prev) => ({ ...prev, [email]: scope }));
  }, []);

  const handleRemove = useCallback((email) => {
    handleEmailsChange(emails.filter((e) => e !== email));
  }, [emails, handleEmailsChange]);

  const toggleExpand = useCallback((email) => {
    setExpandedEmails((prev) => {
      const out = new Set(prev);
      if (out.has(email)) out.delete(email); else out.add(email);
      return out;
    });
  }, []);

  // T5720: create-or-copy the public game link. The backend stitches the team
  // recap + warms the poster before returning (idempotent per game), and refuses
  // a zero-team-clip game with an actionable 409.
  const handleCopyLink = useCallback(async () => {
    setLinkBusy(true);
    try {
      const resp = await apiFetch(`${API_BASE}/api/games/${gameId}/share-link`, {
        method: 'POST',
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        const msg = data?.detail?.message || data?.detail || `Failed to create link (${resp.status})`;
        toast.error(msg);
        return;
      }
      const data = await resp.json();
      const url = `${window.location.origin}${data.path}`;
      setLinkStatus(LINK_STATUS.ACTIVE);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success('Game link copied — drop it in the team chat');
      } catch {
        toast.success(url);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to create link');
    } finally {
      setLinkBusy(false);
    }
  }, [gameId]);

  const handleConfirmRevoke = useCallback(async () => {
    setLinkBusy(true);
    try {
      const resp = await apiFetch(`${API_BASE}/api/games/${gameId}/share-link`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        setLinkStatus(LINK_STATUS.REVOKED);
        setConfirmRevoke(false);
        toast.success('Game link revoked');
      } else if (resp.status === 404) {
        setLinkStatus(LINK_STATUS.REVOKED);
        setConfirmRevoke(false);
        toast.error('No active link for this game');
      } else {
        toast.error(`Failed to revoke (${resp.status})`);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to revoke link');
    } finally {
      setLinkBusy(false);
    }
  }, [gameId]);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/gallery/contacts`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setContacts(data.contacts); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // Escape closes the revoke confirmation FIRST (only that), never the whole
      // share modal out from under an open confirmation.
      if (confirmRevoke) setConfirmRevoke(false);
      else onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, confirmRevoke]);

  const canSubmit = emails.length > 0 && !isSubmitting;

  // Recipients set to "Only clips they're tagged in" whose resolved tagged set is
  // empty — surfaced in a send-time banner so a zero-clip send is never silent.
  const untaggedCount = emails.filter((e) => {
    const scope = scopeByEmail[e] || DEFAULT_SHARE_CLIP_SCOPE;
    if (scope !== SHARE_CLIP_SCOPE.TAGGED_ONLY) return false;
    const clips = clipsForScope(previewByEmail[e], SHARE_CLIP_SCOPE.TAGGED_ONLY);
    return clips != null && clips.length === 0;
  }).length;

  const handleSubmit = async () => {
    if (emails.length === 0) return;
    setIsSubmitting(true);
    try {
      const recipients = emails.map((email) => ({
        email,
        scope: scopeByEmail[email] || DEFAULT_SHARE_CLIP_SCOPE,
      }));
      const resp = await apiFetch(`${API_BASE}/api/games/${gameId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail || `Failed to share (${resp.status})`);
      }
      const data = await resp.json();
      if (data.all_sent) {
        toast.success(`Game shared with ${emails.length} recipient${emails.length !== 1 ? 's' : ''}`);
        onClose();
      } else {
        const failed = data.results.filter((r) => !r.sent).map((r) => r.email);
        toast.error(`Failed to send to: ${failed.join(', ')}`);
        console.warn('[ShareGame] Partial failure:', data.results);
      }
    } catch (err) {
      toast.error(err.message);
      console.warn('[ShareGame] Error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white truncate pr-4">
            Share: {gameName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Add people */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1.5">Add people</label>
          <UserPicker
            emails={emails}
            onChange={handleEmailsChange}
            contacts={contacts}
            placeholder="Enter email addresses..."
          />
        </div>

        {/* People with access — per-recipient clip scope */}
        {emails.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1.5">People with access</label>
            <div className="max-h-[40vh] sm:max-h-64 overflow-y-auto rounded-lg border border-gray-700 divide-y divide-gray-700/60">
              {emails.map((email) => (
                <RecipientRow
                  key={email}
                  email={email}
                  scope={scopeByEmail[email] || DEFAULT_SHARE_CLIP_SCOPE}
                  preview={previewByEmail[email]}
                  expanded={expandedEmails.has(email)}
                  onScopeChange={handleScopeChange}
                  onToggleExpand={toggleExpand}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </div>
        )}

        {/* General access — the public "here's the game" link (team recap only) */}
        <div className="mb-4 pt-4 border-t border-gray-700">
          <label className="block text-sm text-gray-400 mb-1.5">General access</label>
          {linkStatus === LINK_STATUS.REVOKED ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Lock size={16} className="shrink-0" />
              <span className="flex-1">Link revoked — no one can watch via a link.</span>
              <Button variant="ghost" size="sm" onClick={handleCopyLink} disabled={linkBusy}>
                Create new link
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 mb-2">
                <Globe size={16} className="mt-0.5 text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200">Anyone with the link</p>
                  <p className="text-xs text-gray-500">Watches the team recap — no account needed.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="cyan" onClick={handleCopyLink} disabled={linkBusy}>
                  {linkBusy ? (
                    <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Working...</span>
                  ) : copied ? (
                    <span className="flex items-center gap-2"><Check size={14} />Copied</span>
                  ) : (
                    <span className="flex items-center gap-2"><Link2 size={14} />Copy link</span>
                  )}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmRevoke(true)} disabled={linkBusy}>
                  Revoke link
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Send-time zero-clips banner — unmissable even if a row scrolled off */}
        {untaggedCount > 0 && (
          <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/50">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-200">
              {untaggedCount === 1 ? '1 person' : `${untaggedCount} people`} set to
              {' '}&ldquo;Only clips they&rsquo;re tagged in&rdquo; will receive
              {' '}<strong>0 clips</strong> (no tag match). Send anyway?
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="cyan" onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader size={14} className="animate-spin" />
                Sharing...
              </span>
            ) : (
              `Share with ${emails.length}`
            )}
          </Button>
        </div>
      </div>

      {confirmRevoke && (
        <RevokeConfirmDialog
          busy={linkBusy}
          onKeep={() => setConfirmRevoke(false)}
          onConfirm={handleConfirmRevoke}
        />
      )}
    </div>
  );
}
