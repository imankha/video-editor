import { usePublishIntentStore } from '../stores/publishIntentStore';

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
 * `onAbandon` (optional) fires exactly once, before returning, on the tick
 * where the scheduler gives up because `shouldContinue()` went false while
 * `fire()` had never run (e.g. the publish-intent stake expired before the
 * overlay export button ever mounted). It does NOT fire on an explicit
 * `cancel()` (that's an intentional teardown, not an abandonment) nor after a
 * successful `fire()`. Use it to surface a loud "one-tap publish failed" signal
 * instead of the old silent no-op.
 *
 * Returns a cancel handle (call to stop early); the caller isn't required to
 * use it since `shouldContinue` already self-terminates the poll.
 */
export function scheduleExportWhenReady({
  isReady,
  fire,
  shouldContinue,
  onAbandon,
  intervalMs = 150, // sub-perceptible latency once ready, without busy-spinning
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timeoutId = null;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    if (!shouldContinue()) {
      // Gave up without ever firing — the stake cleared/expired first.
      onAbandon?.();
      return;
    }
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

/**
 * T9740: the ONE cross-mode export trigger. Focus's "Publish without spotlight"
 * must fire OVERLAY's export button, which is not mounted yet at click time.
 * Takes OVERLAY's ref specifically — never a ref any other mode's button can
 * attach to. This is the load-bearing fix for PR #417's regression: the earlier
 * version polled a single `exportButtonRef` SHARED across Focus's and Overlay's
 * button instances, so `!!ref.current` was satisfied on tick zero by Focus's
 * OWN still-mounted button (closed over FRAMING mode) and fired the framing
 * render endpoint instead of the overlay one. Scoping the ref to Overlay makes
 * `isReady` true BY CONSTRUCTION only once Overlay's button has mounted — no
 * tag to keep in sync, no reliance on React scheduling/timing.
 */
export function scheduleOverlayPublishExport({ overlayExportButtonRef, projectId, onAbandon }) {
  return scheduleExportWhenReady({
    isReady: () => !!overlayExportButtonRef.current,
    fire: () => overlayExportButtonRef.current.triggerExport(),
    shouldContinue: () => usePublishIntentStore.getState().projectId === projectId,
    onAbandon,
  });
}
