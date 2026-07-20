import { Plus, Mail, X } from 'lucide-react';

/**
 * BulkActionBar — sticky action bar shown while selection mode is active (T4860).
 *
 * Props:
 * - count: number of selected users
 * - onGrant: open the bulk grant-credits modal
 * - onEmail: open the bulk email modal
 * - onCancel: exit selection mode and clear the selection
 *
 * Grant/Email are disabled at count=0. Purely presentational; selection state
 * lives in UserTable.
 */
export function BulkActionBar({ count, onGrant, onEmail, onCancel }) {
  const disabled = count === 0;
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg border border-purple-500/40 bg-purple-900/40 backdrop-blur">
      <span className="text-sm text-purple-100 font-medium">{count} selected</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onGrant}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={13} />
          Grant Credits
        </button>
        <button
          type="button"
          onClick={onEmail}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Mail size={13} />
          Send Email
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </div>
  );
}
