export const actionCardClass = 'group w-full h-full min-h-[168px] rounded-xl border border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 p-5 text-center text-cyan-50 flex flex-col items-center justify-center gap-3 shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] transition-colors hover:border-cyan-300/80 hover:from-cyan-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-60 disabled:cursor-not-allowed';

export function ActionCardContent({ icon: Icon, title, description, compact = false, iconClassName = '' }) {
  return <>
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40 ${compact ? 'h-9 w-9' : 'h-14 w-14'}`}>{Icon && <Icon size={compact ? 20 : 28} className={iconClassName} aria-hidden="true" />}</span>
    <span className={`${compact ? 'text-sm' : 'text-base'} font-bold leading-snug`}>{title}</span>
    {description && <span className="text-xs leading-relaxed text-cyan-100/80">{description}</span>}
  </>;
}

export default function ActionCard({ icon, title, description, tooltip, compact = false, iconClassName = '', className = '', ...props }) {
  const styling = compact ? actionCardClass.replace('min-h-[168px]', 'min-h-[108px]').replace('p-5', 'p-3').replace('gap-3', 'gap-2') : actionCardClass;
  return <button type="button" title={tooltip} className={`${styling} ${className}`} {...props}>
    <ActionCardContent icon={icon} title={title} description={description} compact={compact} iconClassName={iconClassName} />
  </button>;
}
