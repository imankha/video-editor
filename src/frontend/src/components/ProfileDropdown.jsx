import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Settings, User, Plus, LogIn, LogOut } from 'lucide-react';
import { useProfileStore } from '../stores';
import { useAuthStore } from '../stores/authStore';
import { ManageProfilesModal } from './ManageProfilesModal';

/**
 * ProfileDropdown - Header auth + profile switcher.
 *
 * Guest:                  Sign In button only — no profile UI
 * Authenticated, 1 profile:  User icon → dropdown (Manage Profiles, Sign Out)
 * Authenticated, 2+ profiles: Full profile switcher dropdown
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

  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const email = useAuthStore(state => state.email);
  const pictureUrl = useAuthStore(state => state.pictureUrl);
  const logout = useAuthStore(state => state.logout);
  const requireAuth = useAuthStore(state => state.requireAuth);
  const openAccountSettings = useAuthStore(state => state.openAccountSettings);

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

  if (!isInitialized) return null;

  // Guest: sign in button only
  if (!isAuthenticated) {
    return (
      <button
        onClick={() => requireAuth(() => {})}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        title="Sign in to save your work across devices"
      >
        <LogIn size={14} className="text-blue-400" />
        <span className="text-xs text-blue-400 font-medium">Sign In</span>
      </button>
    );
  }

  const currentProfile = profiles.find(p => p.id === currentProfileId);
  const hasMultiple = profiles.length >= 2;

  // Auth section shared across both dropdown variants
  const authSection = (
    <>
      <div className="border-t border-gray-700 my-1" />
      <div className="px-4 py-2 text-xs text-gray-500 truncate">{email}</div>
      <button
        onClick={() => { setShowDropdown(false); logout(); }}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
          <LogOut size={14} className="text-gray-300" />
        </div>
        <span className="text-sm text-gray-300">Sign Out</span>
      </button>
    </>
  );

  // Avatar element shared across single/multi profile views
  const avatarButton = pictureUrl ? (
    <img
      src={pictureUrl}
      alt=""
      className="w-8 h-8 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <User size={16} className="text-gray-300" />
  );

  // Authenticated, single profile: avatar → small dropdown
  if (!hasMultiple) {
    return (
      <>
        <div className="relative">
          <button
            ref={triggerRef}
            onClick={() => setShowDropdown(!showDropdown)}
            className={`flex items-center justify-center w-8 h-8 rounded-full ${pictureUrl ? '' : 'bg-white/10 hover:bg-white/20'} transition-colors`}
            title={email}
          >
            {avatarButton}
          </button>

          {showDropdown && (
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
          )}

          {showDropdown && (
            <div
              ref={dropdownRef}
              className="absolute right-0 top-full mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1"
            >
              <button
                onClick={() => { setShowDropdown(false); openAccountSettings(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                  <Settings size={14} className="text-gray-300" />
                </div>
                <span className="text-sm text-gray-300">Account Settings</span>
              </button>
              <button
                onClick={() => { setShowDropdown(false); setShowManageModal(true); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                  <User size={14} className="text-gray-300" />
                </div>
                <span className="text-sm text-gray-300">Manage Profiles</span>
              </button>
              {authSection}
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

  // Authenticated, multiple profiles: full switcher dropdown
  return (
    <>
      <div className="relative">
        <button
          ref={triggerRef}
          onClick={() => setShowDropdown(!showDropdown)}
          disabled={isLoading}
          title={email}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          {pictureUrl ? (
            <img
              src={pictureUrl}
              alt=""
              className="w-6 h-6 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: currentProfile?.color || '#3B82F6' }}
            >
              {(currentProfile?.name || 'D')[0].toUpperCase()}
            </div>
          )}
          <span className="text-sm text-white font-medium max-w-[100px] truncate">
            {currentProfile?.name || 'Default'}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showDropdown && (
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
        )}

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute right-0 top-full mt-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1"
          >
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

            <div className="border-t border-gray-700 my-1" />

            <button
              onClick={() => { setShowDropdown(false); setShowManageModal(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                <Plus size={14} className="text-gray-300" />
              </div>
              <span className="text-sm text-gray-300">Add Profile</span>
            </button>

            <button
              onClick={() => { setShowDropdown(false); setShowManageModal(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                <User size={14} className="text-gray-300" />
              </div>
              <span className="text-sm text-gray-300">Manage Profiles</span>
            </button>

            <button
              onClick={() => { setShowDropdown(false); openAccountSettings(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 flex-shrink-0">
                <Settings size={14} className="text-gray-300" />
              </div>
              <span className="text-sm text-gray-300">Account Settings</span>
            </button>

            {authSection}
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
