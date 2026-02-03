/**
 * Keyframe origin constants - indicates how a keyframe was created
 *
 * PERMANENT: Start (frame=0) and end (frame=duration) keyframes that define boundaries
 * USER: User-created keyframes via drag/edit operations
 * TRIM: Auto-created keyframes when trimming segments
 */
export const KeyframeOrigin = {
  PERMANENT: 'permanent',
  USER: 'user',
  TRIM: 'trim',
};

export default KeyframeOrigin;
