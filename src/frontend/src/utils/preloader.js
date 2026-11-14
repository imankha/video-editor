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

// T16400: when the server gives no answer, the loading screen says so and offers Retry
// instead of spinning forever. Resolves when the user presses Retry; the screen goes back
// to "Connecting to server..." while the caller asks again (same page, no reload).
export function showPreloaderRetry() {
  const preloader = document.getElementById('preloader');
  if (!preloader) return Promise.resolve();
  const bar = document.getElementById('preloader-bar');
  const status = document.getElementById('preloader-status');
  if (bar) bar.style.display = 'none';
  if (status) status.textContent = 'Still connecting. Check your connection, then press Retry.';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'preloader-retry';
  button.textContent = 'Retry';
  button.style.cssText = 'padding:8px 20px;border-radius:8px;border:0;background:#7c3aed;color:#fff;'
    + "font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer";
  return new Promise((resolve) => {
    button.addEventListener('click', () => {
      button.remove();
      if (bar) bar.style.display = '';
      if (status) status.textContent = 'Connecting to server...';
      resolve();
    }, { once: true });
    (document.getElementById('preloader-progress') || preloader).appendChild(button);
  });
}
