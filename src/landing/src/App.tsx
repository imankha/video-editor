import { LogoWithText } from './components/Logo'

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
          <p className="text-xl text-gray-300 mb-4 max-w-2xl mx-auto">
            Professional-quality highlight reels from your footage.
            AI upscaling turns grainy video into recruiting-ready content.
          </p>
          <p className="text-lg text-purple-400 mb-12">
            Perfect for Instagram, TikTok, and college recruiting reels.
          </p>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mb-16">
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">🎬</div>
              <h3 className="text-lg font-semibold text-white mb-2">Dynamic Player Framing</h3>
              <p className="text-gray-400 text-sm">
                Our unique technology smoothly follows your player across the field, keeping them centered in every frame. Get close to the action without manual editing.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">✨</div>
              <h3 className="text-lg font-semibold text-white mb-2">AI-Enhanced Quality</h3>
              <p className="text-gray-400 text-sm">
                Grainy footage? Our AI upscaling makes it look professional. Perfect for recruiting videos that impress coaches.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">📱</div>
              <h3 className="text-lg font-semibold text-white mb-2">Social-Ready Formats</h3>
              <p className="text-gray-400 text-sm">
                One-click export to Instagram Reels, TikTok, or YouTube Shorts. Vertical, square, or widescreen.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">🎯</div>
              <h3 className="text-lg font-semibold text-white mb-2">AI Player Highlighting</h3>
              <p className="text-gray-400 text-sm">
                Easily spotlight your player so coaches never lose track of them in game footage.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">🔍</div>
              <h3 className="text-lg font-semibold text-white mb-2">Clip Library</h3>
              <p className="text-gray-400 text-sm">
                Build a searchable database of your player's best moments. Reuse the same clips across different videos and formats instantly.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6 text-left">
              <div className="text-3xl mb-3">🏷️</div>
              <h3 className="text-lg font-semibold text-white mb-2">Tag & Rate Clips</h3>
              <p className="text-gray-400 text-sm">
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
                  "The AI upscaling is incredible. Our sideline footage looked so professional that a D1 coach asked what camera we used."
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

          {/* CTA */}
          <div className="max-w-md mx-auto bg-white/5 backdrop-blur-lg rounded-2xl p-8">
            <h3 className="text-2xl font-bold text-white mb-2">Coming Soon</h3>
            <p className="text-gray-400 mb-4">
              Be the first to turn your game footage into college-ready highlights.
            </p>
            <p className="text-purple-400 text-sm">
              Join the waitlist for early access and founding member pricing.
            </p>
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
