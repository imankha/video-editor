import React from 'react';

/**
 * PlayheadHandle — the dot OR the sport glyph, centred on the track, pointer-
 * transparent (T6320, extracted from VideoControls' T5130 scrub handle).
 *
 * Store-free. Callers resolve the sport and pass a plain glyph string — this
 * component never reads a store and never fabricates a fallback sport; absent
 * `glyph` always renders the plain dot (T5130 rule: unknown sport -> dot, never
 * a hardcoded sport emoji).
 */
export function PlayheadHandle({ progress, glyph, size, dotClassName = 'bg-purple-500' }) {
  const left = `calc(${progress}% - ${size.box / 2}px)`;

  if (glyph) {
    return (
      <div
        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center leading-none pointer-events-none select-none transition-all duration-100"
        style={{ fontSize: size.font, width: size.box, height: size.box, left }}
        aria-hidden="true"
        data-testid="scrub-handle-glyph"
      >
        {glyph}
      </div>
    );
  }

  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 rounded-full ${dotClassName} transition-all duration-100`}
      style={{ width: size.box, height: size.box, left }}
    />
  );
}

export default PlayheadHandle;
