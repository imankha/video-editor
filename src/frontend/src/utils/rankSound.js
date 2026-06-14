/**
 * Endorphin "pop" for the ranking game (T3630, decision #5). A short Web-Audio
 * blip synthesized on the fly — no asset to load. Lazily creates one shared
 * AudioContext (created on the first user gesture, satisfying autoplay policy).
 */

let _ctx = null;

function getCtx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  _ctx = new AC();
  return _ctx;
}

/**
 * Play a soft rising pop. No-op when muted or Web Audio is unavailable.
 * @param {boolean} enabled - the user's rankSoundEnabled pref
 */
export function playPop(enabled) {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(720, now + 0.09);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}
