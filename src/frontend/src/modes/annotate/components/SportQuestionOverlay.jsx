import { SUPPORTED_SPORTS, sportEmoji } from '../constants/tagRegistry';

/**
 * SportQuestionOverlay (T8140) — the single full-screen "What sport is this?"
 * question shown once at a mobile user's first clip save while their profile is
 * still `no_sport`. TurboTax-style: one question, big tap targets, dismissible.
 *
 * Replaces the amber in-form no_sport warning (and T7922's in-form picker) for
 * the mobile first-save path so the Add Clip form itself stays a clean one-tap
 * surface. Picking a sport persists via the EXISTING profile-sport gesture
 * (`updateProfile`, wired by the caller) — no new write path. "Skip for now"
 * proceeds without setting a sport (the clip is already saved), so this can
 * never become a new dead-end.
 */
export function SportQuestionOverlay({ onPick, onSkip }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-gray-950/95 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="What sport is this?"
    >
      <div className="w-full max-w-md">
        <h2 className="text-2xl font-bold text-white text-center mb-2">What sport is this?</h2>
        <p className="text-gray-400 text-center text-sm mb-6">
          Pick your sport to unlock its tags. You can change it later.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {SUPPORTED_SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="flex items-center gap-3 min-h-[56px] px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500 text-white text-left transition-colors"
            >
              <span className="text-2xl leading-none" aria-hidden>{sportEmoji(s.id)}</span>
              <span className="font-semibold">{s.name}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onSkip}
          className="mt-6 w-full text-center text-gray-400 hover:text-gray-200 text-sm py-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

export default SportQuestionOverlay;
