import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Settings, User, Plus } from 'lucide-react';
import { useProfileStore } from '../stores';
import { ManageProfilesModal } from './ManageProfilesModal';

/**
 * ProfileDropdown - Header component for switching between athlete profiles
 *
 * Rendering logic:
 * - 0-1 profiles: Small user icon that opens ManageProfilesModal directly
 * - 2+ profiles: Full dropdown with avatar, name, chevron, and profile list
 */
export function ProfileDropdown() {
  const profiles = useProfileStore(state => state.profiles);
  const currentProfileId = useProfileStore(state => state.currentProfileId);
  const switchProfile = useProfileStore(state => state.switchProfile);
  const isInitialized = useProfileStore(state => state.isInitialized);
  const isLoading = useProfileStore(state => state.isLoading);

  const [showDropdown, setShowDropdown] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  const currentProfile = profiles.find(p => p.id === currentProfileId);
  const hasMultiple = profiles.length >= 2;

  // Close dropdown on click outside
  useEffect(() => {
    if (!showDropdown) return;

    function handleClickOutside(event) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(event.target) &&
        triggerRef.current && !triggerRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const handleSwitch = useCallback(async (profileId) => {
    setShowDropdown(false);
    await switchProfile(profileId);
  }, [switchProfile]);

  const handleManageClick = useCallback(() => {
    setShowDropdown(false);
    setShowManageModal(true);
  }, []);

  // Don't render until profiles are loaded
  if (!isInitialized) return null;

  // Single profile: show small user icon that opens manage modal
  if (!hasMultiple) {
    return (
      <>
        <button
          onClick={() => setShowManageModal(true)}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title="Add Profile"
        >
          <User size={16} className="text-gray-300" />
        </button>

        <ManageProfilesModal
          isOpen={showManageModal}
          onClose={() => setShowManageModal(false)}
        />
      </>
    );
  }

  // Multiple profiles: full dropdown
  return (
    <>
      <div className="relative">
        {/* Trigger button */}
        <button
          ref={triggerRef}
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          {/* Avatar circle */}
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: currentProfile?.color || '#3B82F6' }}
          >
            {(currentProfile?.name || 'D')[0].toUpperCase()}
          </div>
          <span className="text-sm text-white font-medium max-w-[100px] truncate">
            {currentProfile?.name || 'Default'}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {/* Backdrop */}
        {showDropdown && (
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
        )}

        {/* Dropdown menu */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1"
          >
            {/* Profile list */}
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors ${
                  p.isCurrent ? 'bg-white/5' : ''
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: p.color || '#3B82F6' }}
                >
                  {(p.name || 'D')[0].toUpperCase()}
                </div>
                <span className="text-sm text-white truncate flex-1">
                  {p.name || 'Default'}
                </span>
                {p.isCurrent && <Check size={16} className="text-green-400 flex-shrink-0" />}
              </button>
            ))}

            {/* Divider */}
            <div className="border-t border-gray-700 my-1" />

            {/* Add Profile */}
            <button
              onClick={() => { setShowDropdown(false); setShowManageModal(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                <Plus size={14} className="text-gray-300" />
              </div>
              <span className="text-sm text-gray-300">Add Profile</span>
            </button>

            {/* Manage Profiles */}
            <button
              onClick={handleManageClick}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                <Settings size={14} className="text-gray-300" />
              </div>
              <span className="text-sm text-gray-300">Manage Profiles</span>
            </button>
          </div>
        )}
      </div>

      <ManageProfilesModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
      />
    </>
  );
}
