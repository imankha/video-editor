import FloatingCoach from './FloatingCoach';
import InstructionCoach from './InstructionCoach';

/**
 * T12230: the one mount for a resolved guide. Screens pass the result of
 * resolveGuide(facts); the anchor, phase and message all come from that one
 * object so they cannot disagree. `phaseKey` re-measures the host when the
 * guide stays the same rule but its subject changes; `children` replaces the
 * default title/body body (Focus draws its numbered step chip).
 */
export default function Guide({ guide, phaseKey, testId = 'instruction-guide', children }) {
  if (!guide) return null;
  return (
    <FloatingCoach phase={phaseKey ?? guide.phase} target={guide.anchor.target} fallbackTarget={guide.anchor.fallback}>
      {children ?? (
        <InstructionCoach data-testid={testId} phase={guide.phase} tone={guide.tone}>
          <p className="text-base font-semibold leading-snug">{guide.message.title}</p>
          {guide.message.body && <p className="mt-2 text-sm text-gray-300">{guide.message.body}</p>}
        </InstructionCoach>
      )}
    </FloatingCoach>
  );
}
