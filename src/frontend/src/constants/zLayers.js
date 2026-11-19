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
 *   TOAST             z-[100] toasts, editor-mode chrome, the recap
 *                             player.
 *   POPOVER           z-[110] an anchored popover portaled to document.body that
 *                             must clear editor-mode chrome — the Annotate rating
 *                             picker (T11410) opens from the fullscreen editor
 *                             overlay (TOAST), so its body portal has to sit above
 *                             that rung. Just above TOAST, below SHARE.
 *                             T12580: the guide shade layer also uses this rung; it
 *                             sits below the coach card by DOM order, not by value.
 *   SHARE             z-[115] the Share game window (ShareGameModal), opened from
 *                             Home, from Mark Plays (incl. its fullscreen editor,
 *                             TOAST) and nested in the recap player (TOAST), so it
 *                             needs its own rung above TOAST. T17220: below NOTICE so
 *                             its copy-link / send-failure toasts stay readable.
 *   NOTICE            z-[120] the global toast stack (ToastContainer): above the guide
 *                             shade (POPOVER) so a toast stays readable while a coach is
 *                             up (T13540), and above the share window (T17220).
 *   SYSTEM            z-[9999] app-wide system banners: impersonation, the blocking
 *                             PWA update gate.
 *
 * NESTED MODALS: a dialog rendered as a DESCENDANT of a higher rung inherits that
 * rung's stacking context, so it may keep a lower value and still sit above its
 * parent (e.g. the delete-card ConfirmationDialog lives inside the intro-card
 * modal's MODAL_ELEVATED subtree, so its MODAL value renders above the grid). Only
 * raise a dialog's own rung when it is a SIBLING of what it must cover.
 * The reverse trap: a dialog mounted under a LOWER rung is capped by it. Home's
 * top-right controls cluster is `fixed ... z-30`, the same value as a highlight
 * tile's Play/Share buttons, so a dialog opened from that cluster must portal to
 * document.body (ManageProfilesModal, T17680; IntroCardsModal, T6600).
 *
 * OUT OF SCOPE (intentionally not on this ladder): local intra-component stacking
 * (z-10/z-20/z-30 badges, scrims, and hover lifts WITHIN a single card/tile). Those
 * are private to their own stacking context and never compete app-wide, so keeping
 * them as bare local values is correct (greppability > false uniformity). The
 * editor timeline levers (TextLayer/RegionLayer `zIndex: 100`) are owned by a
 * parallel task and are inventoried in the T6600 report, not migrated here.
 *
 * T12800: ClipRegionLayer's clip-marker tooltip (body-portaled, `position: fixed`)
 * used to sit at a raw `zIndex: 2147483000` ("above every app surface", T6400) --
 * ABOVE POPOVER too, so it painted over an active guide shade, which is supposed to
 * hide everything but the control a guide names. It's now `Z_INDEX.POPOVER - 1`:
 * still above every modal/toast per T6400's original intent, but a guide shade wins
 * when one is active. If a future surface needs to clear the shade on purpose, give
 * it its own rung ABOVE POPOVER rather than reaching for an extreme raw number again.
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
  POPOVER: 'z-[110]',
  SHARE: 'z-[115]',
  NOTICE: 'z-[120]',
  SYSTEM: 'z-[9999]',
};

/**
 * T12800: the same ladder as raw numbers, for a `position: fixed` element whose
 * coordinates are computed dynamically (`style={{ left, top, zIndex }}`), which
 * can't take a Tailwind class. Keep the two objects' rungs in sync.
 */
export const Z_INDEX = {
  DROPDOWN: 40,
  MODAL: 50,
  OVERLAY_BACKDROP: 60,
  PLAYER: 70,
  MODAL_ELEVATED: 80,
  INTRO: 85,
  ALERT: 90,
  TOAST: 100,
  POPOVER: 110,
  SHARE: 115,
  NOTICE: 120,
  SYSTEM: 9999,
};

export default Z;
