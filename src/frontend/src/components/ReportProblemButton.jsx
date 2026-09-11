import { useState, useRef, useEffect } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { API_BASE, ENABLE_PROBLEM_REPORT } from '../config';
import apiFetch from '../utils/apiFetch';
import { useAuthStore } from '../stores/authStore';
import { getClientLogs, clearClientLogs } from '../utils/clientLogger';
import { getActionLog } from '../utils/analytics';
import { getEditorContext } from '../utils/editorContext';

/**
 * Capture a full-page screenshot as a base64 JPEG via html2canvas.
 * Sent silently with the report (not shown to user).
 * Returns a Promise<string|null>.
 */
function captureVideoFrames() {
  const frames = new Map();
  document.querySelectorAll('video').forEach((video) => {
    if (!video.videoWidth) return;
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = c.toDataURL('image/jpeg', 0.8);
      frames.set(video, dataUrl);
    } catch (err) {
      console.warn('[ReportProblem] Video frame capture failed:', video.src?.substring(0, 80), err?.message);
    }
  });
  return frames;
}

async function captureScreenshot() {
  try {
    const videoFrames = captureVideoFrames();
    const mod = await import('html2canvas');
    const html2canvas = mod.default || mod;
    const originalVideos = [...document.querySelectorAll('video')];
    const canvas = await html2canvas(document.body, {
      scale: 1.0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      useCORS: true,
      logging: false,
      backgroundColor: '#111827',
      onclone: (_doc, clonedBody) => {
        // The report modal itself may already be open in the live DOM by the
        // time this clone runs (capture is fired in parallel with opening the
        // modal, not before it) -- strip it from the clone so it never shows
        // up in its own screenshot.
        clonedBody.querySelectorAll('[data-report-modal]').forEach((el) => el.remove());
        const clonedVideos = clonedBody.querySelectorAll('video');
        clonedVideos.forEach((clonedVideo, i) => {
          const dataUrl = videoFrames.get(originalVideos[i]);
          if (!dataUrl) return;
          const img = _doc.createElement('img');
          img.src = dataUrl;
          img.style.cssText = clonedVideo.style.cssText;
          img.className = clonedVideo.className;
          img.style.objectFit = 'contain';
          clonedVideo.replaceWith(img);
        });
      },
    });
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (err) {
    console.warn('[ReportProblem] Screenshot capture failed:', err?.message || err);
    return null;
  }
}

/**
 * ReportProblemButton -- opens a small modal for the user to describe
 * their problem. Auto-captures a screenshot and console logs, sends
 * everything to admins silently.
 *
 * T1650: Gated by VITE_ENABLE_PROBLEM_REPORT env var (default: enabled).
 *
 * T5674: `compact` renders an icon-only trigger (with an accessible label) instead
 * of the "Report a problem" text. The floating global mount uses it on editor
 * screens so the trigger tucks into the safe corner as a small square instead of a
 * 134px pill sprawling across the video's lower-right, where it read as colliding
 * with the player controls. Presentational only — the modal/report flow is unchanged.
 */
/**
 * T9400: scrub credentials/session tokens out of any text that goes to the
 * clipboard via "Copy error details". This is a conservative, over-scrubbing
 * pass -- it errs toward redacting too much, since the blob is shared by hand.
 */
const _SECRET_KEYS =
  'rb_session|set[-_]?cookie|cookie|session[-_]?id|sessionid|session|token|password|passwd|secret|' +
  'api[-_]?key|access[-_]?token|id[-_]?token|refresh[-_]?token|authorization|auth|code|state';

function scrubSecrets(text) {
  if (!text) return text;
  let out = String(text);
  // "Bearer <jwt>" / "Basic <creds>" -- redact the VALUE after the scheme word,
  // not just the word (the token, including its dots, is the secret).
  out = out.replace(/\b(bearer|basic)\s+[\w.\-+/=]+/gi, '$1 [redacted]');
  // key=value / key: value / "key": "value" (JSON) where the key looks
  // credential-ish. The optional quote after the key (`"?`) catches JSON-quoted
  // keys like "access_token": "..."; the value stops at whitespace/quote/delim.
  const KV = new RegExp(`\\b(${_SECRET_KEYS})\\b"?(\\s*[=:]\\s*)("?)([^\\s"&,;]+)\\3`, 'gi');
  out = out.replace(KV, (_m, key, sep) => `${key}${sep}[redacted]`);
  return out;
}

/** Strip sensitive query params / fragments from a URL for safe sharing. */
function scrubUrl(url) {
  if (!url) return url;
  const SENSITIVE = new Set([
    'code', 'state', 'token', 'id_token', 'access_token', 'refresh_token', 'session',
    'session_id', 'sessionid', 'api_key', 'apikey', 'password', 'secret', 'auth', 'authorization',
  ]);
  try {
    const u = new URL(url);
    let changed = false;
    SENSITIVE.forEach((k) => {
      if (u.searchParams.has(k)) { u.searchParams.set(k, '[redacted]'); changed = true; }
    });
    if (u.hash && /(?:token|code|state|id_token|access_token)/i.test(u.hash)) {
      u.hash = '#[redacted]';
      changed = true;
    }
    return changed ? u.toString() : url;
  } catch {
    // Not a parseable URL -- fall back to the key=value scrub.
    return scrubSecrets(url);
  }
}

export function ReportProblemButton({ className = '', compact = false }) {
  const email = useAuthStore((s) => s.email);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [errorInfo, setErrorInfo] = useState(null); // { kind: 'network'|'http', status?, message }
  const [showDetails, setShowDetails] = useState(false);
  const [dropScreenshot, setDropScreenshot] = useState(false);
  const [copied, setCopied] = useState(false);
  const screenshotRef = useRef(null);
  const textareaRef = useRef(null);
  // T9400: a client-generated idempotency key, stable across retries of the SAME
  // composed report so a successful retry after an ambiguous failure files
  // exactly one row (backend dedups via INSERT ... ON CONFLICT). Regenerated only
  // when a genuinely new report is opened.
  const clientReportIdRef = useRef(null);

  // Focus textarea when modal opens. Declared here (before the early return
  // below) so the hook runs unconditionally per rules-of-hooks.
  useEffect(() => {
    if (open && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!ENABLE_PROBLEM_REPORT) return null;

  // T7560 follow-up: html2canvas is slow enough (full-page render) that
  // awaiting it before opening the modal made every click feel laggy. Open
  // the modal immediately and capture in parallel instead -- the modal is
  // excluded from the actual screenshot via the onclone hook above (it
  // strips any `[data-report-modal]` element from the clone), so there's no
  // ordering requirement between "modal visible" and "capture started"
  // anymore. If Send is clicked before the capture resolves, the report
  // just goes out without a screenshot -- same graceful degradation as a
  // capture failure, already handled below.
  const handleOpen = () => {
    setDescription('');
    setState('idle');
    setErrorInfo(null);
    setShowDetails(false);
    setDropScreenshot(false);
    setCopied(false);
    setOpen(true);
    screenshotRef.current = null;
    clientReportIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    captureScreenshot().then((shot) => { screenshotRef.current = shot; });
  };

  const handleClose = () => {
    setOpen(false);
    setDescription('');
    screenshotRef.current = null;
    clientReportIdRef.current = null;
    setState('idle');
    setErrorInfo(null);
    setShowDetails(false);
    setDropScreenshot(false);
    setCopied(false);
  };

  // T7560: a report with no words captures nothing diagnosable (prod row #46
  // landed NULL). Require at least one non-whitespace character before we let
  // the report go out. The screenshot/logs/actions still ride along once there
  // is a sentence to anchor them.
  const canSend = description.trim().length > 0 && state !== 'sending';

  // Build the credential-scrubbed text that "Copy error details" shows and copies.
  // Runs entirely client-side, so it works even when the reporting service is down.
  const buildErrorDetails = () => {
    const logs = getClientLogs();
    const logLines = logs
      .map((l) => scrubSecrets(`[${l.level || 'log'}] ${l.message ?? ''}`))
      .join('\n');
    const statusLine = errorInfo?.kind === 'http'
      ? `server rejected the report (status ${errorInfo.status})`
      : 'could not reach the server (network error)';
    return [
      'ReelBallers problem report (send failed -- known credentials removed; please review before sharing)',
      `Report ID: ${clientReportIdRef.current || '(none)'}`,
      `Status: ${statusLine}`,
      `Page: ${scrubUrl(window.location.href)}`,
      `Build: ${typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : '(dev)'}`,
      `Browser: ${navigator.userAgent}`,
      `Reporter: ${email || '(anonymous)'}`,
      '',
      'Your message:',
      description.trim() || '(empty)',
      '',
      'Recent logs (credentials removed):',
      logLines || '(none)',
      '',
      '(Screenshot omitted from copied details.)',
    ].join('\n');
  };

  const handleSend = async () => {
    if (!description.trim()) return; // gate (belt-and-braces with the disabled button)
    setState('sending');
    setShowDetails(false);
    setCopied(false);
    try {
      const logs = getClientLogs();
      const actions = getActionLog();
      const editorContext = getEditorContext();
      const url = `${API_BASE}/api/auth/report-problem`;
      // T9400: drop the screenshot on a degraded retry (large base64 on a slow
      // uplink is the classic mid-flight failure). The ref is kept intact so a
      // later full retry can still include it.
      const screenshot = dropScreenshot ? null : screenshotRef.current;
      const payload = {
        logs,
        user_agent: navigator.userAgent,
        page_url: window.location.href,
        email: email || null,
        description: description.trim(),
        screenshot: screenshot ? '(base64 image)' : null,
        build: typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : null,
        actions,
        editor_context: editorContext,
        client_report_id: clientReportIdRef.current,
      };
      console.warn(`[ReportProblem] POST ${url} logCount=${logs.length} hasScreenshot=${!!screenshot} email=${email || 'anon'} reportId=${clientReportIdRef.current}`);
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          screenshot,
        }),
        rbNonDataWrite: true, // T6020 follow-up: support-ticket write, not user-data
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const hint = res.status === 404
          ? ' (backend may not be running or endpoint not registered -- restart uvicorn)'
          : res.status === 429
          ? ' (rate limited -- wait and try again)'
          : res.status >= 500
          ? ' (backend error -- check server logs)'
          : '';
        console.error(`[ReportProblem] ${res.status} ${res.url}:`, data, hint);
        setErrorInfo({ kind: 'http', status: res.status, message: data.detail || `Failed (${res.status})` });
        setState('error');
        return;
      }
      clearClientLogs();
      setState('sent');
    } catch (err) {
      const isNetwork = err.name === 'TypeError';
      console.error(`[ReportProblem] Failed: ${err.message}${isNetwork ? ' (network error -- is the backend reachable?)' : ''}`);
      setErrorInfo({ kind: isNetwork ? 'network' : 'http', message: err.message });
      setState('error');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Report a problem"
        title={compact ? 'Report a problem' : undefined}
        className={`${className || 'text-sm text-gray-400 hover:text-gray-200'} transition-all`}
      >
        {compact ? <MessageSquare size={18} aria-hidden="true" /> : 'Report a problem'}
      </button>
    );
  }

  return (
    <div data-report-modal className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div
        className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md mx-4 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white">Report a problem</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {state === 'sent' ? (
            <div className="text-center py-6">
              <p className="text-green-400 font-medium mb-1">Report sent!</p>
              <p className="text-gray-400 text-sm">Thanks -- we'll look into it.</p>
              <button
                onClick={handleClose}
                className="mt-4 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* T9400: on failure the typed report stays mounted and editable --
                  the error is a banner above it, never a dead-end that hides the
                  text. Nothing the user wrote is lost. */}
              {state === 'error' && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
                  <p className="text-red-400 font-medium text-sm">Report not sent</p>
                  <p className="text-gray-300 text-xs">
                    {errorInfo?.kind === 'http'
                      ? `The server rejected the report (status ${errorInfo.status}). Your message is safe -- retry below.`
                      : "We couldn't reach the server. Your message is safe -- retry below."}
                  </p>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What went wrong? Describe what you were doing..."
                rows={4}
                disabled={state === 'sending'}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none disabled:opacity-50"
              />

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-gray-500">
                  {canSend || state === 'sending'
                    ? 'A screenshot and logs are included automatically'
                    : 'One sentence helps us fix it — a screenshot and logs are included automatically'}
                </span>
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  aria-disabled={!canSend}
                  title={!canSend && state !== 'sending' ? 'Add a short description first' : undefined}
                  className="shrink-0 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {state === 'sending' ? 'Sending...' : state === 'error' ? 'Retry report' : 'Send report'}
                </button>
              </div>

              {state === 'error' && (
                <div className="space-y-2 border-t border-gray-700 pt-3">
                  {screenshotRef.current && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dropScreenshot}
                        onChange={e => setDropScreenshot(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Retry without the screenshot (smaller, more likely to send)
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => { setShowDetails(v => !v); setCopied(false); }}
                    className="text-xs text-gray-400 hover:text-gray-200 underline"
                  >
                    {showDetails ? 'Hide error details' : 'Copy error details'}
                  </button>

                  {showDetails && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-gray-500">
                        This is exactly what will be copied. Known credentials are removed -- glance over it before sharing. Paste it to us if retrying keeps failing.
                      </p>
                      <textarea
                        readOnly
                        aria-label="Error details preview"
                        value={buildErrorDetails()}
                        rows={7}
                        className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-[11px] font-mono text-gray-300 resize-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(buildErrorDetails());
                            setCopied(true);
                          } catch {
                            setCopied(false);
                          }
                        }}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg"
                      >
                        {copied ? 'Copied' : 'Copy to clipboard'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
