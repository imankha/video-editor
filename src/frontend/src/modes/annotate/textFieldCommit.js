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
// commit compares the (now-reverted) draft to the stored value, finds them
// equal, and writes nothing.
export function onTextFieldKeyDown(e, { draftSetter, storedValue, allowEnterCommit = false }) {
  if (e.key === 'Escape') {
    e.stopPropagation(); // the window/editor-level Escape handler must NOT also close the editor
    draftSetter(storedValue || '');
    e.currentTarget.blur();
  } else if (allowEnterCommit && e.key === 'Enter') {
    e.preventDefault();
    e.currentTarget.blur(); // commit via the one blur call site
  }
}
