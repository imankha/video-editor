import { ChevronDown, ChevronRight } from 'lucide-react';

// The admin screen's disclosure button: a chevron plus the summary line, aria-expanded set.
// Moved out of SpendReadinessPanel.jsx (T14910) when the Next Step panel (T14920) became its
// second user. Which sections are open is view state, never persisted.
export function Toggle({ open, onClick, testId, children, className = '' }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" data-testid={testId} aria-expanded={open} onClick={onClick}
            className={`inline-flex items-center gap-1 text-left hover:text-white ${className}`}>
      <Icon size={14} aria-hidden="true" className="shrink-0 text-gray-400" />
      {children}
    </button>
  );
}
