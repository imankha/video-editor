import { useState } from 'react';
import { X, Copy, Check, Pencil } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

const NAME_MAX = 80;

// T15200: admin.CampaignChannel, mirrored (checked server-side; this is display only).
const CHANNEL_OPTIONS = [
  { value: 'coach_credits', label: 'Coach credits' },
  { value: 'coach_gift', label: 'Coach gift' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'meta', label: 'Meta' },
  { value: 'club', label: 'Club' },
];

/**
 * CampaignsModal — create a named campaign and copy its attribution link (T13980).
 *
 * The link carries the campaign's short id (`?ref=<id>`); everything here shows
 * the name the admin typed, never the id as the label. Create inserts the new
 * row at the top (store insert, no refetch); the pencil renames inline. No
 * delete: user_segments.origin stores the id. NO backdrop-click close (project
 * rule) — only the X button dismisses.
 */
export function CampaignsModal({ onClose }) {
  const campaigns = useAdminStore(s => s.campaigns);
  const campaignsLoading = useAdminStore(s => s.campaignsLoading);
  const campaignsError = useAdminStore(s => s.campaignsError);
  const createCampaign = useAdminStore(s => s.createCampaign);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setCreating(true);
    setError(null);
    try {
      await createCampaign(name.trim());
      setName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-[40rem] max-w-[92vw] max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Manage Campaigns</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white" title="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="flex gap-2 mb-1">
          <input
            type="text"
            value={name}
            maxLength={NAME_MAX}
            onChange={e => { setName(e.target.value); setError(null); }}
            placeholder="Campaign name, e.g. Fall Tryouts 2026"
            className="flex-1 bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Create
          </button>
        </form>
        {error && <p className="text-red-400 text-xs mb-1">{error}</p>}
        <p className="text-gray-500 text-xs mb-4">
          Everyone who signs up through a campaign&apos;s link is attributed to it.
        </p>

        <div className="overflow-y-auto -mx-1 px-1">
          {campaignsLoading && !campaigns && <p className="text-gray-500 text-sm">Loading…</p>}
          {campaignsError && <p className="text-red-400 text-sm">Failed to load campaigns: {campaignsError}</p>}
          {campaigns && campaigns.length === 0 && (
            <p className="text-gray-500 text-sm">No campaigns yet.</p>
          )}
          {campaigns && campaigns.length > 0 && (
            <ul className="flex flex-col gap-2">
              {campaigns.map(c => <CampaignRow key={c.id} campaign={c} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignRow({ campaign }) {
  const renameCampaign = useAdminStore(s => s.renameCampaign);
  const updateCampaignSpend = useAdminStore(s => s.updateCampaignSpend);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(campaign.name);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // T15200: a separate gesture from the name pencil -- its own draft state and its own
  // Save button, so renaming never touches spend and saving spend never touches the name.
  const [channel, setChannel] = useState(campaign.channel || '');
  const [spendDollars, setSpendDollars] = useState(
    campaign.spend_cents != null ? String(campaign.spend_cents / 100) : '');
  const [landingViews, setLandingViews] = useState(
    campaign.landing_views != null ? String(campaign.landing_views) : '');
  const [platformConversions, setPlatformConversions] = useState(
    campaign.platform_conversions != null ? String(campaign.platform_conversions) : '');
  const [spendError, setSpendError] = useState(null);
  const [savingSpend, setSavingSpend] = useState(false);

  async function handleRename(e) {
    e.preventDefault();
    if (!draft.trim()) { setError('Name is required'); return; }
    try {
      await renameCampaign(campaign.id, draft.trim());
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveSpend(e) {
    e.preventDefault();
    setSavingSpend(true);
    setSpendError(null);
    try {
      await updateCampaignSpend(campaign.id, {
        channel: channel || null,
        spend_cents: spendDollars === '' ? null : Math.round(Number(spendDollars) * 100),
        landing_views: landingViews === '' ? null : Number(landingViews),
        platform_conversions: platformConversions === '' ? null : Number(platformConversions),
      });
    } catch (err) {
      setSpendError(err.message);
    } finally {
      setSavingSpend(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(campaign.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <form onSubmit={handleRename} className="flex flex-1 gap-2">
            <input
              type="text"
              value={draft}
              maxLength={NAME_MAX}
              onChange={e => { setDraft(e.target.value); setError(null); }}
              aria-label="Campaign name"
              className="flex-1 bg-gray-700 border border-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-purple-500"
              autoFocus
            />
            <button type="submit" className="text-xs text-purple-300 hover:text-purple-200">Save</button>
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(campaign.name); setError(null); }}
              className="text-xs text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white text-sm truncate">{campaign.name}</span>
            <button
              onClick={() => setEditing(true)}
              className="text-gray-500 hover:text-gray-300 shrink-0"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
        <span className="text-gray-400 text-xs shrink-0">
          {campaign.signups} signup{campaign.signups === 1 ? '' : 's'} · {campaign.created_at.slice(0, 10)}
        </span>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          readOnly
          value={campaign.url}
          aria-label={`Link for ${campaign.name}`}
          onFocus={e => e.target.select()}
          className="flex-1 bg-gray-900/60 border border-white/10 rounded px-2 py-1 text-gray-300 text-xs font-mono"
        />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 shrink-0"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <form onSubmit={handleSaveSpend} className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-white/5">
        <select
          value={channel}
          onChange={e => setChannel(e.target.value)}
          aria-label={`Channel for ${campaign.name}`}
          className="bg-gray-700 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-purple-500"
        >
          <option value="">Channel…</option>
          {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="number" min="0" step="0.01"
          value={spendDollars}
          onChange={e => setSpendDollars(e.target.value)}
          placeholder="Spend $"
          aria-label={`Spend for ${campaign.name}`}
          className="w-24 bg-gray-700 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-purple-500"
        />
        <input
          type="number" min="0" step="1"
          value={landingViews}
          onChange={e => setLandingViews(e.target.value)}
          placeholder="Landing views"
          aria-label={`Landing views for ${campaign.name}`}
          className="w-28 bg-gray-700 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-purple-500"
        />
        <input
          type="number" min="0" step="1"
          value={platformConversions}
          onChange={e => setPlatformConversions(e.target.value)}
          placeholder="Platform conversions"
          aria-label={`Platform conversions for ${campaign.name}`}
          className="w-32 bg-gray-700 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-purple-500"
        />
        <button
          type="submit"
          disabled={savingSpend}
          className="text-xs text-purple-300 hover:text-purple-200 disabled:opacity-50"
        >
          Save spend
        </button>
        {campaign.spend_updated_at && (
          <span className="text-gray-500 text-[11px]">updated {campaign.spend_updated_at.slice(0, 10)}</span>
        )}
      </form>
      {spendError && <p className="text-red-400 text-xs mt-1">{spendError}</p>}
    </li>
  );
}
