import { useMemo, useState, useEffect } from 'react'
import { LogoWithText } from './components/Logo'
import { LearnIllustration, ElevateIllustration, CelebrateIllustration } from './components/Illustrations'
import { BeforeAfterSlider } from './components/BeforeAfterSlider'
import { TutorialModal } from './components/TutorialModal'
import {
  LEARN_PLAYLIST,
  ELEVATE_PLAYLIST,
  CELEBRATE_PLAYLIST,
  FULL_WALKTHROUGH,
  type TutorialAsset,
} from './config/tutorials'
import { TbFocusCentered } from 'react-icons/tb'
import { HiSparkles, HiTag, HiStar, HiPlay, HiUsers, HiFilm, HiLink } from 'react-icons/hi2'
import { FaInstagram, FaTiktok } from 'react-icons/fa'

// Illustration wrapped as a clickable video thumbnail: hover reveals a play badge
// and the whole panel opens the section's tutorial in the modal player.
function PlayableIllustration({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group relative block w-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      {children}
      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 group-hover:bg-black/25 transition-colors">
        <span className="w-16 h-16 rounded-full bg-purple-600/85 group-hover:bg-purple-600 flex items-center justify-center scale-90 group-hover:scale-100 opacity-90 group-hover:opacity-100 transition-all shadow-lg shadow-purple-900/40">
          <HiPlay className="w-8 h-8 text-white ml-1" />
        </span>
      </div>
    </button>
  )
}

function WatchLink({ onClick, label, color }: { onClick: () => void; label: string; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${color} hover:opacity-80 transition-opacity`}
    >
      <HiPlay className="w-4 h-4" />
      {label}
    </button>
  )
}

function FeaturePill({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
      <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${color} flex items-center justify-center gap-0.5 shrink-0`}>
        <span className="scale-[0.55] flex items-center gap-0.5">{icon}</span>
      </div>
      <span className="text-gray-300 text-xs font-medium">{label}</span>
    </div>
  )
}

// Mirrors SUPPORTED_SPORTS + SPORT_EMOJI in the editor's tagRegistry. This is a
// standalone app, so the list is kept in sync by hand rather than cross-imported.
const SPORTS = [
  { name: 'Soccer', emoji: '⚽' },
  { name: 'Flag Football', emoji: '🏈' },
  { name: 'American Football', emoji: '🏈' },
  { name: 'Basketball', emoji: '🏀' },
  { name: 'Lacrosse', emoji: '🥍' },
  { name: 'Rugby', emoji: '🏉' },
  { name: 'Volleyball', emoji: '🏐' },
  { name: 'Hockey', emoji: '🏒' },
  { name: 'Tennis', emoji: '🎾' },
  { name: 'Baseball', emoji: '⚾' },
]

function App() {
  const ctaHref = useMemo(() => {
    const search = window.location.search;
    return search
      ? `https://app.reelballers.com${search}`
      : 'https://app.reelballers.com';
  }, [])

  const [playlist, setPlaylist] = useState<TutorialAsset[] | null>(null)

  // Lock background scroll while the tutorial modal is open.
  useEffect(() => {
    if (!playlist) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [playlist])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <nav className="flex justify-between items-center mb-16">
          <LogoWithText />
        </nav>

        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Share Your Player's Brilliance
          </h2>
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Educate, Elevate, Celebrate.
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-12">
            <a
              href={ctaHref}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-full text-lg shadow-lg shadow-purple-500/25 transition-all"
            >
              Get Started Free
            </a>
            <button
              type="button"
              onClick={() => setPlaylist(FULL_WALKTHROUGH)}
              className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/15 text-white font-semibold rounded-full text-lg flex items-center gap-2 transition-all"
            >
              <HiPlay className="w-5 h-5 text-purple-300" />
              See how it works
            </button>
          </div>

          {/* Before/After Slider */}
          <BeforeAfterSlider
            beforeSrc="https://pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev/before.mp4"
            afterSrc="https://pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev/after.mp4"
          />

          {/* Product Showcase */}
          <div className="mt-24 md:mt-32 space-y-20 md:space-y-28 mb-24 md:mb-32 text-left">
            {/* Learn */}
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-16">
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent pb-1 mb-4">
                  Educate
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed mb-5">
                  Leave notes on the moments that matter. Your athlete reviews at their own pace — no sideline lectures, no pressure.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <FeaturePill icon={<HiPlay className="w-5 h-5 text-white" />} label="Playback with coaching notes" color="from-cyan-400 to-blue-500" />
                  <FeaturePill icon={<><HiTag className="w-4 h-4 text-white" /><HiStar className="w-3.5 h-3.5 text-white" /></>} label="Rate & tag by play type" color="from-violet-400 to-purple-500" />
                  <FeaturePill icon={<HiUsers className="w-5 h-5 text-white" />} label="Tag teammates" color="from-emerald-400 to-teal-500" />
                </div>
                <WatchLink onClick={() => setPlaylist(LEARN_PLAYLIST)} label="Watch the tutorial" color="text-cyan-400" />
              </div>
              <div className="w-full md:w-[60%] md:order-first">
                <PlayableIllustration onClick={() => setPlaylist(LEARN_PLAYLIST)} ariaLabel="Play the Annotate tutorial">
                  <LearnIllustration className="shadow-2xl shadow-purple-500/10 group-hover:scale-[1.02] transition-transform duration-300" />
                </PlayableIllustration>
              </div>
            </div>

            {/* Elevate */}
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-16">
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent pb-1 mb-4">
                  Elevate
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed mb-5">
                  Lift raw game film into something that looks pro. AI upscales your footage to crisp 4K, auto-frames to follow your player across the field, and adds animated highlights that make every play pop.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <FeaturePill icon={<TbFocusCentered className="w-5 h-5 text-white" />} label="Auto-Follow Framing" color="from-amber-400 to-orange-500" />
                  <FeaturePill icon={<HiSparkles className="w-5 h-5 text-white" />} label="AI 4K Upscaling" color="from-yellow-400 to-orange-500" />
                  <FeaturePill icon={<HiStar className="w-5 h-5 text-white" />} label="Highlight Graphics" color="from-purple-500 to-pink-500" />
                </div>
                <WatchLink onClick={() => setPlaylist(ELEVATE_PLAYLIST)} label="Watch the tutorials" color="text-amber-400" />
              </div>
              <div className="w-full md:w-[60%]">
                <PlayableIllustration onClick={() => setPlaylist(ELEVATE_PLAYLIST)} ariaLabel="Play the Framing and Highlights tutorials">
                  <ElevateIllustration className="shadow-2xl shadow-purple-500/10 group-hover:scale-[1.02] transition-transform duration-300" />
                </PlayableIllustration>
              </div>
            </div>

            {/* Celebrate */}
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-16">
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 to-rose-500 bg-clip-text text-transparent pb-1 mb-4">
                  Celebrate
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed mb-5">
                  Share the finished reel with one link. Grandma watches in full resolution on her phone, coaches get the highlights, and it's ready to post to Instagram or TikTok in a tap.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  <FeaturePill icon={<HiLink className="w-5 h-5 text-white" />} label="One shareable link" color="from-purple-500 to-pink-500" />
                  <FeaturePill icon={<HiFilm className="w-5 h-5 text-white" />} label="Full-Resolution Playback" color="from-cyan-400 to-blue-500" />
                  <FeaturePill icon={<><FaInstagram className="w-4 h-4 text-white" /><FaTiktok className="w-3.5 h-3.5 text-white" /></>} label="Social-Ready Formats" color="from-pink-500 to-rose-500" />
                </div>
                <WatchLink onClick={() => setPlaylist(CELEBRATE_PLAYLIST)} label="Watch the tutorial" color="text-pink-400" />
              </div>
              <div className="w-full md:w-[60%] md:order-first">
                <PlayableIllustration onClick={() => setPlaylist(CELEBRATE_PLAYLIST)} ariaLabel="Play the Share tutorial">
                  <CelebrateIllustration className="shadow-2xl shadow-purple-500/10 group-hover:scale-[1.02] transition-transform duration-300" />
                </PlayableIllustration>
              </div>
            </div>
          </div>

          {/* Problem/Solution */}
          <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-8 mb-16 text-left max-w-3xl mx-auto">
            <h3 className="text-2xl font-bold text-white mb-4 text-center">The College Recruiting Problem</h3>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-red-400 font-semibold mb-2">The Old Way</h4>
                <ul className="text-gray-400 text-sm space-y-2">
                  <li>• Watch 10+ hours of game footage</li>
                  <li>• Manually timestamp every good play</li>
                  <li>• Juggle multiple editing tools</li>
                  <li>• Re-export every time you find a better clip</li>
                  <li>• Weeks to make one highlight reel</li>
                </ul>
              </div>
              <div>
                <h4 className="text-green-400 font-semibold mb-2">With ReelBallers</h4>
                <ul className="text-gray-400 text-sm space-y-2">
                  <li>• Upload your games once</li>
                  <li>• Streamlined editor built for speed</li>
                  <li>• Annotate key plays and build your clips database</li>
                  <li>• Generate videos from simple queries</li>
                  <li>• Reuse clips across multiple formats</li>
                  <li>• Professional quality in minutes</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Testimonials */}
          <div className="mb-16">
            <h3 className="text-2xl font-bold text-white mb-8">What Parents Are Saying</h3>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white/5 backdrop-blur rounded-xl p-6 text-left">
                <p className="text-gray-300 text-sm mb-4">
                  "Now when grandma can't make a game, I just send her a link to his highlights that she can view it in full resolution on her phone."
                </p>
                <p className="text-purple-400 font-semibold text-sm">— Mike T., Soccer Dad</p>
                <p className="text-gray-500 text-xs">Son plays U16 club soccer</p>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-6 text-left">
                <p className="text-gray-300 text-sm mb-4">
                  "The AI upscaling is incredible. Our footage looked so professional that a D1 coach asked what camera we used."
                </p>
                <p className="text-purple-400 font-semibold text-sm">— Sarah M., Soccer Mom</p>
                <p className="text-gray-500 text-xs">Daughter committed to play D2</p>
              </div>
              <div className="bg-white/5 backdrop-blur rounded-xl p-6 text-left">
                <p className="text-gray-300 text-sm mb-4">
                  "The way I could make the frame follow my son across the field is something I've never seen anywhere else. Total game changer for highlight videos."
                </p>
                <p className="text-purple-400 font-semibold text-sm">— James R., Soccer Dad</p>
                <p className="text-gray-500 text-xs">Son plays ECNL</p>
              </div>
            </div>
          </div>

          {/* Sports We Support */}
          <div className="mb-16">
            <h3 className="text-2xl font-bold text-white mb-2">Sports We Support</h3>
            <p className="text-gray-400 text-sm mb-8">
              Don't see your sport?{' '}
              <a
                href="mailto:hello@reelballers.com?subject=New%20sport%20request"
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                Request it
              </a>{' '}
              and we'll add it.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {SPORTS.map((sport) => (
                <div
                  key={sport.name}
                  className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2"
                >
                  <span className="text-xl leading-none" aria-hidden>{sport.emoji}</span>
                  <span className="text-gray-300 text-sm font-medium">{sport.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Closing CTA */}
          <div className="relative overflow-hidden bg-gradient-to-br from-purple-600/20 to-indigo-600/10 border border-white/10 rounded-2xl p-10 mb-16 text-center">
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">
              Your player's next highlight reel is minutes away
            </h3>
            <p className="text-gray-300 mb-8 max-w-xl mx-auto">
              Upload a game, clip the best moments, and share a pro-quality reel today. Free to start.
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <a
                href={ctaHref}
                className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-full text-lg shadow-lg shadow-purple-500/25 transition-all"
              >
                Get Started Free
              </a>
              <button
                type="button"
                onClick={() => setPlaylist(FULL_WALKTHROUGH)}
                className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/15 text-white font-semibold rounded-full text-lg flex items-center gap-2 transition-all"
              >
                <HiPlay className="w-5 h-5 text-purple-300" />
                Watch the full walkthrough
              </button>
            </div>
          </div>
        </div>
      </div>

      {playlist && <TutorialModal items={playlist} onClose={() => setPlaylist(null)} />}

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center text-gray-500 space-y-2">
        <div className="flex items-center justify-center gap-4 text-sm">
          <a href="https://app.reelballers.com/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</a>
          <span>|</span>
          <a href="https://app.reelballers.com/terms" className="hover:text-gray-300 transition-colors">Terms of Service</a>
          <span>|</span>
          <a href="https://app.reelballers.com/privacy#your-rights" className="hover:text-gray-300 transition-colors">Do Not Sell or Share</a>
        </div>
        <p>&copy; {new Date().getFullYear()} ReelBallers. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default App
