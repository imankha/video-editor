import React from 'react';
import { Settings, X, RotateCcw } from 'lucide-react';
import { Button } from './shared/Button';

/**
 * ProjectCreationSettings - Modal for configuring project creation rules
 *
 * Settings control what happens when "Import Into Projects" is clicked:
 * - Minimum rating for clips to be saved to library
 * - Whether to create a combined "game" project
 * - Whether to create individual projects for top-rated clips
 * - Aspect ratios for created projects
 */
export function ProjectCreationSettings({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onReset,
}) {
  if (!isOpen) return null;

  const handleChange = (key, value) => {
    onUpdateSettings({ [key]: value });
  };

  const aspectRatioOptions = [
    { value: '16:9', label: '16:9 (YouTube)' },
    { value: '9:16', label: '9:16 (TikTok/Reels)' },
    { value: '1:1', label: '1:1 (Instagram)' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-blue-400" />
            <h2 className="text-lg font-bold text-white">Project Creation Settings</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            iconOnly
            onClick={onClose}
          />
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Clip Library Settings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
              Clip Library
            </h3>
            <div className="bg-gray-750 rounded-lg p-4 border border-gray-700">
              <label className="block text-sm text-gray-300 mb-2">
                Minimum rating for clips to be saved
              </label>
              <div className="flex gap-2">
                {[3, 4, 5].map(rating => (
                  <button
                    key={rating}
                    onClick={() => handleChange('minRatingForLibrary', rating)}
                    className={`flex-1 py-2 px-3 rounded-lg border transition-colors ${
                      settings.minRatingForLibrary === rating
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                    }`}
                  >
                    {rating}+ stars
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Only clips with this rating or higher will be saved to your clip library
              </p>
            </div>
          </div>

          {/* Game Project Settings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
              Game Project
            </h3>
            <div className="bg-gray-750 rounded-lg p-4 border border-gray-700 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.createGameProject}
                  onChange={(e) => handleChange('createGameProject', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                <div>
                  <span className="text-white">Create combined "game" project</span>
                  <p className="text-xs text-gray-500">
                    Includes all clips meeting the minimum rating
                  </p>
                </div>
              </label>

              {settings.createGameProject && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Aspect ratio
                  </label>
                  <div className="flex gap-2">
                    {aspectRatioOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => handleChange('gameProjectAspectRatio', option.value)}
                        className={`flex-1 py-2 px-3 rounded-lg border transition-colors text-sm ${
                          settings.gameProjectAspectRatio === option.value
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Individual Clip Projects Settings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
              Individual Clip Projects
            </h3>
            <div className="bg-gray-750 rounded-lg p-4 border border-gray-700 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.createClipProjects}
                  onChange={(e) => handleChange('createClipProjects', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
                <div>
                  <span className="text-white">Create individual projects for top clips</span>
                  <p className="text-xs text-gray-500">
                    Each qualifying clip gets its own project
                  </p>
                </div>
              </label>

              {settings.createClipProjects && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      Minimum rating for individual projects
                    </label>
                    <div className="flex gap-2">
                      {[4, 5].map(rating => (
                        <button
                          key={rating}
                          onClick={() => handleChange('clipProjectMinRating', rating)}
                          className={`flex-1 py-2 px-3 rounded-lg border transition-colors ${
                            settings.clipProjectMinRating === rating
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {rating === 5 ? '5 stars only' : '4+ stars'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      Aspect ratio
                    </label>
                    <div className="flex gap-2">
                      {aspectRatioOptions.map(option => (
                        <button
                          key={option.value}
                          onClick={() => handleChange('clipProjectAspectRatio', option.value)}
                          className={`flex-1 py-2 px-3 rounded-lg border transition-colors text-sm ${
                            settings.clipProjectAspectRatio === option.value
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <Button
            variant="ghost"
            icon={RotateCcw}
            onClick={onReset}
          >
            Reset to Defaults
          </Button>
          <Button
            variant="primary"
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ProjectCreationSettings;
