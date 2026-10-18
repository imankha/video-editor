import { useMemo, useState } from 'react';
import FloatingCoach from './FloatingCoach';
import InstructionCoach from './InstructionCoach';
import { GuideFocusContext } from './guideFocusStore';
import BesideGuide from './BesideGuide';

/** Inline cards (dialogs, viewers) get Got it too: dismissed for this mount only, view state, never grabs focus. */
function InlineGuide({ guideId, children }) {
  const [dismissed, setDismissed] = useState(false);
  const value = useMemo(() => ({ guideId, grabFocus: false, acknowledge: () => setDismissed(true) }), [guideId]);
  if (dismissed) return null;
  return <div className="px-3 pb-2"><GuideFocusContext.Provider value={value}>{children}</GuideFocusContext.Provider></div>;
}

/**
 * T12230: the one mount for a resolved guide. Screens pass the result of
 * resolveGuide(facts); the anchor, phase and message all come from that one
 * object so they cannot disagree. `phaseKey` re-measures the host when the
 * guide stays the same rule but its subject changes; `children` replaces the
 * default title/body body (Focus draws its numbered step chip).
 */
export default function Guide({ guide, phaseKey, testId = 'instruction-guide', inline = false, beside = false, children }) {
  if (!guide) return null;
  const body = children ?? (
    <InstructionCoach data-testid={testId} phase={guide.phase} tone={guide.tone} offCta={guide.cta} compact={guide.compact}>
      <p className={`${guide.compact ? 'text-sm' : 'text-base'} font-semibold leading-snug`}>{guide.message.title}</p>
      {guide.message.body && <p className="mt-2 text-sm text-gray-300">{guide.message.body}</p>}
    </InstructionCoach>
  );
  // T12270: `inline` sits in normal flow (inside a player's own action bar), where a
  // floating coach would be hidden by the player's dialog layer.
  // `beside`: a dialog's card goes off to the side of the dialog (its [data-guide-panel]), level with the guide's anchor; inline when there is no room.
  if (inline && beside && guide.gotIt !== false) return <BesideGuide key={guide.id} guideId={guide.id} anchorTarget={guide.anchor.target}>{body}</BesideGuide>;
  if (inline) return guide.gotIt === false ? <div className="px-3 pb-2">{body}</div> : <InlineGuide key={guide.id} guideId={guide.id}>{body}</InlineGuide>;
  return (
    <FloatingCoach guideId={guide.id} end={guide.end} gotIt={guide.gotIt !== false} tone={guide.tone} keepClear={guide.keepClear} shadeClear={guide.shadeClear} phase={phaseKey ?? guide.phase} target={guide.anchor.target} avoid={guide.avoid} fallbackTarget={guide.anchor.fallback}>
      {body}
    </FloatingCoach>
  );
}
