import { RAG_STYLES } from './journeyTargets';

// T14900: the one RAG chip of the admin screen. The underline keeps the mark readable
// without colour; grey and partial are dashed because they are not a verdict.
// T14910: `confidence` ("settled" | "provisional" | null) renders a provisional figure in
// italics with a 1 px underline and sets data-confidence, so the uncertainty never relies
// on italics alone (the interval is printed beside the value and in the title).
export function RagChip({ rag, text, title, testId, confidence = null }) {
  const provisional = confidence === 'provisional';
  return (
    <span
      data-testid={testId}
      data-rag={rag}
      data-confidence={confidence || undefined}
      title={title}
      className={`inline-block text-xs font-semibold tabular-nums ${provisional ? 'italic border-b' : 'border-b-2'} ${RAG_STYLES[rag].chip}`}
    >
      {text}
    </span>
  );
}
