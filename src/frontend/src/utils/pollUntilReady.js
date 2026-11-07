// T15220: shared "poll until a value is ready, or give up visibly" helper.
// Replaces a one-shot setTimeout that silently dropped the Stripe-return
// auto-export when the editor (route change + project/clip fetch) hadn't
// mounted its ExportButtonView ref yet by the time the timer fired.
export function pollUntilReady({ check, onReady, onTimeout, intervalMs = 200, deadlineMs }) {
  const interval = setInterval(() => {
    const value = check();
    if (value) {
      clearInterval(interval);
      clearTimeout(deadline);
      onReady(value);
    }
  }, intervalMs);
  const deadline = setTimeout(() => {
    clearInterval(interval);
    onTimeout?.();
  }, deadlineMs);
  return () => {
    clearInterval(interval);
    clearTimeout(deadline);
  };
}
