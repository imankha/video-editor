/**
 * SettingRow (T9270) — the one settings-row anatomy used across Focus and Overlay,
 * lifted from the old OverlaySettingsCard rows.
 *
 * Layout: `flex items-center justify-between`. Left column is a `text-sm
 * font-medium text-gray-200` label over a `text-xs text-gray-400` live value; the
 * control (`children`) sits on the right. On a coarse pointer the row floors at
 * 44px so touch targets stay legal.
 *
 * `stack` switches to a two-row layout (label row, then a `flex-wrap` control row)
 * for controls wider than the label column — the six color swatches. Presentational
 * only; every value/handler is a prop, no state, no persistence.
 *
 * @param {string} label — the setting name (bold line).
 * @param {React.ReactNode} value — the live value line (small gray). Optional.
 * @param {React.ReactNode} children — the control on the right (or below, if stacked).
 * @param {boolean} stack — stack the control under the label (wide controls).
 * @param {string} className — extra wrapper classes.
 */
export default function SettingRow({ label, value = null, children, stack = false, className = '' }) {
  if (stack) {
    return (
      <div className={`flex flex-col gap-2 coarse-pointer:min-h-11 ${className}`}>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-200">{label}</span>
          {value != null && <span className="text-xs text-gray-400">{value}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">{children}</div>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 coarse-pointer:min-h-11 ${className}`}>
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-gray-200">{label}</span>
        {value != null && <span className="text-xs text-gray-400">{value}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}
