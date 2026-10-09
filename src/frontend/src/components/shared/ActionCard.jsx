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

// Locked (any variant): no border, muted, still focusable (aria-disabled, never `disabled`).
const LOCKED = { card: 'border-transparent bg-white/5 text-gray-400 cursor-not-allowed shadow-none', disc: 'bg-white/5 text-gray-400', desc: 'text-gray-400' };

export const actionCardClass = `${BASE} min-h-[168px] ${VARIANTS.secondary.card}`;

export function ActionCardContent({ icon: Icon, title, description, compact = false, iconClassName = '', variant = 'secondary', locked = false }) {
  const v = locked ? LOCKED : VARIANTS[variant];
  return <>
    <span data-cta-disc className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${v.disc}`}>{Icon && <Icon size={compact ? 20 : 24} className={iconClassName} aria-hidden="true" />}</span>
    <span className={`${compact ? 'text-sm' : 'text-base'} font-bold leading-snug whitespace-nowrap`}>{title}</span>
    {description && <span className={`text-xs leading-relaxed line-clamp-2 min-h-[2lh] ${v.desc}`}>{description}</span>}
  </>;
}

export default function ActionCard({ icon, title, description, tooltip, compact = false, iconClassName = '', className = '', variant = 'secondary', locked = false, children, ...props }) {
  const v = locked ? LOCKED : VARIANTS[variant];
  const size = compact ? 'min-h-[108px] !p-3 !gap-2' : 'min-h-[168px]';
  return <button type="button" title={tooltip} className={`${BASE} ${size} ${v.card} ${className}`} {...props}>
    <ActionCardContent icon={icon} title={title} description={description} compact={compact} iconClassName={iconClassName} variant={variant} locked={locked} />
    {children}
  </button>;
}
