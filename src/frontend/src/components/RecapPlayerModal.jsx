import React, { useState, useEffect } from 'react';
import { X, Play, Calendar } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';

export function RecapPlayerModal({ game, onClose, onExtend }) {
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/games/${game.id}/recap-url`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load recap');
        return r.json();
      })
      .then(data => {
        if (!cancelled) setVideoUrl(data.url);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [game.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <Play size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{game.name}</h2>
              <p className="text-xs text-gray-400">Game Recap</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <div className="text-center py-8 text-red-400">{error}</div>
          ) : videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              className="w-full rounded-lg"
            />
          ) : (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-blue-400" />
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <Button
            onClick={onExtend}
            className="flex-1 flex items-center justify-center gap-2"
          >
            <Calendar size={16} />
            Extend Storage
          </Button>
          <Button onClick={onClose} variant="secondary" className="flex-1">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
