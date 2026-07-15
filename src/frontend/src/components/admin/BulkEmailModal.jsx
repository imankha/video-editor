import { useState, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars -- both icons are used in JSX below; the config's no-unused-vars doesn't recognize JSX usage
import { X, Send } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

/**
 * BulkEmailModal — compose and send a branded update email to selected users (T4860).
 *
 * Props:
 * - users: array of { user_id, email }
 * - onClose: called when the modal is dismissed
 *
 * Flow: subject + body + recipient count + "Send test to me". The real send is
 * two-step (Send -> "Really send to {n} users?" confirm) and the result summary
 * (sent/failed per user) renders before close. NO backdrop-click close (project
 * rule) — only the X button and Done/Cancel dismiss.
 */
export function BulkEmailModal({ users, onClose }) {
  const n = users.length;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [testNote, setTestNote] = useState(null);
  const [summary, setSummary] = useState(null);

  const sendBulkEmail = useAdminStore(state => state.sendBulkEmail);
  const loading = useAdminStore(state => state.bulkActionLoading);

  const validate = useCallback(() => {
    if (!subject.trim()) { setError('Subject is required'); return false; }
    if (subject.length > 200) { setError('Subject must be 200 characters or fewer'); return false; }
    if (!body.trim()) { setError('Body is required'); return false; }
    if (body.length > 10000) { setError('Body must be 10000 characters or fewer'); return false; }
    setError(null);
    return true;
  }, [subject, body]);

  const handleTest = useCallback(async () => {
    if (!validate()) return;
    setTestNote(null);
    try {
      const data = await sendBulkEmail([], subject, body, { test: true });
      const to = data.results[0]?.email || 'your address';
      setTestNote(data.sent > 0 ? `Test sent to ${to}` : `Test failed: ${data.results[0]?.error || 'unknown'}`);
    } catch (err) {
      setError(err.message);
    }
  }, [validate, sendBulkEmail, subject, body]);

  const handleSend = useCallback(async () => {
    if (!validate()) return;
    if (!confirming) { setConfirming(true); return; }
    try {
      const data = await sendBulkEmail(users.map(u => u.user_id), subject, body, { test: false });
      setSummary({
        sent: data.sent,
        failed: data.failed,
        failedIds: data.results.filter(r => !r.ok),
      });
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    }
  }, [validate, confirming, sendBulkEmail, users, subject, body]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-[28rem] max-w-[92vw] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Send update email</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {summary ? (
          <div className="text-sm py-2">
            <p className="text-green-400 text-center">
              Sent {summary.sent}
              {summary.failed > 0 && `, ${summary.failed} failed`}
            </p>
            {summary.failedIds.length > 0 && (
              <ul className="mt-2 text-red-400 text-xs max-h-32 overflow-auto">
                {summary.failedIds.map(r => (
                  <li key={r.user_id}>{r.email || r.user_id}: {r.error}</li>
                ))}
              </ul>
            )}
            <button
              onClick={onClose}
              className="mt-3 w-full bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-gray-400 text-sm">
              {n} recipient{n === 1 ? '' : 's'} · from hello@reelballers.com
            </p>

            <input
              type="text"
              value={subject}
              maxLength={200}
              onChange={e => { setSubject(e.target.value); setConfirming(false); }}
              placeholder="Subject"
              className="bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              autoFocus
            />
            <textarea
              value={body}
              maxLength={10000}
              onChange={e => { setBody(e.target.value); setConfirming(false); }}
              placeholder="Write your update… (blank lines become paragraphs)"
              rows={8}
              className="bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 resize-y"
            />

            {error && <p className="text-red-400 text-xs">{error}</p>}
            {testNote && <p className="text-blue-300 text-xs">{testNote}</p>}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={loading}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
              >
                Send test to me
              </button>

              <div className="flex items-center gap-2">
                {confirming && (
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="px-3 py-2 text-xs rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={loading}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    confirming
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-purple-600 hover:bg-purple-500 text-white'
                  }`}
                >
                  <Send size={13} />
                  {loading
                    ? 'Sending…'
                    : (confirming ? `Really send to ${n} users?` : 'Send')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
