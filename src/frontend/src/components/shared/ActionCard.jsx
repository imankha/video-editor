export const actionCardClass = 'group w-full h-full min-h-[168px] rounded-xl border border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 p-5 text-center text-cyan-50 flex flex-col items-center justify-center gap-3 shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] transition-colors hover:border-cyan-300/80 hover:from-cyan-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-60 disabled:cursor-not-allowed';

export function ActionCardContent({ icon: Icon, title, description }) {
  return <>
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40"><Icon size={28} aria-hidden="true" /></span>
    <span className="text-base font-bold">{title}</span>
    <span className="text-xs leading-relaxed text-cyan-100/80">{description}</span>
  </>;
}

export default function ActionCard({ icon, title, description, className = '', ...props }) {
  return <button type="button" className={`${actionCardClass} ${className}`} {...props}>
    <ActionCardContent icon={icon} title={title} description={description} />
  </button>;
}
