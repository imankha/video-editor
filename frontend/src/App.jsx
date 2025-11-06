import { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch data from FastAPI backend
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await axios.get('http://localhost:8000/api/hello');
        setApiData(response.data);
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error('Error fetching from API:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4">
            🎬 Video Editor
          </h1>
          <p className="text-xl text-gray-300">
            Full Stack Hello World Demo
          </p>
        </div>

        {/* Tech Stack Cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-12">
          {/* Frontend Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
            <h2 className="text-2xl font-bold text-blue-400 mb-4">
              Frontend 💻
            </h2>
            <ul className="space-y-2 text-gray-200">
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                React 18
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Vite (Build Tool)
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Tailwind CSS
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Axios (HTTP Client)
              </li>
            </ul>
          </div>

          {/* Backend Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
            <h2 className="text-2xl font-bold text-purple-400 mb-4">
              Backend ⚡
            </h2>
            <ul className="space-y-2 text-gray-200">
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                FastAPI
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Python 3.11+
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Pydantic
              </li>
              <li className="flex items-center">
                <span className="text-green-400 mr-2">✓</span>
                Async/Await
              </li>
            </ul>
          </div>
        </div>

        {/* API Response Card */}
        <div className="max-w-4xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-lg p-8 border border-white/20">
            <h2 className="text-2xl font-bold text-white mb-6">
              🔌 Live API Response
            </h2>

            {loading && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                <p className="text-gray-300 mt-4">Connecting to backend...</p>
              </div>
            )}

            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-6">
                <p className="text-red-200 font-semibold mb-2">
                  ❌ Connection Error
                </p>
                <p className="text-red-300 text-sm">
                  {error}
                </p>
                <p className="text-red-300 text-sm mt-2">
                  Make sure the backend is running on http://localhost:8000
                </p>
              </div>
            )}

            {apiData && !loading && (
              <div className="space-y-4">
                {/* Success Message */}
                <div className="bg-green-500/20 border border-green-500 rounded-lg p-4">
                  <p className="text-green-200 font-semibold flex items-center">
                    <span className="text-2xl mr-2">✅</span>
                    {apiData.message}
                  </p>
                </div>

                {/* Timestamp */}
                <div className="text-gray-300 text-sm">
                  <span className="font-semibold">Timestamp:</span>{' '}
                  {new Date(apiData.timestamp).toLocaleString()}
                </div>

                {/* Tech Stack Details */}
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h3 className="text-white font-semibold mb-3">
                    Backend Tech Stack:
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {Object.entries(apiData.tech_stack).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-gray-400 capitalize">{key}:</span>
                        <span className="text-blue-300 font-mono">
                          {value.toString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fun Fact */}
                <div className="bg-purple-500/20 border border-purple-500 rounded-lg p-4">
                  <p className="text-purple-200">
                    <span className="font-semibold">💡 Fun Fact:</span>{' '}
                    {apiData.fun_fact}
                  </p>
                </div>

                {/* Raw JSON */}
                <details className="bg-gray-800/50 rounded-lg p-4">
                  <summary className="text-white font-semibold cursor-pointer">
                    View Raw JSON Response
                  </summary>
                  <pre className="mt-4 text-xs text-green-300 overflow-x-auto">
                    {JSON.stringify(apiData, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-gray-400">
          <p className="mb-2">
            Frontend running on{' '}
            <code className="bg-gray-800 px-2 py-1 rounded text-blue-300">
              http://localhost:5173
            </code>
          </p>
          <p>
            Backend API on{' '}
            <code className="bg-gray-800 px-2 py-1 rounded text-purple-300">
              http://localhost:8000
            </code>
          </p>
          <p className="mt-4 text-sm">
            API Docs:{' '}
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline"
            >
              http://localhost:8000/docs
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
