import { useRef } from 'react';

/**
 * Reusable 3-position toggle switch component
 *
 * Cycling behavior:
 * - Clicking position 0 or 2 → moves to position 1 (middle)
 * - Clicking position 1 → moves to the OPPOSITE of where it came from
 *
 * @param {number} value - Current position (0, 1, or 2)
 * @param {function} onChange - Callback with new position
 * @param {string[]} colors - Array of 3 Tailwind bg colors for each position
 * @param {string[]} labels - Array of 3 aria-labels for accessibility
 * @param {boolean} disabled - Whether the toggle is disabled
 */
export default function ThreePositionToggle({
  value = 0,
  onChange,
  colors = ['bg-blue-600', 'bg-yellow-600', 'bg-purple-600'],
  labels = ['Position 1', 'Position 2', 'Position 3'],
  disabled = false
}) {
  const previousPositionRef = useRef(0);

  const handleClick = (targetPosition) => {
    const current = value;

    if (current === targetPosition) {
      // Clicking the current position - cycle
      if (current === 0) {
        // Position 0 → Position 1
        previousPositionRef.current = 0;
        onChange(1);
      } else if (current === 1) {
        // Position 1 → go to OPPOSITE of where we came from
        const previous = previousPositionRef.current;
        const nextPosition = previous === 0 ? 2 : 0;
        previousPositionRef.current = 1;
        onChange(nextPosition);
      } else if (current === 2) {
        // Position 2 → Position 1
        previousPositionRef.current = 2;
        onChange(1);
      }
    } else {
      // Clicking a different position - move directly there
      previousPositionRef.current = current;
      onChange(targetPosition);
    }
  };

  const translateClass =
    value === 0 ? 'translate-x-1' :
    value === 1 ? 'translate-x-8' :
    'translate-x-[3.75rem]';

  return (
    <div
      className={`relative inline-flex h-7 w-20 items-center rounded-full transition-colors focus:outline-none ${
        colors[value]
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* Clickable zones for each position */}
      <button
        onClick={() => handleClick(0)}
        disabled={disabled}
        className="absolute left-0 h-full w-1/3 z-10 focus:outline-none"
        aria-label={labels[0]}
      />
      <button
        onClick={() => handleClick(1)}
        disabled={disabled}
        className="absolute left-1/3 h-full w-1/3 z-10 focus:outline-none"
        aria-label={labels[1]}
      />
      <button
        onClick={() => handleClick(2)}
        disabled={disabled}
        className="absolute right-0 h-full w-1/3 z-10 focus:outline-none"
        aria-label={labels[2]}
      />

      {/* Sliding indicator (white dot) */}
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${translateClass}`}
      />
    </div>
  );
}
