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

function StarIcon({ cx, cy, size, filled }: { cx: number; cy: number; size: number; filled: boolean }) {
  const r = size / 2;
  const points = Array.from({ length: 5 }, (_, i) => {
    const outerAngle = (i * 72 - 90) * Math.PI / 180;
    const innerAngle = ((i * 72) + 36 - 90) * Math.PI / 180;
    const ox = cx + r * Math.cos(outerAngle);
    const oy = cy + r * Math.sin(outerAngle);
    const ix = cx + r * 0.4 * Math.cos(innerAngle);
    const iy = cy + r * 0.4 * Math.sin(innerAngle);
    return `${ox},${oy} ${ix},${iy}`;
  }).join(' ');
  return <polygon points={points} fill={filled ? '#fbbf24' : '#475569'} opacity={filled ? 0.9 : 0.3} />;
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

export function OrganizeIllustration({ className = '' }: IllustrationProps) {
  const clips = [
    { x: 40, y: 100, selected: true, stars: 3, tagW: 55, fieldColor: '#166534', playerX: 85, playerY: 40 },
    { x: 235, y: 100, selected: true, stars: 4, tagW: 45, fieldColor: '#15803d', playerX: 100, playerY: 35 },
    { x: 430, y: 100, selected: false, stars: 2, tagW: 60, fieldColor: '#166534', playerX: 70, playerY: 45 },
    { x: 40, y: 252, selected: false, stars: 1, tagW: 50, fieldColor: '#14532d', playerX: 95, playerY: 38 },
    { x: 235, y: 252, selected: true, stars: 5, tagW: 40, fieldColor: '#166534', playerX: 80, playerY: 42 },
    { x: 430, y: 252, selected: false, stars: 3, tagW: 55, fieldColor: '#15803d', playerX: 90, playerY: 36 },
  ];

  return (
    <div className={`relative w-full aspect-[16/10] bg-slate-800/60 rounded-2xl border border-white/10 overflow-hidden ${className}`}>
      <svg viewBox="0 0 640 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <linearGradient id="orgBtnGrad" x1="180" y1="0" x2="460" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#b45309" />
            <stop offset="50%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          <filter id="selectedGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="thumbClip0"><rect x="46" y="106" width="163" height="82" rx="6" /></clipPath>
          <clipPath id="thumbClip1"><rect x="241" y="106" width="163" height="82" rx="6" /></clipPath>
          <clipPath id="thumbClip2"><rect x="436" y="106" width="163" height="82" rx="6" /></clipPath>
          <clipPath id="thumbClip3"><rect x="46" y="258" width="163" height="82" rx="6" /></clipPath>
          <clipPath id="thumbClip4"><rect x="241" y="258" width="163" height="82" rx="6" /></clipPath>
          <clipPath id="thumbClip5"><rect x="436" y="258" width="163" height="82" rx="6" /></clipPath>
        </defs>

        {/* Header bar */}
        <rect x="30" y="22" width="580" height="56" rx="12" fill="#1e293b" stroke="#334155" strokeWidth="1" />

        {/* Search icon */}
        <circle cx="52" cy="50" r="7" stroke="#64748b" strokeWidth="1.5" fill="none" />
        <line x1="57" y1="55" x2="62" y2="60" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
        {/* Search text */}
        <rect x="68" y="46" width="60" height="7" rx="3" fill="#475569" opacity="0.4" />

        {/* Divider */}
        <line x1="140" y1="34" x2="140" y2="66" stroke="#334155" strokeWidth="1" />

        {/* Filter chips */}
        <rect x="154" y="37" width="82" height="26" rx="13" fill="#d97706" fillOpacity="0.2" stroke="#d97706" strokeWidth="1.5" />
        <text x="195" y="54" textAnchor="middle" fill="#fbbf24" fontSize="10" fontFamily="system-ui" fontWeight="600">Dribbling</text>

        <rect x="244" y="37" width="62" height="26" rx="13" fill="#334155" />
        <text x="275" y="54" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="system-ui">Goals</text>

        <rect x="314" y="37" width="72" height="26" rx="13" fill="#334155" />
        <text x="350" y="54" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="system-ui">Defense</text>

        {/* Star filter */}
        <line x1="400" y1="34" x2="400" y2="66" stroke="#334155" strokeWidth="1" />
        {[416, 432, 448, 464, 480].map((x, i) => (
          <StarIcon key={i} cx={x} cy={50} size={12} filled={i < 3} />
        ))}
        <text x="498" y="54" fill="#64748b" fontSize="9" fontFamily="system-ui">+</text>

        {/* Sort dropdown */}
        <rect x="520" y="37" width="78" height="26" rx="8" fill="#1e293b" stroke="#475569" strokeWidth="1" />
        <text x="545" y="54" fill="#94a3b8" fontSize="9" fontFamily="system-ui">Newest</text>
        <path d="M586,47 l4,6 4,-6" fill="#64748b" />

        {/* Clip cards */}
        {clips.map((card, i) => (
          <g key={i}>
            <rect x={card.x} y={card.y} width="175" height="135" rx="10"
              fill="#131a2b"
              stroke={card.selected ? '#d97706' : '#1e293b'}
              strokeWidth={card.selected ? 2 : 1}
              filter={card.selected ? 'url(#selectedGlow)' : undefined}
            />
            {/* Thumbnail */}
            <g clipPath={`url(#thumbClip${i})`}>
              <rect x={card.x + 6} y={card.y + 6} width="163" height="82" fill={card.fieldColor} />
              {/* Grass stripes */}
              {[0, 1, 2, 3].map(j => (
                <rect key={j} x={card.x + 6} y={card.y + 6 + j * 21} width="163" height="10" fill="white" opacity="0.04" />
              ))}
              {/* Field line */}
              <line x1={card.x + 6} y1={card.y + 47} x2={card.x + 169} y2={card.y + 47}
                stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              {/* Mini players */}
              <circle cx={card.x + card.playerX} cy={card.y + card.playerY} r="5" fill="#e2e8f0" opacity="0.5" />
              <circle cx={card.x + card.playerX + 25} cy={card.y + card.playerY + 10} r="4" fill="#e2e8f0" opacity="0.35" />
              <circle cx={card.x + card.playerX - 20} cy={card.y + card.playerY + 15} r="4" fill="#e2e8f0" opacity="0.35" />
              {/* Duration badge */}
              <rect x={card.x + 130} y={card.y + 68} width="34" height="16" rx="4" fill="black" fillOpacity="0.6" />
              <text x={card.x + 147} y={card.y + 80} textAnchor="middle" fill="white" fontSize="8" fontFamily="system-ui">0:{12 + i * 3}</text>
            </g>

            {/* Bottom info */}
            {/* Tag pill */}
            <rect x={card.x + 10} y={card.y + 95} width={card.tagW} height="18" rx="9"
              fill={card.selected ? '#92400e' : '#1e293b'}
              stroke={card.selected ? '#d97706' : '#334155'}
              strokeWidth="0.5" />
            <rect x={card.x + 17} y={card.y + 101} width={card.tagW - 14} height="6" rx="3"
              fill={card.selected ? '#fbbf24' : '#64748b'} opacity="0.6" />

            {/* Stars */}
            {[0, 1, 2, 3, 4].map(s => (
              <StarIcon key={s} cx={card.x + 130 + s * 10} cy={card.y + 104} size={8} filled={s < card.stars} />
            ))}

            {/* Clip title placeholder */}
            <rect x={card.x + 10} y={card.y + 120} width="90" height="5" rx="2.5" fill="#475569" opacity="0.4" />

            {/* Checkmark for selected */}
            {card.selected && (
              <g>
                <circle cx={card.x + 161} cy={card.y + 14} r="11" fill="#d97706" />
                <path d={`M${card.x + 155},${card.y + 14} l4,4 7,-8`}
                  stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        ))}

        {/* Bottom bar with CTA */}
        <rect x="30" y="370" width="580" height="1" fill="#1e293b" />

        {/* Selected count */}
        <text x="100" y="392" textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="system-ui">3 clips selected</text>

        {/* Generate button */}
        <rect x="220" y="378" width="200" height="18" rx="9" fill="url(#orgBtnGrad)" />
        <text x="320" y="391" textAnchor="middle" fill="white" fontSize="10" fontWeight="700" fontFamily="system-ui">Generate Highlight Reel</text>

        {/* Arrow icon on button */}
        <path d="M408,387 l6,-4 -6,-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function CelebrateIllustration({ className = '' }: IllustrationProps) {
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
