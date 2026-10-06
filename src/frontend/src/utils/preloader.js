// T11830: dismiss the static #preloader overlay (index.html). It never says "Ready":
// it keeps the spinner + "Loading" until it is gone. fade-out is added at once and
// removal rides transitionend with a timeout fallback, so a throttled/background tab
// (stretched timers, no transition events) cannot leave a faded-but-present overlay.
const REMOVE_FALLBACK_MS = 500;

export function dismissPreloader(preloader) {
  if (!preloader) return;
  const remove = () => preloader.remove();
  preloader.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, REMOVE_FALLBACK_MS);
  preloader.classList.add('fade-out');
}
