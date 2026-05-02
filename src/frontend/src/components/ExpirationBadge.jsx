import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';

function getDaysUntil(isoDateStr) {
  if (!isoDateStr) return null;
  const now = new Date();
  const expiry = new Date(isoDateStr);
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
}

export function ExpirationBadge({ expiresAt, onClick }) {
  const daysLeft = useMemo(() => getDaysUntil(expiresAt), [expiresAt]);

  if (daysLeft === null || daysLeft >= 14) return null;

  const label = daysLeft <= 0 ? 'Expired' : `${daysLeft}d`;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 hover:bg-yellow-900/70 transition-colors"
      title={daysLeft <= 0 ? 'Game expired — click to extend' : `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — click to extend`}
    >
      <Clock size={10} />
      {label}
    </button>
  );
}
