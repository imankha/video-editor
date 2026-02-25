import { useState, useEffect, useCallback } from 'react';
import { X, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { Button, ConfirmationDialog } from './shared';
import { useProfileStore } from '../stores';

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

function ProfileForm({ title, initialName = '', initialColor, usedColors, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor || getNextColor(usedColors));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), color);
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
          <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan"
            maxLength={30}
            autoFocus
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
          <ColorSelector value={color} onChange={setColor} usedColors={usedColors} />
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="flex-1" disabled={!name.trim() || submitting} loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Add First Profile Flow (name current + new)
// ---------------------------------------------------------------------------

function AddFirstProfileFlow({ currentProfile, usedColors, onComplete, onCancel }) {
  const [step, setStep] = useState(1);
  const [currentName, setCurrentName] = useState(currentProfile?.name || '');
  const [currentColor, setCurrentColor] = useState(currentProfile?.color || PROFILE_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);

  if (step === 1) {
    return (
      <div>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-lg font-bold text-white">Name Your Current Profile</h2>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-400">
            Before adding a new profile, let's name your current one so you can tell them apart.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={currentName}
              onChange={(e) => setCurrentName(e.target.value)}
              placeholder="e.g. Marcus"
              maxLength={30}
              autoFocus
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Color</label>
            <ColorSelector value={currentColor} onChange={setCurrentColor} usedColors={[]} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!currentName.trim()} onClick={() => setStep(2)}>
            Next
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: Name the new profile
  return (
    <ProfileForm
      title="Name the New Profile"
      usedColors={[currentColor]}
      submitLabel={submitting ? 'Creating...' : 'Create'}
      onCancel={() => setStep(1)}
      onSubmit={async (newName, newColor) => {
        setSubmitting(true);
        try {
          await onComplete(currentName.trim(), currentColor, newName, newColor);
        } finally {
          setSubmitting(false);
        }
      }}
    />
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
 * - 'add': Add a new profile (2+ profiles already exist)
 * - 'add-first': Add first additional profile (names both current and new)
 * - 'edit': Edit an existing profile's name and color
 */
export function ManageProfilesModal({ isOpen, onClose }) {
  const profiles = useProfileStore(state => state.profiles);
  const createProfile = useProfileStore(state => state.createProfile);
  const updateProfile = useProfileStore(state => state.updateProfile);
  const deleteProfile = useProfileStore(state => state.deleteProfile);

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

  const handleAddClick = useCallback(() => {
    if (profiles.length < 2) {
      setMode('add-first');
    } else {
      setMode('add');
    }
  }, [profiles.length]);

  const handleAddComplete = useCallback(async (currentName, currentColor, newName, newColor) => {
    // First update the current profile's name
    const currentProfile = profiles.find(p => p.isCurrent);
    if (currentProfile) {
      await updateProfile(currentProfile.id, { name: currentName, color: currentColor });
    }
    // Then create the new profile (this triggers a switch)
    await createProfile(newName, newColor);
    setMode('list');
    onClose();
  }, [profiles, updateProfile, createProfile, onClose]);

  const handleAddProfile = useCallback(async (name, color) => {
    await createProfile(name, color);
    setMode('list');
    onClose();
  }, [createProfile, onClose]);

  const handleEditProfile = useCallback(async (name, color) => {
    if (editingProfile) {
      await updateProfile(editingProfile.id, { name, color });
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

  if (!isOpen) return null;

  const usedColors = profiles.map(p => p.color).filter(Boolean);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget && mode === 'list') onClose(); }}
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
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
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
                      <span className="text-xs text-gray-400">Active</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingProfile(p); setMode('edit'); }}
                      className="p-1.5 text-gray-400 hover:text-white transition-colors rounded"
                      title="Edit"
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
              <Button variant="secondary" fullWidth onClick={handleAddClick} icon={null}>
                + Add Profile
              </Button>
            </div>
          </>
        )}

        {/* Add first profile flow (name current + new) */}
        {mode === 'add-first' && (
          <AddFirstProfileFlow
            currentProfile={profiles.find(p => p.isCurrent) || profiles[0]}
            usedColors={usedColors}
            onComplete={handleAddComplete}
            onCancel={() => setMode('list')}
          />
        )}

        {/* Add additional profile */}
        {mode === 'add' && (
          <ProfileForm
            title="Add Profile"
            usedColors={usedColors}
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
            usedColors={usedColors.filter(c => c !== editingProfile.color)}
            submitLabel="Save"
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
