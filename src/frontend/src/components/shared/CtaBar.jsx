import { useRef } from 'react';
import { Lock } from 'lucide-react';
import ActionCard from './ActionCard';
import { toast } from './Toast';
import useCtaBarHeight from './useCtaBarHeight';

/**
 * CtaBar (T12010) -- the one place CTA order and hierarchy are decided.
 *
 * Named slots make the order structural: primary is the first DOM child and first
 * visual position (left on desktop, top on mobile), then secondaries, then
 * destructive, then exit -- whatever order the props arrive in.
 *
 * Action shape: { icon, title, description, onClick, disabled, lockedReason, loading,
 * testId, tutorialTarget, pulse, confirm }. A locked action (lockedReason set) is
 * aria-disabled (never `disabled`), shows a Lock icon, and a tap toasts the reason.
 * A loading action is aria-disabled, `disabled`, and spins its icon (callers pass a Loader icon).
 * The accessible name is the title (aria-label), so description never renames it.
 *
 * band/panel set --cta-bar-h on documentElement (view-only, never persisted).
 */
function CtaAction({ role, action, compact }) {
  const { icon, title, description, onClick, disabled, lockedReason, loading, testId, tutorialTarget, pulse, confirm } = action;
  const locked = !!lockedReason;
  const handleClick = (e) => {
    if (locked) { toast.info(lockedReason); return; }
    if (confirm && !window.confirm(`${title}?`)) return;
    onClick?.(e);
  };
  return (
    <ActionCard
      variant={role}
      compact={compact}
      locked={locked}
      icon={locked ? Lock : icon}
      iconClassName={loading ? 'animate-spin' : ''}
      title={title}
      description={description}
      aria-label={title}
      data-cta-role={role}
      data-testid={testId}
      data-tutorial-target={tutorialTarget}
      aria-disabled={locked || loading || undefined}
      aria-busy={loading || undefined}
      disabled={!locked && (disabled || loading)}
      onClick={handleClick}
      className={`${role === 'primary' ? 'min-h-14' : ''} ${pulse && !locked && !disabled ? 'coach-target-pulse motion-reduce:animate-none' : ''}`}
    />
  );
}

export default function CtaBar({ layout = 'band', primary, secondary = [], destructive, exit, status, cost }) {
  const ref = useRef(null);
  const tracksHeight = layout === 'band' || layout === 'panel';

  useCtaBarHeight(ref, tracksHeight);

  const cols = secondary.length + (destructive ? 1 : 0) + (exit ? 1 : 0);
  const compact = layout === 'inline' || layout === 'modal';
  return (
    <div ref={ref} data-testid="cta-bar" data-cta-layout={layout} className="w-full flex flex-col gap-2">
      {(status || cost) && <div className="flex items-center justify-between gap-3 text-xs text-gray-300">{status}{cost}</div>}
      <div
        className="grid grid-cols-2 gap-3 md:[grid-template-columns:var(--cta-cols)]"
        style={{ '--cta-cols': primary ? `minmax(0,1.4fr) repeat(${cols},minmax(0,1fr))` : `repeat(${cols},minmax(0,1fr))` }}
      >
        {primary && <div className="col-span-2 md:col-span-1 [&>button]:w-full"><CtaAction role="primary" action={primary} compact={compact} /></div>}
        {secondary.map((a, i) => <CtaAction key={a.testId || a.title || i} role="secondary" action={a} compact={compact} />)}
        {destructive && <CtaAction role="destructive" action={destructive} compact={compact} />}
        {exit && <CtaAction role="exit" action={exit} compact={compact} />}
      </div>
    </div>
  );
}
