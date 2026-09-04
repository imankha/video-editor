import React from 'react';

/**
 * OverlayEffectIllustration (T8520)
 *
 * A self-contained, bundled SVG that SHOWS what the Overlay (spotlight) step does,
 * so the completion-choice card can sell a step the user has never seen. It depicts
 * both capabilities at once:
 *   1. a glowing CYAN spotlight ring tracking around a stylized athlete silhouette
 *   2. an on-video text label chip ("GOAL")
 *
 * Fully inline SVG — NO network, no CDN still, no autoplay policy fight. A fixed
 * viewBox (16:9) means it never causes layout shift while the card mounts; wrap it
 * in an `aspect-video` box (ConfirmationDialog already does) and it reads clearly at
 * 390px card width.
 *
 * Cyan accent stays consistent with the app's reel accent (cyan-400/500).
 */
export function OverlayEffectIllustration() {
  return (
    <svg
      viewBox="0 0 320 180"
      className="h-full w-full"
      role="img"
      aria-label="Preview of the spotlight effect: a glowing ring highlights your athlete with an on-video label."
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* Soft cyan glow for the tracking ring */}
        <radialGradient id="rb-spotlight-glow" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.35" />
        </radialGradient>
        <filter id="rb-ring-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>

      {/* "Video" backdrop — a dim pitch/court gradient */}
      <rect width="320" height="180" fill="#0b1220" />
      <rect width="320" height="180" fill="url(#rb-spotlight-glow)" />

      {/* Ground line for grounding the figure */}
      <line x1="0" y1="150" x2="320" y2="150" stroke="#1e293b" strokeWidth="2" />

      {/* Glowing cyan spotlight ring tracking the athlete */}
      <g>
        <circle
          cx="150"
          cy="96"
          r="58"
          fill="none"
          stroke="#22d3ee"
          strokeWidth="6"
          opacity="0.55"
          filter="url(#rb-ring-blur)"
        />
        <circle
          cx="150"
          cy="96"
          r="52"
          fill="none"
          stroke="#67e8f9"
          strokeWidth="3"
          strokeDasharray="150 90"
        />
      </g>

      {/* Stylized athlete silhouette (running pose) */}
      <g fill="#e2e8f0">
        {/* head */}
        <circle cx="150" cy="58" r="11" />
        {/* torso */}
        <path d="M150 70 L150 108 L146 130 L156 130 L154 108 Z" />
        {/* leading arm */}
        <path d="M150 78 L172 72 L174 78 L152 86 Z" />
        {/* trailing arm */}
        <path d="M150 82 L130 92 L132 98 L152 90 Z" />
        {/* front leg */}
        <path d="M150 108 L168 132 L162 138 L146 116 Z" />
        {/* back leg */}
        <path d="M150 108 L134 138 L128 134 L144 112 Z" />
      </g>

      {/* On-video text label chip */}
      <g>
        <rect
          x="196"
          y="40"
          rx="7"
          ry="7"
          width="66"
          height="26"
          fill="#0891b2"
          stroke="#67e8f9"
          strokeWidth="1.5"
        />
        <text
          x="229"
          y="58"
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="system-ui, sans-serif"
        >
          GOAL
        </text>
      </g>
    </svg>
  );
}

export default OverlayEffectIllustration;
