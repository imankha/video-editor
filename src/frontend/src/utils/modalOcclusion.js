import { Z } from '../constants/zLayers';

// T8120: z-index rungs (from the Z ladder) that mark a full-screen overlay as a
// modal-or-above surface. Derived from the Z ladder itself (everything at
// Z.MODAL or above) so a new rung added to zLayers.js is automatically
// covered here instead of needing a second, independently-maintained copy.
// Read as class tokens (works in jsdom, where computed z-index is
// unavailable).
const Z_VALUES = Object.values(Z);
const MODAL_Z_TOKENS = Z_VALUES.slice(Z_VALUES.indexOf(Z.MODAL));

/**
 * T8120/T8460 — point-in-time check: is ANY full-screen fixed overlay
 * (`.fixed.inset-0`) at a modal-or-above z rung currently present and
 * visible anywhere in the document (excluding the quest panel's own
 * subtree)? Generic — no per-modal wiring — matching the app convention
 * that every modal is a `fixed inset-0` overlay on the Z ladder.
 *
 * A plain DOM read, not a subscription — safe to call from a Zustand store
 * at gesture/event time (CLAUDE.md: gesture-based, never a reactive effect
 * watching state). Extracted from QuestPanel's useModalOcclusion (T8120)
 * so both the quest-panel occlusion contract and updateGateStore's
 * quiescence check (T8460) share one implementation.
 */
export function isAnyModalOpen() {
  const isModalOverlay = (el) => {
    if (el.closest('[data-quest-panel]')) return false; // our own overlays don't count
    const cls = el.getAttribute('class') || '';
    if (!MODAL_Z_TOKENS.some((t) => cls.split(/\s+/).includes(t))) return false;
    // Visible? getClientRects is empty for display:none / detached nodes.
    return el.getClientRects().length > 0;
  };
  const overlays = document.querySelectorAll('.fixed.inset-0');
  for (const el of overlays) {
    if (isModalOverlay(el)) return true;
  }
  return false;
}
