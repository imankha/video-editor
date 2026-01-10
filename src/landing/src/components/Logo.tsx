interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className = '', size = 40 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer ring - film reel inspired */}
      <circle
        cx="24"
        cy="24"
        r="22"
        stroke="url(#gradient)"
        strokeWidth="3"
        fill="none"
      />

      {/* Film sprocket holes */}
      <circle cx="24" cy="4" r="2" fill="#a855f7" />
      <circle cx="24" cy="44" r="2" fill="#a855f7" />
      <circle cx="4" cy="24" r="2" fill="#a855f7" />
      <circle cx="44" cy="24" r="2" fill="#a855f7" />

      {/* Play button */}
      <path
        d="M20 16 L20 32 L34 24 Z"
        fill="white"
        opacity="0.95"
      />

      {/* Gradient definition */}
      <defs>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LogoWithText({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col w-[80px] ${className}`}>
      <span className="text-xl font-bold text-white text-left">Reel</span>
      <Logo size={64} className="self-center" />
      <span className="text-xl font-bold text-white text-right">Ballers</span>
    </div>
  );
}
