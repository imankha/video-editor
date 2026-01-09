function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <nav className="flex justify-between items-center mb-16">
          <h1 className="text-2xl font-bold text-white">ReelBallers</h1>
        </nav>

        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl md:text-6xl font-bold text-white mb-6">
            AI-Powered Sports Video Editor
          </h2>
          <p className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto">
            Transform your game footage into professional highlight reels with
            AI player tracking, automatic framing, and one-click exports.
          </p>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white/10 backdrop-blur rounded-xl p-6">
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="text-xl font-semibold text-white mb-2">AI Player Tracking</h3>
              <p className="text-gray-400">
                Automatically track players across the field with advanced AI detection.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6">
              <div className="text-4xl mb-4">📐</div>
              <h3 className="text-xl font-semibold text-white mb-2">Smart Framing</h3>
              <p className="text-gray-400">
                Auto-frame your shots to keep the action centered and cinematic.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-xl p-6">
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-semibold text-white mb-2">Fast Export</h3>
              <p className="text-gray-400">
                Export to any format with GPU-accelerated processing.
              </p>
            </div>
          </div>

          {/* Coming Soon */}
          <div className="max-w-md mx-auto bg-white/5 backdrop-blur-lg rounded-2xl p-8">
            <h3 className="text-2xl font-bold text-white mb-2">Coming Soon</h3>
            <p className="text-gray-400">
              We're working hard to bring you the best sports video editing experience.
              Check back soon for updates!
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
