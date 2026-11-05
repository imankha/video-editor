import { RAG_STYLES } from './journeyTargets';

// T14900: the one RAG chip of the admin screen. The underline keeps the mark readable
// without colour; grey and partial are dashed because they are not a verdict.
export function RagChip({ rag, text, title, testId }) {
  return (
    <span
      data-testid={testId}
      data-rag={rag}
      title={title}
      className={`inline-block border-b-2 text-xs font-semibold tabular-nums ${RAG_STYLES[rag].chip}`}
    >
      {text}
    </span>
  );
}
