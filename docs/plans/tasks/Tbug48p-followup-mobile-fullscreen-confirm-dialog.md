# Follow-up (from Tbug48p review) — highlight-region delete confirmation can vanish in mobile fullscreen

**Status:** TODO — not blocking Tbug48p's fix, filed as an explicit deferral per reviewer
requirement (do not silently drop a MAJOR finding).

**Context:** `RegionLayer.jsx`'s new delete-confirmation dialog (Tbug48p) renders inside the
Overlay mode timeline, which in mobile fullscreen (`mobileFs`) sits inside an auto-hiding
controls wrapper (`OverlayModeView.jsx` ~961-990: `absolute inset-x-0 bottom-0 z-20
transition-opacity ... ${fsControls.isVisible ? 'opacity-100' : 'opacity-0
pointer-events-none'}`). `useFullscreenControls` auto-hides that wrapper 3s after playback
starts. Sequence: tap trash on mobile fullscreen -> dialog opens -> 3s later the ancestor
goes `opacity-0 pointer-events-none` -> the confirmation disappears and becomes untappable
while the pending-delete state is still set. `position: fixed` escapes ancestor overflow but
not ancestor opacity/pointer-events, so this is a real gap, not a false positive.

**Why deferred:** bug 48p itself was reported from a desktop browser session (Mac Chrome,
1451x887 viewport) — this gap doesn't affect the reported case. A correct fix likely needs
`createPortal` to `document.body` (precedent: `IntroCardsModal.jsx`) at `Z.MODAL_ELEVATED` or
above, but the mobile-fullscreen container itself is `fixed inset-0 z-[100]`
(`OverlayModeView.jsx:831`) which is ABOVE `Z.ALERT` (`z-[90]`, the highest defined token) —
so simply portaling and bumping the z-index token may not be enough; whether it's sufficient
depends on whether the z-[100] container is itself a portal or a normally-nested descendant,
which needs verifying live (a real device/emulator check), not guessed from source reading.

**Recommended next step:** verify on a real mobile device or emulator whether the
mobile-fullscreen overlay is itself portalled; if not, a `createPortal` + z-index fix for the
new ConfirmationDialog should resolve it. Re-test the exact repro (start playback in mobile
fullscreen, open the highlight-region delete dialog, wait 3s, confirm the dialog is still
visible and tappable) before closing this out.
