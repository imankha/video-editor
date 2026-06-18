import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Pencil, Trash2, ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { Button, ConfirmationDialog } from './shared';
import { useProfileStore } from '../stores';
import { SUPPORTED_SPORTS, sportDisplayName, sportStoredValue, sportEmoji } from '../modes/annotate/constants/tagRegistry';

/**
 * Pre-defined profile colors.
 * New profiles auto-assigned next unused color.
 */
const PROFILE_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

/**
 * Get the first unused color, or fall back to the first color if all are used.
 */
function getNextColor(usedColors) {
  const unused = PROFILE_COLORS.find(c => !usedColors.includes(c));
  return unused || PROFILE_COLORS[0];
}

// ---------------------------------------------------------------------------
// Inline Sport Select (list row)
// ---------------------------------------------------------------------------

// Sentinel value: picking it opens the full Edit form for a custom ("Other") sport.
const INLINE_SPORT_OTHER = '__other__';

/**
 * Compact sport dropdown shown directly on each profile row, so the most common
 * edit (changing the sport) needs no extra screen and no profile name.
 * Custom/unknown sports stay selectable; "Other..." routes to the Edit form.
 */
function InlineSportSelect({ sport, onChange, onPickOther }) {
  const isKnown = !sport || SUPPORTED_SPORTS.some(s => s.id === sport);
  const label = isKnown ? (sportDisplayName(sport) || 'Soccer') : sport;

  return (
    // A big, tappable pill. The native <select> sits invisibly on top so we get
    // the OS-native picker on mobile (and full a11y) while styling freely below.
    <div className="relative flex-shrink-0 group">
      <div className="flex items-center gap-2 bg-gray-700 group-hover:bg-gray-600 border border-gray-600 group-focus-within:border-purple-500 rounded-xl pl-2.5 pr-2 py-2 transition-colors">
        <span className="text-2xl leading-none" aria-hidden>{sportEmoji(sport)}</span>
        {/* Emoji alone carries the meaning on narrow screens; show the name when there's room */}
        <span className="hidden sm:inline text-sm font-semibold text-white max-w-[6.5rem] truncate">{label}</span>
        <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
      </div>
      <select
        value={isKnown ? (sport || '') : sport}
        onChange={(e) => {
          const next = e.target.value;
          if (next === INLINE_SPORT_OTHER) onPickOther();
          else onChange(next);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label="Change sport"
        title="Change sport"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {/* Custom sport (not in the supported list) stays selectable */}
        {!isKnown && <option value={sport}>{`${sportEmoji(sport)} ${sport}`}</option>}
        {SUPPORTED_SPORTS.map(s => (
          <option key={s.id} value={s.id}>{`${sportEmoji(s.id)} ${s.name}`}</option>
        ))}
        <option value={INLINE_SPORT_OTHER}>Other...</option>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color Selector
// ---------------------------------------------------------------------------

function ColorSelector({ value, onChange, usedColors = [] }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {PROFILE_COLORS.map(color => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={`w-8 h-8 rounded-full border-2 transition-all ${
            color === value ? 'border-white scale-110' : 'border-transparent'
          } ${usedColors.includes(color) && color !== value ? 'opacity-40' : ''}`}
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Form (shared for Add and Edit)
// ---------------------------------------------------------------------------

function ProfileForm({ title, initialName = '', initialColor, initialSport = 'soccer', usedColors, existingNames = [], onSubmit, onCancel, submitLabel = 'Save', nameRequired = true }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor || getNextColor(usedColors));
  const [sport, setSport] = useState(sportDisplayName(initialSport) || 'Soccer');
  const [submitting, setSubmitting] = useState(false);

  const trimmedName = name.trim();
  const isDuplicate = trimmedName && existingNames.some(
    n => n && n.toLowerCase() === trimmedName.toLowerCase()
  );
  const canSubmit = (nameRequired ? !!trimmedName : true) && !isDuplicate && !submitting;

  // Placeholder reflects the selected sport so unnamed profiles still get a useful hint.
  const namePlaceholder = `e.g. Fall ${sport.trim() || 'Soccer'} 2025`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const sportValue = sport.trim() ? sportStoredValue(sport.trim()) : 'soccer';
      await onSubmit(trimmedName, color, sportValue);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-700">
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Sport</label>
          <select
            value={SUPPORTED_SPORTS.some(s => s.name === sport) ? sport : '__custom__'}
            onChange={(e) => setSport(e.target.value === '__custom__' ? '' : e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
          >
            {SUPPORTED_SPORTS.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
            <option value="__custom__">Other</option>
          </select>
          {!SUPPORTED_SPORTS.some(s => s.name === sport) && (
            <input
              type="text"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              placeholder="Type your sport"
              className="w-full mt-2 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
            />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
          <ColorSelector value={color} onChange={setColor} usedColors={usedColors} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Profile Name{!nameRequired && <span className="text-gray-500 font-normal"> (optional)</span>}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={namePlaceholder}
            maxLength={30}
            autoFocus={nameRequired}
            className={`w-full px-3 py-2 bg-gray-700 border rounded-lg text-white placeholder-gray-400 focus:outline-none ${
              isDuplicate ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-purple-500'
            }`}
          />
          {isDuplicate && (
            <p className="text-red-400 text-xs mt-1">A profile with this name already exists</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={!canSubmit} loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// ManageProfilesModal (main component)
// ---------------------------------------------------------------------------

/**
 * ManageProfilesModal - Full profile management UI
 *
 * Modes:
 * - 'list': Show all profiles with edit/delete buttons
 * - 'add': Add a new profile
 * - 'edit': Edit an existing profile's name and color
 */
export function ManageProfilesModal({ isOpen, onClose }) {
  const profiles = useProfileStore(state => state.profiles);
  const createProfile = useProfileStore(state => state.createProfile);
  const updateProfile = useProfileStore(state => state.updateProfile);
  const deleteProfile = useProfileStore(state => state.deleteProfile);
  const switchProfile = useProfileStore(state => state.switchProfile);

  const [mode, setMode] = useState('list');
  const [editingProfile, setEditingProfile] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Reset mode when modal opens
  useEffect(() => {
    if (isOpen) setMode('list');
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (mode !== 'list') {
          setMode('list');
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, onClose]);

  const handleAddProfile = useCallback(async (name, color, sport) => {
    await createProfile(name, color, { sport });
    setMode('list');
    onClose();
  }, [createProfile, onClose]);

  const handleEditProfile = useCallback(async (name, color, sport) => {
    if (editingProfile) {
      await updateProfile(editingProfile.id, { name, color, sport });
    }
    setEditingProfile(null);
    setMode('list');
  }, [editingProfile, updateProfile]);

  const handleDeleteProfile = useCallback(async () => {
    if (deleteConfirm) {
      await deleteProfile(deleteConfirm.id);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, deleteProfile]);

  // Switching the active profile (also resets all data stores) lives here now,
  // so the sport-glyph header button can open this as the one profile manager.
  const handleSwitch = useCallback(async (p) => {
    if (p.isCurrent) return;
    await switchProfile(p.id);
    onClose();
  }, [switchProfile, onClose]);

  // Names of all profiles (for duplicate checking)
  const allProfileNames = useMemo(
    () => profiles.map(p => p.name).filter(Boolean),
    [profiles]
  );

  if (!isOpen) return null;

  const usedColors = profiles.map(p => p.color).filter(Boolean);

  // Names excluding the one being edited (so you can keep your own name)
  const existingNamesForEdit = editingProfile
    ? allProfileNames.filter(n => n.toLowerCase() !== (editingProfile.name || '').toLowerCase())
    : allProfileNames;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
    >
      <div className="bg-gray-800 rounded-lg w-full max-w-md border border-gray-700 max-h-[90vh] flex flex-col">
        {/* List mode */}
        {mode === 'list' && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">Manage Profiles</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors p-1 -mr-1"
              >
                <X size={20} />
              </button>
            </div>

            {/* Profile list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {profiles.map(p => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                    p.isCurrent ? 'bg-white/10' : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {/* Switch to this profile (the whole identity area is the target) */}
                  <button
                    type="button"
                    onClick={() => handleSwitch(p)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    title={p.isCurrent ? 'Active profile' : 'Switch to this profile'}
                  >
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: p.color || '#3B82F6' }}
                    >
                      {(p.name || 'D')[0].toUpperCase()}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium truncate block">
                        {p.name || 'Default'}
                      </span>
                      {p.isCurrent && (
                        <span className="text-xs text-green-400">Active</span>
                      )}
                    </div>

                    {p.isCurrent && <Check size={16} className="text-green-400 flex-shrink-0" />}
                  </button>

                  {/* Inline sport selector — change sport without opening the edit form */}
                  <InlineSportSelect
                    sport={p.sport}
                    onChange={(sportValue) => updateProfile(p.id, { sport: sportValue })}
                    onPickOther={() => { setEditingProfile(p); setMode('edit'); }}
                  />

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditingProfile(p); setMode('edit'); }}
                      className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
                      title="Edit name, color &amp; sport"
                    >
                      <Pencil size={14} />
                    </button>
                    {profiles.length > 1 && (
                      <button
                        onClick={() => setDeleteConfirm(p)}
                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors rounded"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-700">
              <Button variant="secondary" fullWidth onClick={() => setMode('add')} icon={null}>
                + Add Profile
              </Button>
              {profiles.length <= 1 && (
                <p className="text-xs text-gray-400 mt-3 text-center leading-relaxed">
                  Use profiles to keep your videos and reels organized by athlete, team, sport, or season.
                </p>
              )}
            </div>
          </>
        )}

        {/* Add profile */}
        {mode === 'add' && (
          <ProfileForm
            title="Add Profile"
            usedColors={usedColors}
            existingNames={allProfileNames}
            submitLabel="Create"
            onSubmit={handleAddProfile}
            onCancel={() => setMode('list')}
          />
        )}

        {/* Edit profile */}
        {mode === 'edit' && editingProfile && (
          <ProfileForm
            title="Edit Profile"
            initialName={editingProfile.name || ''}
            initialColor={editingProfile.color}
            initialSport={editingProfile.sport || 'soccer'}
            usedColors={usedColors.filter(c => c !== editingProfile.color)}
            existingNames={existingNamesForEdit}
            submitLabel="Save"
            nameRequired={false}
            onSubmit={handleEditProfile}
            onCancel={() => { setEditingProfile(null); setMode('list'); }}
          />
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmationDialog
        isOpen={!!deleteConfirm}
        title={`Delete "${deleteConfirm?.name || 'Default'}"?`}
        message={"All clips, projects, and exports for this profile will be permanently deleted. Game videos shared with other profiles will not be affected."}
        onClose={() => setDeleteConfirm(null)}
        buttons={[
          { label: 'Cancel', onClick: () => setDeleteConfirm(null), variant: 'secondary' },
          { label: 'Delete Profile', onClick: handleDeleteProfile, variant: 'danger' },
        ]}
      />
    </div>
  );
}
