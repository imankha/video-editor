import { useRef, useState, useEffect, useCallback } from 'react'

interface BeforeAfterSliderProps {
  beforeSrc: string
  afterSrc: string
}

export function BeforeAfterSlider({ beforeSrc, afterSrc }: BeforeAfterSliderProps) {
  const [sliderPos, setSliderPos] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [hasPeeked, setHasPeeked] = useState(false)
  const [beforeReady, setBeforeReady] = useState(false)
  const [afterReady, setAfterReady] = useState(false)
  const videosReady = beforeReady && afterReady
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeVideoRef = useRef<HTMLVideoElement>(null)
  const afterVideoRef = useRef<HTMLVideoElement>(null)

  const syncVideos = useCallback(() => {
    const before = beforeVideoRef.current
    const after = afterVideoRef.current
    if (!before || !after) return
    if (Math.abs(before.currentTime - after.currentTime) > 0.15) {
      after.currentTime = before.currentTime
    }
  }, [])

  useEffect(() => {
    const before = beforeVideoRef.current
    if (!before) return
    const id = setInterval(syncVideos, 500)
    return () => clearInterval(id)
  }, [syncVideos])

  useEffect(() => {
    if (hasPeeked) return
    const timer = setTimeout(() => {
      setHasPeeked(true)
      let frame = 0
      const totalFrames = 60
      const peekTo = 15
      const animate = () => {
        frame++
        if (frame <= totalFrames / 2) {
          const t = frame / (totalFrames / 2)
          const eased = t * t * (3 - 2 * t)
          setSliderPos(50 - (50 - peekTo) * eased)
        } else {
          const t = (frame - totalFrames / 2) / (totalFrames / 2)
          const eased = t * t * (3 - 2 * t)
          setSliderPos(peekTo + (50 - peekTo) * eased)
        }
        if (frame < totalFrames) {
          requestAnimationFrame(animate)
        }
      }
      requestAnimationFrame(animate)
    }, 2000)
    return () => clearTimeout(timer)
  }, [hasPeeked])

  const updateSlider = useCallback((clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(pct)
    if (!hasInteracted) setHasInteracted(true)
  }, [hasInteracted])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    updateSlider(e.clientX)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [updateSlider])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    updateSlider(e.clientX)
  }, [isDragging, updateSlider])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  return (
    <div className="flex justify-center mb-16">
      <div className="relative w-full md:w-auto">
        <div className="bg-gray-900 rounded-[1.5rem] md:rounded-[3rem] p-1.5 md:p-3 shadow-2xl border md:border-4 border-gray-700 mx-2 md:mx-0">
          <div
            ref={containerRef}
            className="bg-black rounded-[1rem] md:rounded-[2.25rem] overflow-hidden w-full aspect-[9/16] md:w-[405px] md:h-[720px] relative select-none touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* After video (full, underneath) */}
            <video
              ref={afterVideoRef}
              src={afterSrc}
              autoPlay
              loop
              muted
              playsInline
              onCanPlay={() => setAfterReady(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${videosReady ? 'opacity-100' : 'opacity-0'}`}
            />

            {/* Before video (clipped) */}
            <div
              className={`absolute inset-0 overflow-hidden transition-opacity duration-300 ${videosReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <video
                ref={beforeVideoRef}
                src={beforeSrc}
                autoPlay
                loop
                muted
                playsInline
                onCanPlay={() => setBeforeReady(true)}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Labels */}
            <div
              className="absolute top-4 left-4 px-3 py-1 bg-black/60 rounded-full text-white text-xs font-semibold uppercase tracking-wider transition-opacity duration-300"
              style={{ opacity: videosReady && sliderPos > 15 ? 1 : 0 }}
            >
              Before
            </div>
            <div
              className="absolute top-4 right-4 px-3 py-1 bg-black/60 rounded-full text-white text-xs font-semibold uppercase tracking-wider transition-opacity duration-300"
              style={{ opacity: videosReady && sliderPos < 85 ? 1 : 0 }}
            >
              After
            </div>

            {/* Slider line + handle */}
            <div
              className={`absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none transition-opacity duration-300 ${videosReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
            >
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center ${
                  !hasInteracted ? 'animate-pulse' : ''
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M7 4L3 10L7 16" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13 4L17 10L13 16" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {/* Mobile swipe hint */}
            {!hasInteracted && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 rounded-full text-white text-xs font-medium md:hidden animate-fade-in">
                Swipe to compare
              </div>
            )}
          </div>
        </div>
        {/* Phone notch */}
        <div className="absolute top-2 md:top-5 left-1/2 -translate-x-1/2 w-14 md:w-24 h-3 md:h-6 bg-gray-900 rounded-full"></div>
      </div>
    </div>
  )
}
