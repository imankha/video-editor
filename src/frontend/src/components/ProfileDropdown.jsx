import { useState, useRef, useEffect } from 'react';
import { Settings, User, LogIn, LogOut } from 'lucide-react';
import { useProfileStore } from '../stores';
import { useAuthStore } from '../stores/authStore';

/**
 * ProfileDropdown - Header ACCOUNT control.
 *
 * Guest:         Sign In button.
 * Authenticated: Google avatar -> dropdown (Account Settings, Sign Out).
 *
 * Profile + sport switching moved OUT of this dropdown into ProfileSportButton
 * (the sport-glyph control) so it's discoverable rather than buried under the
 * account avatar. This control is now purely the account.
 */
export function ProfileDropdown() {
  const isInitialized = useProfileStore(state => state.isInitialized);

  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const email = useAuthStore(state => state.email);
  const pictureUrl = useAuthStore(state => state.pictureUrl);
  const logout = useAuthStore(state => state.logout);
  const requireAuth = useAuthStore(state => state.requireAuth);
  const openAccountSettings = useAuthStore(state => state.openAccountSettings);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

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

  return (
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
        </div>
      )}
    </div>
  );
}
