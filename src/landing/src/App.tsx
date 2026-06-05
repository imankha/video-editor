import { useMemo } from 'react'
import { LogoWithText } from './components/Logo'
import { LearnIllustration, OrganizeIllustration, CelebrateIllustration } from './components/Illustrations'
import { BeforeAfterSlider } from './components/BeforeAfterSlider'
import { TbFocusCentered } from 'react-icons/tb'
import { HiSparkles } from 'react-icons/hi2'
import { FaInstagram, FaTiktok } from 'react-icons/fa'
import { MdVideoLibrary } from 'react-icons/md'
import { BiSolidUserVoice } from 'react-icons/bi'
import { HiTag, HiStar } from 'react-icons/hi2'

function App() {
  const ctaHref = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    return ref
      ? `https://app.reelballers.com?ref=${encodeURIComponent(ref)}`
      : 'https://app.reelballers.com'
  }, [])

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
            Learn from, organize, and celebrate your athlete's moments.
          </p>

          <div className="flex justify-center mb-12">
            <a
              href={ctaHref}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-full text-lg shadow-lg shadow-purple-500/25 transition-all"
            >
              Get Started
            </a>
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
              <div className="w-full md:w-[60%]">
                <LearnIllustration className="shadow-2xl shadow-purple-500/10 hover:scale-[1.02] transition-transform duration-300" />
              </div>
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent pb-1 mb-4">
                  Learn
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed">
                  Leave notes on the moments that matter. Your athlete reviews at their own pace — no sideline lectures, no pressure.
                </p>
              </div>
            </div>

            {/* Organize */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-8 md:gap-16">
              <div className="w-full md:w-[60%]">
                <OrganizeIllustration className="shadow-2xl shadow-purple-500/10 hover:scale-[1.02] transition-transform duration-300" />
              </div>
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-amber-400 to-yellow-500 bg-clip-text text-transparent pb-1 mb-4">
                  Organize
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed">
                  Every clip tagged, rated, and searchable. Filter by skill, pick your best, and generate a highlight reel in one click.
                </p>
              </div>
            </div>

            {/* Celebrate */}
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-16">
              <div className="w-full md:w-[60%]">
                <CelebrateIllustration className="shadow-2xl shadow-purple-500/10 hover:scale-[1.02] transition-transform duration-300" />
              </div>
              <div className="w-full md:w-[40%] text-center md:text-left">
                <h3 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 to-rose-500 bg-clip-text text-transparent pb-1 mb-4">
                  Celebrate
                </h3>
                <p className="text-lg text-gray-300 leading-relaxed">
                  Turn sideline footage into a pro-quality vertical reel. AI upscaling and animated framing keeps your player centered and sharp.
                </p>
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <TbFocusCentered className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">Dynamic Player Framing</h3>
              <p className="text-gray-400">
                Our unique technology smoothly follows your player across the field, keeping them centered in every frame.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
                <HiSparkles className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">AI-Enhanced Quality</h3>
              <p className="text-gray-400">
                Grainy footage? Our AI upscaling makes it look professional.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
                <FaInstagram className="w-8 h-8 text-white" />
                <FaTiktok className="w-7 h-7 text-white ml-1" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">Social-Ready Formats</h3>
              <p className="text-gray-400">
                One-click export to Instagram Reels, TikTok, or YouTube Shorts. Vertical, square, or widescreen.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                <BiSolidUserVoice className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">AI Player Highlighting</h3>
              <p className="text-gray-400">
                Easily spotlight your player so coaches never lose track of them in game footage.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
                <MdVideoLibrary className="w-10 h-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">Clip Library</h3>
              <p className="text-gray-400">
                Build a searchable database of your player's best moments. Reuse the same clips across different videos and formats instantly.
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur rounded-2xl p-8 text-center hover:bg-white/10 transition-colors">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center">
                <HiTag className="w-8 h-8 text-white" />
                <HiStar className="w-7 h-7 text-white ml-0.5" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">Capture Learning Moments</h3>
              <p className="text-gray-400">
                Organize clips with tags and ratings. Export annotated videos so players can study their own performance.
              </p>
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
        </div>
      </div>

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
