// T7150 -- collection public-share intro sequencing (bug 43p).
//
// The public-link path used to create the share the INSTANT "Anyone with the
// link" was toggled on, freezing whatever `introCardId` held at that moment --
// which, because the intro picker rendered BELOW the toggle, was still the
// initial `null` ("no intro"). These tests pin the fix: the intro picker comes
// first, the toggle is a pure local flip, and an explicit "Get Link" click is
// the only thing that creates the public share (freezing the intro visible at
// that instant). The email path is unchanged.
//
// Heavy children are mocked to keep this a focused unit test of the modal's own
// sequencing/state logic: IntroCardCarousel becomes two buttons that drive its
// `onSelect` (a real card id, or 0 = "No intro"); UserPicker becomes one button
// that adds a recipient. IntroCardCarousel itself is shared by the reel picker
// and collections tab and is covered by its own tests -- untouched here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// apiFetch mock (same convention as PublishedReelsPanel.intro.test.jsx): a factory
// reading a globalThis hook the test body configures per-case.
vi.mock('../utils/apiFetch', () => ({
  default: (...args) => globalThis.apiFetchImpl(...args),
}));

vi.mock('../stores/introCardStore', () => {
  const state = { cards: [], fetchCards: vi.fn() };
  const useIntroCardStore = (sel) => sel(state);
  useIntroCardStore.getState = () => state;
  return { useIntroCardStore };
});

vi.mock('../stores/profileStore', () => {
  const state = {
    profiles: [{ id: 'p1', introConsentAt: '2026-01-01T00:00:00Z' }],
    currentProfileId: 'p1',
  };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});

// Test double for the shared carousel: exposes its current selection and two
// buttons to drive onSelect (a concrete card id, and the "No intro" = 0 tile).
vi.mock('./introcards/IntroCardCarousel', () => ({
  IntroCardCarousel: ({ selectedId, onSelect }) => (
    <div data-testid="intro-carousel" data-selected={String(selectedId)}>
      <button onClick={() => onSelect(7)}>pick-card-7</button>
      <button onClick={() => onSelect(0)}>pick-no-intro</button>
    </div>
  ),
}));

vi.mock('./shared/UserPicker', () => ({
  UserPicker: ({ onChange }) => (
    <button onClick={() => onChange(['fan@example.com'])}>add-recipient</button>
  ),
}));

vi.mock('./shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { CollectionShareModal } from './CollectionShareModal';

const DEFINITION = { scope: 'game', filter: 'all', aspect_ratio: '9:16' };

// Records every POST body sent to /api/collections/share; `shareResponder`
// lets a test override the response (e.g. force a failure).
let shareCalls;
let shareResponder;

function installApiFetch() {
  shareCalls = [];
  shareResponder = null;
  globalThis.apiFetchImpl = vi.fn(async (url, opts) => {
    if (typeof url === 'string' && url.includes('/api/gallery/contacts')) {
      return { ok: true, json: async () => ({ contacts: [] }) };
    }
    if (typeof url === 'string' && url.includes('/api/collections/share')) {
      const body = JSON.parse(opts.body);
      shareCalls.push(body);
      if (shareResponder) return shareResponder(body);
      return { ok: true, json: async () => ({ shares: [{ share_token: 'tok_abc', email_sent: null }] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function renderModal() {
  return render(<CollectionShareModal definition={DEFINITION} title="My reels" onClose={() => {}} />);
}

const togglePublicOn = () => fireEvent.click(screen.getByRole('switch'));

beforeEach(() => {
  installApiFetch();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CollectionShareModal — intro sequencing (T7150)', () => {
  it('DOM order: the intro picker precedes the public toggle', () => {
    renderModal();
    const carousel = screen.getByTestId('intro-carousel');
    const toggle = screen.getByRole('switch');
    expect(carousel.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('flipping "Anyone with the link" on does NOT call the share API', async () => {
    renderModal();
    togglePublicOn();
    // give any (erroneously) fired async call a chance to land
    await Promise.resolve();
    expect(shareCalls).toHaveLength(0);
    expect(screen.getByText('Get Link')).toBeTruthy();
  });

  it('bug 43p regression: a picked intro card reaches the POST body on Get Link', async () => {
    renderModal();
    fireEvent.click(screen.getByText('pick-card-7'));
    togglePublicOn();
    fireEvent.click(screen.getByText('Get Link'));
    await waitFor(() => expect(shareCalls).toHaveLength(1));
    expect(shareCalls[0].definition.intro_card_id).toBe(7);
    expect(shareCalls[0].is_public).toBe(true);
    expect(shareCalls[0].recipient_emails).toEqual([]);
  });

  it('untouched picker freezes intro_card_id: null (the visible "No intro" state)', async () => {
    renderModal();
    togglePublicOn();
    fireEvent.click(screen.getByText('Get Link'));
    await waitFor(() => expect(shareCalls).toHaveLength(1));
    expect(shareCalls[0].definition.intro_card_id).toBeNull();
  });

  it('Get Link shows the created link', async () => {
    renderModal();
    togglePublicOn();
    fireEvent.click(screen.getByText('Get Link'));
    await waitFor(() => expect(screen.getByDisplayValue(/shared\/collection\/tok_abc/)).toBeTruthy());
  });

  it('changing the intro after a link exists clears the stale link', async () => {
    renderModal();
    togglePublicOn();
    fireEvent.click(screen.getByText('Get Link'));
    await waitFor(() => expect(screen.getByDisplayValue(/tok_abc/)).toBeTruthy());

    // change the selection -> displayed link clears, Get Link returns
    fireEvent.click(screen.getByText('pick-card-7'));
    expect(screen.queryByDisplayValue(/tok_abc/)).toBeNull();
    expect(screen.getByText('Get Link')).toBeTruthy();
  });

  it('a failed Get Link shows the error and keeps the retry button available', async () => {
    renderModal();
    shareResponder = async () => ({ ok: false, status: 500, json: async () => ({ detail: 'server exploded' }) });
    togglePublicOn();
    fireEvent.click(screen.getByText('Get Link'));
    await waitFor(() => expect(screen.getByText('server exploded')).toBeTruthy());
    // isPublic stays true so the button is still there to retry
    expect(screen.getByText('Get Link')).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('email flow still creates a share with the selected intro_card_id (unchanged)', async () => {
    renderModal();
    fireEvent.click(screen.getByText('pick-card-7'));
    fireEvent.click(screen.getByText('add-recipient'));
    fireEvent.click(screen.getByRole('button', { name: /^Share/ }));
    await waitFor(() => expect(shareCalls).toHaveLength(1));
    expect(shareCalls[0].recipient_emails).toEqual(['fan@example.com']);
    expect(shareCalls[0].definition.intro_card_id).toBe(7);
  });
});
