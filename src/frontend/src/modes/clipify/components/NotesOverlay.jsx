import React from 'react';

/**
 * NotesOverlay - Displays clip notes as text overlay on the video
 *
 * Styling per spec:
 * - Position: absolute, top of video
 * - Background: white (95% opacity)
 * - Text: black
 * - Width: 80% centered
 * - Rounded corners
 *
 * Only visible when playhead is in a clip region with non-empty notes.
 */
export function NotesOverlay({ notes, isVisible }) {
  if (!isVisible || !notes) {
    return null;
  }

  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 w-4/5 max-w-2xl z-50 pointer-events-none"
      style={{
        // Using inline styles for precise control per spec
        background: 'rgba(255, 255, 255, 0.95)',
        color: '#000000',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        lineHeight: '1.4',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
      }}
    >
      {notes}
    </div>
  );
}

export default NotesOverlay;
