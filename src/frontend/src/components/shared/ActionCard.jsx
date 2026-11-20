import { useGuidePulse } from '../instructions/GuideScope';
const BASE = 'group w-full h-full rounded-xl border p-5 text-center flex flex-col items-center justify-center gap-3 transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed';

// T12010: one card shape, four roles. Colour carries hierarchy: only `primary` is a solid fill.
const VARIANTS = {
  secondary: {
    card: 'border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 text-cyan-50 shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] hover:border-cyan-300/80 hover:from-cyan-500/30 focus-visible:ring-cyan-300',
    disc: 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40',
    desc: 'text-cyan-100/80',
  },
  primary: {
    card: 'border-transparent bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-950/40 hover:bg-cyan-400 active:bg-cyan-600 focus-visible:ring-cyan-200',
    disc: 'bg-slate-950/15 text-slate-950 ring-1 ring-slate-950/20',
    desc: 'text-slate-900/80',
  },
  destructive: {
    card: 'border-white/10 bg-transparent text-red-300 hover:bg-red-500/10 focus-visible:ring-red-300',
    disc: 'bg-red-500/10 text-red-300 ring-1 ring-red-400/30',
    desc: 'text-red-200/70',
  },
  exit: {
    card: 'border-white/10 bg-transparent text-gray-300 hover:bg-white/5 focus-visible:ring-gray-300',
    disc: 'bg-white/5 text-gray-300 ring-1 ring-white/10',
    desc: 'text-gray-400',
  },
};

// T17860: a secondary card whose panel or mode is on (Trim track open, Preview playing). It
// REPLACES the secondary card classes: appended via className, border-cyan-300 lost to the
// variant's border-cyan-400/50 in the generated CSS order and the border never changed.
const PRESSED_SECONDARY = 'border-cyan-300 bg-gradient-to-b from-cyan-500/40 to-cyan-500/15 ring-1 ring-cyan-300/60 text-cyan-50 shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] hover:from-cyan-500/50 focus-visible:ring-cyan-300';

// Locked (any variant): no border, muted, still focusable (aria-disabled, never `disabled`).
// Text is gray-300, not gray-400: gray-400 is ~3.4:1 on the Annotate gradient (annotate.md, T11750).
const LOCKED = { card: 'border-transparent bg-white/5 text-gray-300 cursor-not-allowed shadow-none', disc: 'bg-white/5 text-gray-400', desc: 'text-gray-300' };

export const actionCardClass = `${BASE} min-h-[168px] ${VARIANTS.secondary.card}`;

// T17860: `reserveTwoTitleLines` keeps a phone row two title lines tall, so a card whose label
// changes with state ("Trim and slow motion" -> "Close trimming", T17910) never resizes the pinned band.
export function ActionCardContent({ icon: Icon, title, description, subline, compact = false, iconClassName = '', variant = 'secondary', locked = false, phoneRow = false, reserveTwoTitleLines = false }) {
  const v = locked ? LOCKED : VARIANTS[variant];
  return <>
    {/* T13250: no icon, no disc -- an empty circle reads as a failed render */}
    {Icon && <span data-cta-disc className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${phoneRow ? 'max-sm:h-8 max-sm:w-8 ' : ''}${v.disc}`}><Icon size={compact ? 20 : 24} className={iconClassName} aria-hidden="true" /></span>}
    {(() => {
      const titleSpan = <span className={`${compact ? 'text-sm' : 'text-base'} font-bold leading-snug whitespace-nowrap${phoneRow ? ' max-sm:whitespace-normal max-sm:text-left' : ''}${phoneRow && reserveTwoTitleLines ? ' max-sm:flex max-sm:min-h-[2lh] max-sm:items-center' : ''}`}>{title}{description && <span className="sr-only">.</span>}</span>;
      // T17910: `subline` is a smaller line under the title whose height is always reserved
      // (min-h 1lh, even when empty), so a changing or unknown value never resizes the card.
      if (subline === undefined) return titleSpan;
      return <span className="flex flex-col items-center">
        {titleSpan}
        <span data-testid="cta-cost-line" className={`text-xs font-semibold leading-tight min-h-[1lh] whitespace-nowrap ${v.desc}`}>{subline}</span>
      </span>;
    })()}
    {description && ' '}
    {description && <span data-cta-desc className={`text-xs leading-relaxed line-clamp-2 min-h-[2lh]${phoneRow ? ' max-sm:hidden' : ''} ${v.desc}`}>{description}</span>}
  </>;
}

export default function ActionCard({ icon, title, description, subline, tooltip, compact = false, iconClassName = '', className = '', variant = 'secondary', locked = false, pressed = false, phoneRow = false, reserveTwoTitleLines = false, guideTarget, guideSuppress = false, children, ...props }) {
  // T12740: pulses when the enclosing GuideScope's guide names this target; locked/disabled cards never pulse.
  const pulseClass = useGuidePulse(guideTarget, { suppress: guideSuppress || locked || props.disabled || props['aria-disabled'] });
  const v = locked ? LOCKED : VARIANTS[variant];
  if (pressed && variant !== 'secondary') console.error(`ActionCard: pressed is only styled for the secondary variant, got "${variant}"`);
  const card = pressed && !locked ? PRESSED_SECONDARY : v.card;
  const size = compact ? 'min-h-[108px] !p-3 !gap-2' : 'min-h-[168px]';
  // T12450: phones get a short icon-left row so the pinned band leaves the video its height.
  const phone = phoneRow ? ' max-sm:flex-row max-sm:justify-start max-sm:!min-h-12 max-sm:!p-2 max-sm:!gap-2' : '';
  return <button type="button" title={tooltip} className={`${BASE} ${size}${phone} ${card} ${pulseClass} ${className}`} {...props}>
    <ActionCardContent icon={icon} title={title} description={description} subline={subline} compact={compact} iconClassName={iconClassName} variant={variant} locked={locked} phoneRow={phoneRow} reserveTwoTitleLines={reserveTwoTitleLines} />
    {children}
  </button>;
}
