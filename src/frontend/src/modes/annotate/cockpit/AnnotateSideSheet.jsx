/**
 * AnnotateSideSheet (T15370) -- a side sheet that slides in from the right,
 * ABSOLUTE inside the cockpit grid (never `fixed`, same rule Focus's
 * CockpitSheet follows) so it can't escape the grid's containing block.
 *
 * Unlike CockpitSheet this has no header X and no scrim: Annotate's editor
 * closes through `closeWithCommit` (Done) or Delete, which a header X can't
 * reach, and the picture must never dim while trimming. Width is
 * `calc(264px + env(safe-area-inset-right))`, right-anchored, sitting between
 * the two strips (`right-[72px]`).
 *
 * `peek` (T15380's drag-peek, carried over): while a trim handle is being
 * dragged the sheet collapses to just its trim row. This is a CLASS CHANGE on
 * the SAME element (`inset-y-0` vs `top-0 h-auto`), never a remount -- the
 * one-tree rule (T15380 finding: remounting mid-drag drops pointer capture).
 */
export default function AnnotateSideSheet({ peek = false, children }) {
  return (
    <div
      data-testid="annotate-cockpit-sheet"
      role="dialog"
      aria-label="Edit play"
      className={`absolute right-[72px] z-20 flex flex-col border-l border-gray-700 bg-gray-900/95 ${
        peek ? 'top-0 h-auto' : 'inset-y-0'
      }`}
      style={{
        width: 'calc(264px + env(safe-area-inset-right))',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {children}
    </div>
  );
}
