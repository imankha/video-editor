import React from 'react';

/**
 * NotesOverlay - Displays clip name and notes as text overlay on the video
 *
 * Styling per spec:
 * - Position: absolute, top of video
 * - Background: white (95% opacity)
 * - Text: black
 * - Width: 80% centered
 * - Rounded corners
 * - Name: centered, first line, bold
 * - Notes: below name
 * - More vertical padding in fullscreen mode
 *
 * Only visible when playhead is in a clip region with a name or notes.
 */
export function NotesOverlay({ name, notes, isVisible, isFullscreen = false }) {
  if (!isVisible || (!name && !notes)) {
    return null;
  }

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
      }}
    >
      {name && (
        <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: notes ? '4px' : 0 }}>
          {name}
        </div>
      )}
      {notes && <div>{notes}</div>}
    </div>
  );
}

export default NotesOverlay;
