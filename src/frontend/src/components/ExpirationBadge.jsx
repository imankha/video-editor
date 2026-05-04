import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';

export function getDaysUntil(isoDateStr) {
  if (!isoDateStr) return null;
  const now = new Date();
  const expiry = new Date(isoDateStr);
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

export function ExpirationBadge({ expiresAt, canExtend = true, onClick }) {
  const daysLeft = useMemo(() => getDaysUntil(expiresAt), [expiresAt]);

  if (daysLeft === null || daysLeft >= 14) return null;

  const label = daysLeft <= 0 ? 'Expired' : `${daysLeft}d`;
  const isExpired = daysLeft <= 0;

  if (isExpired && !canExtend) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-400"
        title="Game video permanently deleted"
      >
        <Clock size={10} />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 hover:bg-yellow-900/70 transition-colors"
      title={isExpired ? 'Game expired — click to extend' : `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — click to extend`}
    >
      <Clock size={10} />
      {label}
    </button>
  );
}
