/**
 * Spinner - the one shared loading spinner (T4560).
 *
 * Draws in currentColor, so the caller's text color sets its color.
 * Props:
 * - size: pixel width/height (default 16)
 * - className: extra classes (e.g. a text color)
 */
export function Spinner({ size = 16, className = '' }) {
  return (
    <svg
      className={['animate-spin', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-spinner=""
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default Spinner;
