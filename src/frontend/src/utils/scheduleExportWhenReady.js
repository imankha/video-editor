/**
 * T9740 — replaces a bare `setTimeout(..., 500)` cross-mode export trigger
 * that raced an async load and silently no-op'd (see FocusScreen.handlePublish:
 * `exportButtonRef` only attaches once Overlay's export button mounts, which
 * is gated on `effectiveOverlayVideoUrl`/`workingVideo` hydrating — an async
 * chain that routinely exceeds any fixed delay for a just-rendered video).
 *
 * Pure/injectable so it's unit-testable without mounting the Overlay screen
 * tree (mirrors the `deriveOverlayVideoSource` extraction). Polls `isReady`
 * on a recursive timeout (never `setInterval`, so a slow tick can't stack),
 * fires at most once, and stops as soon as `shouldContinue` goes false — the
 * caller supplies that from the already-existing publishIntentStore stake, so
 * this introduces no second/competing deadline: the stake's own 5-minute
 * safety-net expiry (and its defensive clears on Refocus/Add Spotlight/Save
 * Draft) is what eventually stops a poll that never finds `isReady`.
 *
 * Returns a cancel handle (call to stop early); the caller isn't required to
 * use it since `shouldContinue` already self-terminates the poll.
 */
export function scheduleExportWhenReady({
  isReady,
  fire,
  shouldContinue,
  intervalMs = 150, // sub-perceptible latency once ready, without busy-spinning
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timeoutId = null;
  let cancelled = false;

  const tick = () => {
    if (cancelled || !shouldContinue()) return;
    if (isReady()) {
      fire();
      return;
    }
    timeoutId = setTimeoutFn(tick, intervalMs);
  };

  tick();

  return () => {
    cancelled = true;
    if (timeoutId !== null) clearTimeoutFn(timeoutId);
  };
}
