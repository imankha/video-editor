/**
 * PrimaryCta (T9270) — the single saturated call-to-action button that lives in
 * the ActionBand on Focus and Overlay.
 *
 * Anatomy is identical on both screens except color: 56px tall, `padding: 0 34px`,
 * `border-radius: 10px`, icon + label, `font-size: 17px`, `font-weight: 600`.
 * Focus is blue (#2563eb) with a blue shadow; Overlay is purple (#9333ea) with a
 * purple shadow.
 *
 * NON-NEGOTIABLE: the button's rendered box must be byte-identical regardless of
 * the settings rail's state (expanded/collapsed) and the mobile drawer's state
 * (open/closed). It NEVER lives inside the settings container, and nothing about
 * its size depends on layout state. `data-testid="primary-cta"` sits on the actual
 * <button>.
 *
 * @param {'focus'|'overlay'} accent — selects the saturated color.
 */
const ACCENTS = {
  focus: { background: '#2563eb', boxShadow: '0 4px 16px rgba(37,99,235,0.50)' },
  overlay: { background: '#9333ea', boxShadow: '0 4px 16px rgba(147,51,234,0.50)' },
};

export default function PrimaryCta({
  accent = 'focus',
  icon: Icon,
  iconClassName = '',
  onClick,
  disabled = false,
  title,
  children,
}) {
  const { background, boxShadow } = ACCENTS[accent] || ACCENTS.focus;
  return (
    <button
      type="button"
      data-testid="primary-cta"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap text-white transition-opacity ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-95'
      }`}
      style={{
        height: '56px',
        padding: '0 34px',
        borderRadius: '10px',
        fontSize: '17px',
        fontWeight: 600,
        background,
        boxShadow: disabled ? 'none' : boxShadow,
      }}
    >
      {Icon && <Icon size={20} className={iconClassName} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}
