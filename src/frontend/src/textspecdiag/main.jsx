import { useState } from 'react';
import { createRoot } from 'react-dom/client';
// Tailwind utilities: without this every layout/colour class renders inert.
import '../index.css';
import { TextSpecEditor } from '../components/textspec/TextSpecEditor';
import { COLOR_SWATCHES } from '../components/introcards/introCardEditorConstants';

/**
 * T6480 -- DEV-ONLY real-browser harness proving the SHARED TextSpecEditor reads
 * with adequate contrast in BOTH hosts. The component is dark-surface tuned
 * (text-gray-400 labels, gray-800 inputs, amber footer); the fix keeps the
 * component untouched and gives the OVERLAY host a dark panel (matching the card
 * editor), instead of darkening the component and inverting the bug in the card
 * editor.
 *
 * Panels are given stable data-testids so the Playwright spec can screenshot each
 * and sanity-check the applied surface colour.
 */

const DEFAULT_SPEC = {
  text: 'GOAL',
  font: 'anton',
  size: 0.08,
  color: '#FFFFFF',
  align: 'center',
  position: { x: 0.5, y: 0.5 },
  maxWidth: 0.8,
  shadow: { blur: 0.05, color: '#000000', opacity: 0.5 },
  stroke: { width: 0.01, color: '#000000' },
  animation: 'none',
};

function OverlayHostPanel({ variant, spec, onChange }) {
  // BEFORE = the shipped light-glass surface that caused bright-on-bright.
  // AFTER  = the T6480 dark-glass surface.
  const surface =
    variant === 'before'
      ? 'bg-white/10 border-white/20'
      : 'bg-gray-900/85 border-gray-700';
  return (
    <div
      data-testid={`overlay-${variant}`}
      className={`${surface} backdrop-blur-lg rounded-lg p-3 lg:p-4 border`}
      style={{ width: 340 }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white">
          Edit Text ({variant === 'before' ? 'BEFORE - light' : 'AFTER - dark'})
        </h3>
        <button className="text-gray-400 hover:text-white text-xs">Done</button>
      </div>
      <TextSpecEditor spec={spec} onChange={onChange} />
    </div>
  );
}

function CardHostPanel({ spec, onChange }) {
  // Mirrors the card editor rail surface + its opt-in props (T5205).
  return (
    <div
      data-testid="card-host"
      className="bg-gray-800 border border-gray-700 rounded-lg p-4"
      style={{ width: 340 }}
    >
      <h3 className="text-sm font-medium text-white mb-2">Card editor (dark, unchanged)</h3>
      <TextSpecEditor
        spec={spec}
        onChange={onChange}
        hideText
        hideSize
        hideAlign
        hideFooterNote
        collapseEffects
        colorSwatches={COLOR_SWATCHES}
      />
    </div>
  );
}

function Harness() {
  const [specA, setSpecA] = useState(DEFAULT_SPEC);
  const [specB, setSpecB] = useState(DEFAULT_SPEC);
  const [specC, setSpecC] = useState(DEFAULT_SPEC);
  return (
    <div className="p-6 flex flex-wrap gap-6 items-start">
      <OverlayHostPanel variant="before" spec={specA} onChange={setSpecA} />
      <OverlayHostPanel variant="after" spec={specB} onChange={setSpecB} />
      <CardHostPanel spec={specC} onChange={setSpecC} />
    </div>
  );
}

createRoot(document.getElementById('textspecdiag-root')).render(<Harness />);
