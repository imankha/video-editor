import { useEffect } from 'react';
import { useNavigationGateStore } from '../stores/navigationGateStore';

// Blocks pointer and keyboard input (no visual flash for fast writes: the spinner
// only fades in after a short delay) while leaving Annotate's writes settle.
export function NavigationGateOverlay() {
  const blocked = useNavigationGateStore((s) => s.pending > 0);

  useEffect(() => {
    if (!blocked) return undefined;
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', swallow, true);
    return () => window.removeEventListener('keydown', swallow, true);
  }, [blocked]);

  if (!blocked) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center cursor-progress"
      role="status"
      aria-busy="true"
      aria-label="Opening highlight"
      data-testid="navigation-gate-overlay"
    >
      <div
        className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin opacity-0"
        style={{ animation: 'spin 1s linear infinite, nav-gate-fade-in 150ms ease-out 400ms forwards' }}
      />
      <style>{'@keyframes nav-gate-fade-in { to { opacity: 1; } }'}</style>
    </div>
  );
}
