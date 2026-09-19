// T10610 § B.2 (binding constraint 8): the ONE Escape rule, shared by every
// text input/textarea in the play editor (overlay: formBody name, strip
// inline name, notes in all three DetailsFields hosts; sidebar: name, notes).
//
// Escape inside a focused text field REVERTS that field's draft to the stored
// value and blurs WITHOUT writing — the only discard that survives D1. Escape
// anywhere else (no text field focused) is a different gesture entirely
// (closeWithCommit) and never reaches this function.
//
// Ordering matters: revert the draft FIRST, then blur — the blur-triggered
// commit must see the reverted value, not the pre-revert one.
//
// React's setState (draftSetter) does NOT synchronously update component
// state/re-render, but calling `.blur()` right afterward fires the `onBlur`
// handler SYNCHRONOUSLY, inside the same event-handler call stack — before
// React has flushed the revert and produced a fresh closure. A commit
// handler that reads the reverted value from REACT STATE (a closed-over
// variable) would therefore still see the stale pre-revert value and fire a
// write. Fixed by ALSO mutating the DOM node's `.value` synchronously here,
// so a commit handler that reads `e.target.value` (not component state) sees
// the reverted value regardless of React's batching timing. This is not a
// theoretical concern — it reproduces with a REAL DOM focus/blur cycle
// (verified: a jsdom test that never truly focuses the field masks it, since
// `.blur()` on a non-focused element is a spec no-op).
export function onTextFieldKeyDown(e, { draftSetter, storedValue, allowEnterCommit = false }) {
  if (e.key === 'Escape') {
    e.stopPropagation(); // the window/editor-level Escape handler must NOT also close the editor
    const reverted = storedValue || '';
    e.currentTarget.value = reverted; // synchronous DOM sync — see comment above
    draftSetter(reverted);
    e.currentTarget.blur();
  } else if (allowEnterCommit && e.key === 'Enter') {
    e.preventDefault();
    e.currentTarget.blur(); // commit via the one blur call site
  }
}
