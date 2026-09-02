/**
 * zLayers — the single ordered z-index scale for the app's overlay stack (T6600).
 *
 * WHY THIS EXISTS
 * ---------------
 * z-index values were ad hoc across ~60 components (z-40, z-50, z-[60], z-[70],
 * z-[80], z-[90], z-[100]) with no ordering anyone could see by reading the code.
 * That made the stack un-inspectable and produced THREE wrong diagnoses of one
 * layering bug (T6540/T6580: draft tiles painting over the intro-card modal was
 * mis-called bleed-through and "fixed" with a heavier scrim, twice). The real
 * defect was ordering, not opacity. This module makes the order explicit and
 * places every overlay on ONE ladder, low → high.
 *
 * HOW TO USE
 * ----------
 *   import { Z } from '../constants/zLayers';
 *   <div className={`fixed inset-0 ${Z.MODAL} ...`} />
 *
 * The values are COMPLETE Tailwind class strings (not numbers) so Tailwind's JIT
 * scans this file and generates them (this file is inside the `./src/**` content
 * glob). Do NOT build class names dynamically (`z-[${n}]`) — Tailwind can't see
 * those. Add a rung here rather than inventing a new bare number at a call site.
 *
 * THE LADDER (low → high)
 * -----------------------
 *   DROPDOWN          z-40    page-level popovers: dropdowns, drawers, side panels,
 *                             tooltips, drawer backdrops. This IS the rung for an
 *                             in-card kebab/action MENU that is NOT portaled to
 *                             document.body (e.g. CollectionHeader's "..." menu) —
 *                             don't confuse it with the OUT-OF-SCOPE local badges
 *                             below: an open menu is content the user is actively
 *                             reading/clicking, so it must clear every sibling tile
 *                             control (T5215 round 3 — a card's own Play button,
 *                             bare z-30, was painting over CollectionHeader's menu
 *                             because the menu was left at a bare z-10 instead of
 *                             this rung).
 *   MODAL             z-50    standard modal dialogs + their backdrops; tile kebab
 *                             menus portaled to body.
 *   OVERLAY_BACKDROP  z-[60]  the opaque backdrop beneath a fullscreen player or a
 *                             tile video preview.
 *   PLAYER            z-[70]  fullscreen media players and tile video previews
 *                             (CollectionPlayer, DraftTile preview) — they cover
 *                             the MODAL layer on purpose.
 *   MODAL_ELEVATED    z-[80]  a modal that must sit ABOVE the player/tile layer:
 *                             a nested modal opened from another modal (the
 *                             intro-card modal opened from ManageProfiles) or a
 *                             cross-cutting action modal (MoveToProfile). This is
 *                             the rung that fixes T6600 — the intro-card modal is
 *                             portaled to document.body at this layer so no tile
 *                             portal (z-[60]/z-[70]) can paint over it.
 *   INTRO              z-[85] the intro-card full-screen preroll's own default
 *                             overlay position (IntroPreRoll, IntroStoryPlayer) —
 *                             above MODAL_ELEVATED so a nested intro-card modal's
 *                             preview still wins, below ALERT so CompositeScrubber
 *                             (wrapped at ALERT) can paint its scrub bar over it.
 *   ALERT             z-[90]  alerts that must sit above everything modal/player:
 *                             LockedReasonModal over the player, hero intros.
 *   TOAST             z-[100] toasts, quest popovers, editor-mode chrome, the recap
 *                             player.
 *   SHARE             z-[200] the share-playback dialog (SharePlaybackDialog) —
 *                             opened as a nested overlay from within the recap
 *                             player (TOAST) as well as standalone from
 *                             AnnotateScreen, so it needs its own rung above TOAST
 *                             rather than relying on inherited stacking context.
 *   SYSTEM            z-[9999] app-wide system banners: impersonation, the blocking
 *                             PWA update gate.
 *
 * NESTED MODALS: a dialog rendered as a DESCENDANT of a higher rung inherits that
 * rung's stacking context, so it may keep a lower value and still sit above its
 * parent (e.g. the delete-card ConfirmationDialog lives inside the intro-card
 * modal's MODAL_ELEVATED subtree, so its MODAL value renders above the grid). Only
 * raise a dialog's own rung when it is a SIBLING of what it must cover.
 *
 * OUT OF SCOPE (intentionally not on this ladder): local intra-component stacking
 * (z-10/z-20/z-30 badges, scrims, and hover lifts WITHIN a single card/tile). Those
 * are private to their own stacking context and never compete app-wide, so keeping
 * them as bare local values is correct (greppability > false uniformity). The
 * editor timeline levers (TextLayer/RegionLayer `zIndex: 100`) are owned by a
 * parallel task and are inventoried in the T6600 report, not migrated here.
 */
export const Z = {
  DROPDOWN: 'z-40',
  MODAL: 'z-50',
  OVERLAY_BACKDROP: 'z-[60]',
  PLAYER: 'z-[70]',
  MODAL_ELEVATED: 'z-[80]',
  INTRO: 'z-[85]',
  ALERT: 'z-[90]',
  TOAST: 'z-[100]',
  SHARE: 'z-[200]',
  SYSTEM: 'z-[9999]',
};

export default Z;
