interface IllustrationProps {
  className?: string;
}

function Player({ cx, cy, jersey, shorts, scale = 1, opacity = 1, shadow = false }: {
  cx: number; cy: number; jersey: string; shorts: string; scale?: number; opacity?: number; shadow?: boolean;
}) {
  const s = scale;
  return (
    <g opacity={opacity}>
      {shadow && <ellipse cx={cx} cy={cy + 18 * s} rx={6 * s} ry={2 * s} fill="black" opacity="0.2" />}
      {/* Legs */}
      <line x1={cx - 3 * s} y1={cy + 6 * s} x2={cx - 4 * s} y2={cy + 15 * s} stroke={shorts} strokeWidth={2.5 * s} strokeLinecap="round" />
      <line x1={cx + 3 * s} y1={cy + 6 * s} x2={cx + 4 * s} y2={cy + 15 * s} stroke={shorts} strokeWidth={2.5 * s} strokeLinecap="round" />
      {/* Feet */}
      <circle cx={cx - 4 * s} cy={cy + 16 * s} r={1.8 * s} fill="#1a1a2e" />
      <circle cx={cx + 4 * s} cy={cy + 16 * s} r={1.8 * s} fill="#1a1a2e" />
      {/* Body/jersey */}
      <rect x={cx - 6 * s} y={cy - 6 * s} width={12 * s} height={13 * s} rx={3 * s} fill={jersey} />
      {/* Head */}
      <circle cx={cx} cy={cy - 10 * s} r={5 * s} fill="#f5d0a9" />
      {/* Hair */}
      <ellipse cx={cx} cy={cy - 14 * s} rx={5 * s} ry={2.5 * s} fill="#3b2314" />
    </g>
  );
}

export function LearnIllustration({ className = '' }: IllustrationProps) {
  return (
    <div className={`relative w-full aspect-[16/10] bg-slate-800/60 rounded-2xl border border-white/10 overflow-hidden ${className}`}>
      <svg viewBox="0 0 640 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <linearGradient id="learnTimelineGrad" x1="55" y1="0" x2="255" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0891b2" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="grassGrad" x1="0" y1="32" x2="0" y2="310" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#166534" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
          <clipPath id="fieldClip">
            <rect x="42" y="32" width="556" height="280" rx="10" />
          </clipPath>
          <filter id="glowCyan" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Video frame */}
        <rect x="40" y="30" width="560" height="282" rx="12" fill="#1a1a2e" stroke="#334155" strokeWidth="1.5" />

        {/* Field with gradient */}
        <g clipPath="url(#fieldClip)">
          <rect x="42" y="32" width="556" height="280" fill="url(#grassGrad)" />
          {/* Grass texture stripes */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <rect key={i} x="42" y={32 + i * 35} width="556" height="17" fill="#15803d" opacity="0.15" />
          ))}
          {/* Halfway line */}
          <line x1="320" y1="32" x2="320" y2="312" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
          {/* Center circle */}
          <circle cx="320" cy="172" r="40" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none" />
          <circle cx="320" cy="172" r="3" fill="rgba(255,255,255,0.25)" />
          {/* Penalty box left */}
          <rect x="42" y="110" width="90" height="124" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          <rect x="42" y="140" width="40" height="64" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          {/* Penalty box right */}
          <rect x="508" y="110" width="90" height="124" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          <rect x="558" y="140" width="40" height="64" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
          {/* Goal lines */}
          <rect x="42" y="155" width="8" height="34" rx="2" fill="rgba(255,255,255,0.12)" />
          <rect x="590" y="155" width="8" height="34" rx="2" fill="rgba(255,255,255,0.12)" />

          {/* Ball */}
          <circle cx="285" cy="195" r="4" fill="white" opacity="0.9" />
          <circle cx="285" cy="195" r="4" fill="none" stroke="#ccc" strokeWidth="0.5" />

          {/* Team A (blue jerseys) */}
          <Player cx={120} cy={165} jersey="#1e40af" shorts="#1e3a5f" scale={0.9} shadow />
          <Player cx={180} cy={120} jersey="#1e40af" shorts="#1e3a5f" scale={0.85} shadow />
          <Player cx={200} cy={220} jersey="#1e40af" shorts="#1e3a5f" scale={0.85} shadow />
          <Player cx={260} cy={170} jersey="#1e40af" shorts="#1e3a5f" scale={0.9} shadow />

          {/* Team B (white jerseys) */}
          <Player cx={350} cy={150} jersey="#e2e8f0" shorts="#334155" scale={0.85} shadow />
          <Player cx={400} cy={200} jersey="#e2e8f0" shorts="#334155" scale={0.85} shadow />
          <Player cx={440} cy={140} jersey="#e2e8f0" shorts="#334155" scale={0.85} shadow />
          <Player cx={480} cy={190} jersey="#e2e8f0" shorts="#334155" scale={0.85} shadow />

          {/* THE highlighted player (cyan glow) */}
          <Player cx={300} cy={185} jersey="#06b6d4" shorts="#0e7490" scale={1.1} shadow />
          {/* Highlight ring */}
          <circle cx={300} cy={185} r={22} stroke="#06b6d4" strokeWidth="2" fill="none" opacity="0.5" filter="url(#glowCyan)" />
        </g>

        {/* Annotation callout line */}
        <line x1={315} y1={175} x2={430} y2={100} stroke="#06b6d4" strokeWidth="2" strokeDasharray="5 3" opacity="0.8" />
        <circle cx={315} cy={175} r="3" fill="#06b6d4" />

        {/* Annotation bubble */}
        <rect x="420" y="60" width="170" height="80" rx="12" fill="#0c4a6e" fillOpacity="0.92" stroke="#06b6d4" strokeWidth="1.5" />
        {/* Bubble pointer */}
        <polygon points="430,140 440,140 428,152" fill="#0c4a6e" fillOpacity="0.92" />
        <line x1="428" y1="140" x2="428" y2="152" stroke="#06b6d4" strokeWidth="1.5" />
        {/* Title line */}
        <rect x="434" y="74" width="80" height="7" rx="3.5" fill="#67e8f9" opacity="0.85" />
        {/* Annotation text lines */}
        <rect x="434" y="90" width="142" height="5" rx="2.5" fill="#a5f3fc" opacity="0.35" />
        <rect x="434" y="100" width="130" height="5" rx="2.5" fill="#a5f3fc" opacity="0.35" />
        <rect x="434" y="110" width="100" height="5" rx="2.5" fill="#a5f3fc" opacity="0.35" />
        {/* Timestamp badge */}
        <rect x="530" y="72" width="48" height="14" rx="4" fill="#164e63" />
        <rect x="536" y="76" width="36" height="6" rx="3" fill="#22d3ee" opacity="0.5" />

        {/* Video controls bar */}
        <rect x="40" y="316" width="560" height="52" rx="0" fill="#0f172a" />
        <rect x="40" y="316" width="560" height="1" fill="#1e293b" />

        {/* Play button */}
        <circle cx="72" cy="342" r="14" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        <path d="M67,335 L67,349 L79,342Z" fill="#94a3b8" />

        {/* Time text placeholder */}
        <rect x="94" y="338" width="52" height="8" rx="3" fill="#475569" opacity="0.6" />

        {/* Timeline track */}
        <rect x="158" y="337" width="380" height="10" rx="5" fill="#1e293b" />
        <rect x="158" y="337" width="150" height="10" rx="5" fill="url(#learnTimelineGrad)" />
        {/* Annotation markers on timeline */}
        <rect x="210" y="332" width="2" height="20" rx="1" fill="#06b6d4" opacity="0.6" />
        <rect x="280" y="332" width="2" height="20" rx="1" fill="#06b6d4" opacity="0.6" />
        <rect x="410" y="332" width="2" height="20" rx="1" fill="#06b6d4" opacity="0.4" />
        {/* Playhead */}
        <rect x="305" y="331" width="4" height="22" rx="2" fill="#06b6d4" />
        <circle cx="307" cy="342" r="6" fill="#06b6d4" />

        {/* Volume icon area */}
        <rect x="548" y="338" width="40" height="8" rx="3" fill="#334155" opacity="0.5" />

        {/* Top bar - video title */}
        <rect x="40" y="30" width="560" height="1" fill="#334155" />
      </svg>
    </div>
  );
}

export function ElevateIllustration({ className = '' }: IllustrationProps) {
  return (
    <div className={`relative w-full aspect-[16/10] bg-slate-800/60 rounded-2xl border border-white/10 overflow-hidden ${className}`}>
      <svg viewBox="0 0 640 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <linearGradient id="fieldGrad2" x1="0" y1="50" x2="0" y2="240" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#166534" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
          <linearGradient id="phoneFieldGrad" x1="0" y1="50" x2="0" y2="370" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#15803d" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
          <clipPath id="srcClip"><rect x="32" y="52" width="266" height="168" rx="8" /></clipPath>
          <clipPath id="phoneClip"><rect x="412" y="48" width="156" height="304" rx="14" /></clipPath>
          <filter id="glowPink" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="phoneShadow" x="-20%" y="-5%" width="140%" height="115%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <marker id="arrowPink" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="#f472b6" />
          </marker>
        </defs>

        {/* === LEFT: Wide angle source === */}
        <rect x="30" y="50" width="270" height="172" rx="10" fill="#0f172a" stroke="#334155" strokeWidth="1.5" />

        <g clipPath="url(#srcClip)">
          <rect x="32" y="52" width="266" height="168" fill="url(#fieldGrad2)" />
          {/* Grass stripes */}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <rect key={i} x="32" y={52 + i * 28} width="266" height="14" fill="white" opacity="0.04" />
          ))}
          {/* Field markings */}
          <line x1="165" y1="52" x2="165" y2="220" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          <circle cx="165" cy="136" r="25" stroke="rgba(255,255,255,0.15)" strokeWidth="1" fill="none" />
          {/* Penalty boxes */}
          <rect x="32" y="100" width="50" height="72" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          <rect x="248" y="100" width="50" height="72" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          {/* Goals */}
          <rect x="32" y="120" width="6" height="32" rx="1" fill="rgba(255,255,255,0.08)" />
          <rect x="292" y="120" width="6" height="32" rx="1" fill="rgba(255,255,255,0.08)" />

          {/* Scattered players - Team A */}
          <Player cx={80} cy={130} jersey="#1e40af" shorts="#1e3a5f" scale={0.6} shadow />
          <Player cx={120} cy={160} jersey="#1e40af" shorts="#1e3a5f" scale={0.55} shadow />
          <Player cx={140} cy={110} jersey="#1e40af" shorts="#1e3a5f" scale={0.55} shadow />
          <Player cx={210} cy={140} jersey="#1e40af" shorts="#1e3a5f" scale={0.55} shadow />

          {/* Team B */}
          <Player cx={100} cy={170} jersey="#e2e8f0" shorts="#475569" scale={0.55} shadow />
          <Player cx={190} cy={115} jersey="#e2e8f0" shorts="#475569" scale={0.55} shadow />
          <Player cx={230} cy={155} jersey="#e2e8f0" shorts="#475569" scale={0.55} shadow />
          <Player cx={250} cy={120} jersey="#e2e8f0" shorts="#475569" scale={0.55} shadow />

          {/* THE player - highlighted */}
          <Player cx={165} cy={140} jersey="#f472b6" shorts="#9d174d" scale={0.65} shadow />
          <circle cx={165} cy={140} r={16} stroke="#f472b6" strokeWidth="2" fill="none" opacity="0.5" filter="url(#glowPink)" />

          {/* Ball */}
          <circle cx={172} cy={155} r="2.5" fill="white" />
        </g>

        {/* Crop rectangle overlay on source */}
        <rect x="137" y="55" width="56" height="162" rx="3"
          stroke="#f472b6" strokeWidth="2.5" fill="#f472b6" fillOpacity="0.05" />
        {/* Corner handles */}
        <rect x="134" y="52" width="8" height="8" rx="1.5" fill="#f472b6" />
        <rect x="185" y="52" width="8" height="8" rx="1.5" fill="#f472b6" />
        <rect x="134" y="212" width="8" height="8" rx="1.5" fill="#f472b6" />
        <rect x="185" y="212" width="8" height="8" rx="1.5" fill="#f472b6" />
        {/* Dimmed areas outside crop */}
        <rect x="32" y="52" width="105" height="168" fill="black" opacity="0.35" />
        <rect x="193" y="52" width="105" height="168" fill="black" opacity="0.35" />

        {/* Source label */}
        <text x="165" y="240" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="system-ui">Wide-angle game footage</text>

        {/* === ARROW === */}
        <g>
          {/* Curved arrow path */}
          <path d="M310,136 C340,136 360,100 390,100" stroke="#f472b6" strokeWidth="2" fill="none"
            strokeDasharray="6 3" markerEnd="url(#arrowPink)" />
          <path d="M310,136 C340,136 360,172 390,172" stroke="#f472b6" strokeWidth="2" fill="none"
            strokeDasharray="6 3" markerEnd="url(#arrowPink)" />

          {/* Transform labels */}
          <rect x="330" y="116" width="42" height="16" rx="4" fill="#831843" fillOpacity="0.8" />
          <text x="351" y="128" textAnchor="middle" fill="#f9a8d4" fontSize="8" fontFamily="system-ui" fontWeight="600">CROP</text>
          <rect x="330" y="140" width="42" height="16" rx="4" fill="#4c1d95" fillOpacity="0.8" />
          <text x="351" y="152" textAnchor="middle" fill="#c4b5fd" fontSize="8" fontFamily="system-ui" fontWeight="600">AI 4K</text>
        </g>

        {/* === RIGHT: Phone with vertical result === */}
        {/* Phone shadow */}
        <rect x="400" y="35" width="180" height="330" rx="24" fill="black" opacity="0.3" filter="url(#phoneShadow)" />
        {/* Phone body */}
        <rect x="400" y="30" width="180" height="340" rx="22" fill="#0f172a" stroke="#475569" strokeWidth="2" />
        {/* Notch */}
        <rect x="460" y="34" width="60" height="8" rx="4" fill="#1e293b" />

        {/* Screen content */}
        <g clipPath="url(#phoneClip)">
          <rect x="412" y="48" width="156" height="304" fill="url(#phoneFieldGrad)" />
          {/* Grass stripes */}
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <rect key={i} x="412" y={48 + i * 34} width="156" height="17" fill="white" opacity="0.04" />
          ))}
          {/* Vertical field lines */}
          <line x1="412" y1="200" x2="568" y2="200" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle cx="490" cy="200" r="20" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />

          {/* Zoomed player - big and centered */}
          <Player cx={490} cy={190} jersey="#f472b6" shorts="#9d174d" scale={1.8} shadow />

          {/* Nearby opponent */}
          <Player cx={525} cy={220} jersey="#e2e8f0" shorts="#475569" scale={1.2} opacity={0.7} shadow />

          {/* Ball */}
          <circle cx={500} cy={215} r="5" fill="white" />
          <path d="M497,213 a5,5 0 0,1 6,0" stroke="#ccc" strokeWidth="0.5" fill="none" />

          {/* Social overlay at bottom */}
          <rect x="412" y="310" width="156" height="42" fill="black" fillOpacity="0.4" />
          {/* Player name bar */}
          <rect x="422" y="318" width="80" height="8" rx="4" fill="white" opacity="0.8" />
          <rect x="422" y="330" width="50" height="6" rx="3" fill="white" opacity="0.3" />
          {/* Like/share icons */}
          <circle cx="540" cy="322" r="8" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
          <circle cx="540" cy="340" r="8" fill="none" stroke="white" strokeWidth="1" opacity="0.5" />
        </g>

        {/* Home indicator */}
        <rect x="462" y="358" width="56" height="4" rx="2" fill="#475569" />

        {/* Sparkle/quality indicators */}
        <g opacity="0.8">
          {/* Sparkle top-right */}
          <path d="M592,50 l3,-10 3,10 -10,-3 10,0 -10,3z" fill="#fbbf24" />
          <path d="M600,90 l2,-7 2,7 -7,-2 7,0 -7,2z" fill="#fbbf24" opacity="0.5" />
          {/* Sparkle bottom */}
          <path d="M598,310 l2,-8 2,8 -8,-2 8,0 -8,2z" fill="#a78bfa" />
          <path d="M390,55 l2,-7 2,7 -7,-2 7,0 -7,2z" fill="#06b6d4" opacity="0.6" />
          <path d="M588,200 l2,-6 2,6 -6,-2 6,0 -6,2z" fill="#f472b6" opacity="0.5" />
        </g>

        {/* Quality badge */}
        <rect x="555" y="360" width="65" height="22" rx="6" fill="#7c3aed" fillOpacity="0.9" stroke="#a78bfa" strokeWidth="0.5" />
        <text x="587" y="375" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" fontFamily="system-ui">AI 4K</text>
        <path d="M563,368 l2,3 5,-5" stroke="#a78bfa" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Result label */}
        <text x="490" y="393" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="system-ui">Social-ready vertical reel</text>
      </svg>
    </div>
  );
}

export function CelebrateIllustration({ className = '' }: IllustrationProps) {
  return (
    <div className={`relative w-full aspect-[16/10] bg-slate-800/60 rounded-2xl border border-white/10 overflow-hidden ${className}`}>
      <svg viewBox="0 0 640 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <linearGradient id="shareFieldGrad" x1="0" y1="50" x2="0" y2="360" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#15803d" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
          <linearGradient id="shareIgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f9ce34" />
            <stop offset="50%" stopColor="#ee2a7b" />
            <stop offset="100%" stopColor="#6228d7" />
          </linearGradient>
          <clipPath id="shareScreenClip"><rect x="262" y="58" width="116" height="270" rx="14" /></clipPath>
          <filter id="shareGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="shareCardShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Dotted share lines from phone to targets (behind everything) */}
        <path d="M262,150 C200,150 170,110 118,110" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" fill="none" />
        <path d="M262,235 C200,235 170,275 118,275" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" fill="none" />
        <path d="M378,130 C450,130 470,95 512,95" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" fill="none" />
        <path d="M378,193 C450,193 480,193 512,193" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" fill="none" />
        <path d="M378,256 C450,256 470,291 512,291" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" fill="none" />

        {/* === CENTER: phone with finished reel === */}
        <rect x="248" y="38" width="144" height="316" rx="22" fill="black" opacity="0.35" filter="url(#shareCardShadow)" />
        <rect x="250" y="36" width="140" height="316" rx="22" fill="#0f172a" stroke="#f472b6" strokeWidth="1.5" />
        <rect x="300" y="42" width="40" height="7" rx="3.5" fill="#1e293b" />

        <g clipPath="url(#shareScreenClip)">
          <rect x="262" y="58" width="116" height="270" fill="url(#shareFieldGrad)" />
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <rect key={i} x="262" y={58 + i * 38} width="116" height="19" fill="white" opacity="0.04" />
          ))}
          <line x1="262" y1="200" x2="378" y2="200" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle cx="320" cy="200" r="18" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
          {/* The player, centered + glowing */}
          <Player cx={320} cy={190} jersey="#f472b6" shorts="#9d174d" scale={1.7} shadow />
          <circle cx={320} cy={188} r={26} stroke="#f472b6" strokeWidth="2" fill="none" opacity="0.45" filter="url(#shareGlow)" />
          <circle cx={330} cy={214} r="4.5" fill="white" />
          {/* Name/overlay lower third */}
          <rect x="262" y="288" width="116" height="40" fill="black" fillOpacity="0.4" />
          <rect x="272" y="296" width="70" height="7" rx="3.5" fill="white" opacity="0.85" />
          <rect x="272" y="308" width="44" height="5" rx="2.5" fill="white" opacity="0.35" />
        </g>
        <rect x="306" y="340" width="28" height="4" rx="2" fill="#475569" />

        {/* Floating like hearts rising from the phone */}
        {[
          { x: 340, y: 120, s: 1, o: 0.9 },
          { x: 360, y: 90, s: 0.7, o: 0.6 },
          { x: 300, y: 100, s: 0.55, o: 0.5 },
        ].map((h, i) => (
          <path
            key={i}
            d={`M${h.x},${h.y} c${-4 * h.s},${-5 * h.s} ${-12 * h.s},${1 * h.s} 0,${9 * h.s} c${12 * h.s},${-8 * h.s} ${4 * h.s},${-14 * h.s} 0,${-9 * h.s} z`}
            fill="#fb7185"
            opacity={h.o}
          />
        ))}

        {/* === LEFT: people receiving it === */}
        {[
          { cx: 90, cy: 110, label: 'Grandma', ring: '#f472b6' },
          { cx: 90, cy: 275, label: 'Coach', ring: '#a78bfa' },
        ].map((p, i) => (
          <g key={i}>
            <circle cx={p.cx} cy={p.cy} r="24" fill="#1e293b" stroke={p.ring} strokeWidth="1.5" />
            <circle cx={p.cx} cy={p.cy - 5} r="8" fill="#94a3b8" />
            <path d={`M${p.cx - 13},${p.cy + 16} a13,11 0 0,1 26,0`} fill="#94a3b8" />
            {/* Heart reaction badge */}
            <circle cx={p.cx + 18} cy={p.cy - 16} r="9" fill="#0f172a" stroke={p.ring} strokeWidth="1" />
            <path d={`M${p.cx + 18},${p.cy - 18} c-2,-2.5 -6,0.5 0,4.5 c6,-4 2,-7 0,-4.5 z`} fill="#fb7185" />
            <text x={p.cx} y={p.cy + 40} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontFamily="system-ui" fontWeight="600">{p.label}</text>
          </g>
        ))}

        {/* === RIGHT: share destinations === */}
        {/* Instagram */}
        <g>
          <rect x="512" y="72" width="46" height="46" rx="12" fill="url(#shareIgGrad)" />
          <rect x="522" y="82" width="26" height="26" rx="8" fill="none" stroke="white" strokeWidth="2" />
          <circle cx="535" cy="95" r="6.5" fill="none" stroke="white" strokeWidth="2" />
          <circle cx="544" cy="86" r="1.8" fill="white" />
          <text x="570" y="99" fill="#e2e8f0" fontSize="12" fontFamily="system-ui" fontWeight="600">Instagram</text>
        </g>
        {/* TikTok */}
        <g>
          <rect x="512" y="170" width="46" height="46" rx="12" fill="#0b0b0f" stroke="#334155" strokeWidth="1" />
          <path d="M540,180 c1,6 5,9 10,9 v7 c-4,0 -7,-1 -10,-3 v11 a11,11 0 1,1 -11,-11 v7 a4,4 0 1,0 4,4 v-31 z" fill="#f472b6" />
          <path d="M538,180 c1,6 5,9 10,9 v7 c-4,0 -7,-1 -10,-3 v11 a11,11 0 1,1 -11,-11 v7 a4,4 0 1,0 4,4 v-31 z" fill="#22d3ee" opacity="0.8" />
          <path d="M539,180 c1,6 5,9 10,9 v7 c-4,0 -7,-1 -10,-3 v11 a11,11 0 1,1 -11,-11 v7 a4,4 0 1,0 4,4 v-31 z" fill="white" />
          <text x="570" y="197" fill="#e2e8f0" fontSize="12" fontFamily="system-ui" fontWeight="600">TikTok</text>
        </g>
        {/* Copy link */}
        <g>
          <rect x="512" y="268" width="46" height="46" rx="12" fill="#4c1d95" stroke="#7c3aed" strokeWidth="1" />
          <g stroke="#c4b5fd" strokeWidth="2.5" fill="none" strokeLinecap="round">
            <path d="M530,286 a6,6 0 0,1 8,-8 l4,4 a6,6 0 0,1 0,8" />
            <path d="M540,296 a6,6 0 0,1 -8,8 l-4,-4 a6,6 0 0,1 0,-8" />
          </g>
          <text x="570" y="288" fill="#e2e8f0" fontSize="12" fontFamily="system-ui" fontWeight="600">Copy link</text>
          <text x="570" y="303" fill="#64748b" fontSize="9" fontFamily="system-ui">rb.link/aiden</text>
        </g>

        {/* Sparkles */}
        <g opacity="0.8">
          <path d="M410,70 l2,-8 2,8 -8,-2 8,0 -8,2z" fill="#fbbf24" />
          <path d="M230,60 l2,-7 2,7 -7,-2 7,0 -7,2z" fill="#f472b6" opacity="0.6" />
          <path d="M420,330 l2,-7 2,7 -7,-2 7,0 -7,2z" fill="#a78bfa" opacity="0.7" />
        </g>

        {/* Views counter chip under phone */}
        <rect x="266" y="366" width="108" height="24" rx="12" fill="#1e293b" stroke="#f472b6" strokeWidth="0.75" />
        <path d="M282,378 c-2.5,-3 -7,0.5 0,5 c7,-4.5 2.5,-8 0,-5 z" fill="#fb7185" />
        <text x="300" y="382" fill="#f9a8d4" fontSize="10" fontFamily="system-ui" fontWeight="600">1.2k</text>
        <circle cx="322" cy="378" r="1.5" fill="#64748b" />
        <text x="352" y="382" textAnchor="middle" fill="#cbd5e1" fontSize="10" fontFamily="system-ui">340 shares</text>
      </svg>
    </div>
  );
}
