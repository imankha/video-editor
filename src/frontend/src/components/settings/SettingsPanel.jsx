/**
 * SettingsPanel (T9270) — a labelled group of SettingRows inside the settings rail.
 *
 * Groups are named by WHAT A CONTROL CHANGES (the inventory taxonomy):
 *   Reel (applies to every clip) / This clip or This spotlight / View only.
 *
 * Presentational only: a small-caps group title over a vertical stack of rows. The
 * rail (SettingsRail) owns the tabs + chrome; this owns one labelled group.
 *
 * @param {string} title — the group heading (e.g. "Reel", "This clip", "View only").
 * @param {React.ReactNode} children — the SettingRows in this group.
 * @param {string} className — extra wrapper classes.
 */
export default function SettingsPanel({ title, children, className = '' }) {
  return (
    <section className={`space-y-3 ${className}`}>
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h3>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  );
}
