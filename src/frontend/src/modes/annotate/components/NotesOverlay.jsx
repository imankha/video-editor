import React from 'react';

// Rating notation symbols (chess-inspired)
const RATING_NOTATION = {
  1: '??',  // Blunder
  2: '?',   // Mistake
  3: '!?',  // Interesting
  4: '!',   // Good
  5: '!!'   // Brilliant
};

// Rating colors for border (matching ClipRegionLayer)
const RATING_COLORS = {
  1: '#C62828',  // Red - Blunder
  2: '#F9A825',  // Amber - Mistake
  3: '#1565C0',  // Blue - Interesting
  4: '#2E7D32',  // Green - Good
  5: '#66BB6A',  // Light Green - Brilliant
};

/**
 * NotesOverlay - Displays clip name, rating notation, and notes as text overlay on the video
 *
 * Styling per spec:
 * - Position: absolute, top of video
 * - Background: white (95% opacity) with colored border
 * - Border color matches rating (red→amber→blue→green→light green)
 * - Text: black
 * - Width: 80% centered
 * - Rounded corners
 * - Rating notation + Name: centered, first line, bold
 * - Notes: below name
 * - More vertical padding in fullscreen mode
 *
 * Only visible when playhead is in a clip region with a name or notes.
 */
export function NotesOverlay({ name, notes, rating, isVisible, isFullscreen = false }) {
  if (!isVisible || (!name && !notes)) {
    return null;
  }

  const notation = rating ? RATING_NOTATION[rating] || '' : '';
  const borderColor = rating ? RATING_COLORS[rating] || RATING_COLORS[3] : RATING_COLORS[3];

  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 w-4/5 max-w-2xl z-50 pointer-events-none ${
        isFullscreen ? 'top-16' : 'top-2'
      }`}
      style={{
        // Using inline styles for precise control per spec
        background: 'rgba(255, 255, 255, 0.95)',
        color: '#000000',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        lineHeight: '1.4',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        border: `4px solid ${borderColor}`,
      }}
    >
      {name && (
        <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: notes ? '4px' : 0 }}>
          {notation && <span style={{ marginRight: '6px', color: '#666' }}>{notation}</span>}
          {name}
        </div>
      )}
      {notes && <div>{notes}</div>}
    </div>
  );
}

export default NotesOverlay;
