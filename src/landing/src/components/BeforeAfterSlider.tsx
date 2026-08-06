import { useRef, useState, useEffect, useCallback } from 'react'

const SYNC_INTERVAL_MS = 500
// Wide enough that ordinary decoder jitter on a phone never provokes a seek --
// only a real divergence does.
const DRIFT_TOLERANCE_S = 0.3

interface BeforeAfterSliderProps {
  beforeSrc: string
  afterSrc: string
  beforePoster: string
  afterPoster: string
  label?: string
}

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforePoster,
  afterPoster,
  label,
}: BeforeAfterSliderProps) {
  const [sliderPos, setSliderPos] = useState(100)
  const [isDragging, setIsDragging] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [hasRevealed, setHasRevealed] = useState(false)
  const [beforeReady, setBeforeReady] = useState(false)
  const [afterReady, setAfterReady] = useState(false)
  // The two demo clips are large. Nothing is fetched until the slider is
  // actually on screen and the browser is idle, so the hero paints from the
  // poster images (~45 KB) instead of blocking on ~73 MB of video. `load`
  // stays false on Save-Data connections -- those users get the posters and a
  // tap-to-play affordance instead of a surprise 73 MB download.
  const [load, setLoad] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const videosReady = beforeReady && afterReady
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeVideoRef = useRef<HTMLVideoElement>(null)
  const afterVideoRef = useRef<HTMLVideoElement>(null)
  const sliderPosRef = useRef(sliderPos)
  useEffect(() => { sliderPosRef.current = sliderPos }, [sliderPos])

  // Gate the video download on visibility + idle. Honour Save-Data and the
  // reduced-data preference by never auto-loading.
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData) {
      setBlocked(true)
      return
    }
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const start = () => setLoad(true)
        if ('requestIdleCallback' in window) {
          ;(window as Window & { requestIdleCallback: (cb: () => void, o?: object) => void })
            .requestIdleCallback(start, { timeout: 2000 })
        } else {
          setTimeout(start, 200)
        }
      },
      { threshold: 0.25 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Keep the two clips in step. Every guard below is about the mobile decoder:
  // a seek into these clips on a phone routinely takes longer than one tick,
  // and re-issuing it cancels the seek already in flight. That loop is what
  // froze the After video mid-drag -- it was seeked forever and never resumed.
  // So: only touch a video that has settled (not seeking, enough buffered),
  // and prefer fastSeek, which lands on a keyframe instead of making the
  // decoder rebuild an exact frame. Keyframe accuracy is plenty here.
  useEffect(() => {
    if (!load) return
    const lastTime = { before: -1, after: -1 }
    const stalledTicks = { before: 0, after: 0 }

    const id = setInterval(() => {
      const before = beforeVideoRef.current
      const after = afterVideoRef.current
      if (!before || !after || document.hidden) return

      // Restart a clip the browser stopped on its own: iOS suspends a decoder
      // under memory pressure and leaves the element paused after some seeks,
      // and neither state recovers unaided. Requiring currentTime > 0 keeps
      // this from fighting an autoplay the browser refused outright (low power
      // mode) -- that one stays on its poster, as before.
      for (const [key, video] of [['before', before], ['after', after]] as const) {
        const advanced = video.currentTime !== lastTime[key]
        lastTime[key] = video.currentTime
        stalledTicks[key] = advanced ? 0 : stalledTicks[key] + 1
        const stuck = video.paused || stalledTicks[key] >= 2
        if (stuck && video.currentTime > 0 && !video.seeking) {
          video.play().catch(() => {
            /* still refused -- try again next tick, nothing to recover here */
          })
        }
      }

      if (sliderPosRef.current <= 0 || sliderPosRef.current >= 100) return
      if (before.seeking || after.seeking) return
      if (before.readyState < before.HAVE_FUTURE_DATA) return
      if (after.readyState < after.HAVE_FUTURE_DATA) return
      if (Math.abs(before.currentTime - after.currentTime) <= DRIFT_TOLERANCE_S) return

      const target = after as HTMLVideoElement & { fastSeek?: (t: number) => void }
      if (target.fastSeek) target.fastSeek(before.currentTime)
      else target.currentTime = before.currentTime
    }, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  // React sets src as a property after mount, which does not re-trigger the
  // autoplay the `autoPlay` attribute would have done at parse time. play() is
  // enough to start the fetch under preload="none" -- calling load() as well
  // aborts the request play() just started (ERR_CACHE_OPERATION_NOT_SUPPORTED).
  useEffect(() => {
    if (!load) return
    for (const ref of [beforeVideoRef, afterVideoRef]) {
      ref.current?.play().catch(() => {
        /* autoplay refused (e.g. low power mode) -- poster stays, no crash */
      })
    }
  }, [load])

  useEffect(() => {
    if (hasRevealed || !videosReady) return
    const from = 100
    const to = 30
    const durationMs = 1000
    let start: number | null = null
    const timer = setTimeout(() => {
      setHasRevealed(true)
      const animate = (ts: number) => {
        if (!start) start = ts
        const t = Math.min((ts - start) / durationMs, 1)
        const eased = t * t * (3 - 2 * t)
        setSliderPos(from + (to - from) * eased)
        if (t < 1) requestAnimationFrame(animate)
      }
      requestAnimationFrame(animate)
    }, 1000)
    return () => clearTimeout(timer)
  }, [hasRevealed, videosReady])

  // A phone fires pointermove far faster than it can repaint, and each one used
  // to re-render a subtree holding two playing videos plus a clip-path. That
  // starves the decoders -- the drift the sync loop then tries to correct.
  // Coalescing to one state update per frame keeps the drag off the decoders'
  // backs.
  const pendingXRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const updateSlider = useCallback((clientX: number) => {
    pendingXRef.current = clientX
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const container = containerRef.current
      const x = pendingXRef.current
      if (!container || x === null) return
      const rect = container.getBoundingClientRect()
      const pct = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100))
      setSliderPos(pct)
      setHasInteracted(true)
    })
  }, [])

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    // On touch, don't jump on contact -- the gesture may be a vertical page
    // scroll (touch-pan-y hands those to the browser via pointercancel)
    if (e.pointerType !== 'touch') updateSlider(e.clientX)
    containerRef.current?.setPointerCapture(e.pointerId)
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
            className="bg-black rounded-[1rem] md:rounded-[2.25rem] overflow-hidden w-full aspect-[9/16] md:w-[405px] md:h-[720px] relative select-none touch-pan-y"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* After video (full, underneath). The poster paints immediately;
                src is attached only once `load` flips, so the hero never waits
                on video bytes. */}
            <video
              ref={afterVideoRef}
              {...(load ? { src: afterSrc } : {})}
              poster={afterPoster}
              preload="none"
              autoPlay
              loop
              muted
              playsInline
              aria-label={label}
              onCanPlay={() => setAfterReady(true)}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />

            {/* Before video (clipped) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <video
                ref={beforeVideoRef}
                {...(load ? { src: beforeSrc } : {})}
                poster={beforePoster}
                preload="none"
                autoPlay
                loop
                muted
                playsInline
                onCanPlay={() => setBeforeReady(true)}
                className="w-full h-full object-cover pointer-events-none"
              />
            </div>

            {/* Save-Data users: posters only, with an explicit opt-in. */}
            {blocked && (
              <button
                type="button"
                onClick={() => {
                  setBlocked(false)
                  setLoad(true)
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"
              >
                <span className="px-4 py-2 rounded-full bg-purple-600/90 text-sm font-semibold">
                  Tap to play comparison
                </span>
              </button>
            )}

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
