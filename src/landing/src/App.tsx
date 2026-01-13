import { LogoWithText } from './components/Logo'
import { TbFocusCentered } from 'react-icons/tb'
import { HiSparkles } from 'react-icons/hi2'
import { FaInstagram, FaTiktok } from 'react-icons/fa'
import { MdVideoLibrary } from 'react-icons/md'
import { BiSolidUserVoice } from 'react-icons/bi'
import { HiTag, HiStar } from 'react-icons/hi2'

function App() {
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
          <p className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto">
            Higher quality highlights in minutes.
          </p>

          {/* Before/After Demo Video */}
          <div className="flex justify-center mb-16">
            <div className="relative w-full md:w-auto">
              {/* Phone frame - no padding on mobile for full width */}
              <div className="bg-gray-900 rounded-[1.5rem] md:rounded-[3rem] p-1.5 md:p-3 shadow-2xl border md:border-4 border-gray-700 mx-2 md:mx-0">
                {/* Screen bezel - nearly full width on mobile, 405x720 on desktop */}
                <div className="bg-black rounded-[1rem] md:rounded-[2.25rem] overflow-hidden w-full aspect-[9/16] md:w-[405px] md:h-[720px]">
                  <video
                    src="/before_after_demo.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              {/* Phone notch */}
              <div className="absolute top-2 md:top-5 left-1/2 -translate-x-1/2 w-14 md:w-24 h-3 md:h-6 bg-gray-900 rounded-full"></div>
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
              <h3 className="text-xl font-semibold text-white mb-3">Tag & Rate Clips</h3>
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
                  "I can prep and push my son's best plays to Instagram in minutes. What used to take me all weekend now happens during halftime of the next game."
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
                  "The way it follows my son across the field is something I've never seen anywhere else. Game changer for recruiting videos."
                </p>
                <p className="text-purple-400 font-semibold text-sm">— James R., Soccer Dad</p>
                <p className="text-gray-500 text-xs">Son plays ECNL</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 text-center text-gray-500">
        <p>&copy; {new Date().getFullYear()} ReelBallers. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default App
