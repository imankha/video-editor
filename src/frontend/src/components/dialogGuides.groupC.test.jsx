/**
 * T12790: dialogs in group C each show their GUIDE.modal sentence (testid modal-guide) and
 * pulse the control the sentence names.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ profiles: [] }));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div />,
  ExpressCheckoutElement: () => <div />,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../stores', () => ({
  useProfileStore: (sel) => sel({
    profiles: h.profiles,
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    switchProfile: vi.fn(),
  }),
  useEditorStore: (sel) => sel({ setEditorMode: vi.fn(), editorMode: 'annotate' }),
  useProjectsStore: { getState: () => ({ selectedProjectId: null }) },
  EDITOR_MODES: { ADMIN: 'admin' },
}));
vi.mock('../stores/authStore', () => ({ useAuthStore: (sel) => sel({ isAdmin: false }) }));
vi.mock('./ProfileIntroSection', () => ({ ProfileIntroSection: () => <div /> }));
vi.mock('./introcards/IntroCardsModal', () => ({ IntroCardsModal: () => null }));
vi.mock('./shared', async (orig) => ({ ...(await orig()), toast: { success: vi.fn(), error: vi.fn() } }));

import apiFetch from '../utils/apiFetch';
import { useSettingsStore } from '../stores/settingsStore';
import { useCreditStore } from '../stores/creditStore';
import { GUIDE } from '../config/displayNames';
import { BuyCreditsModal } from './BuyCreditsModal';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { CreditHistoryModal } from './CreditHistoryModal';
import { PaymentResultModal } from './PaymentResultModal';
import { StorageExtensionModal } from './StorageExtensionModal';
import { ManageProfilesModal } from './ManageProfilesModal';
import { MoveToProfileModal } from './MoveToProfileModal';

const M = GUIDE.modal;
const guideText = () => screen.getByTestId('modal-guide').textContent;
const pulsing = (id) => expect(screen.getByTestId(id).className).toContain('coach-target-pulse');

beforeEach(() => {
  useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
  useCreditStore.setState({ balance: 10, loaded: true, fetchCredits: vi.fn() });
  h.profiles = [{ id: 'p1', name: 'Active Player', color: '#3B82F6', sport: 'soccer', isCurrent: true }];
  apiFetch.mockReset();
  apiFetch.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/payments/config')) {
      return Promise.resolve({ ok: true, json: async () => ({ publishable_key: 'pk_x', packs: [{ key: 'starter', credits: 60, price_cents: 500, name: 'Starter' }] }) });
    }
    if (u.includes('/payments/create-intent')) return Promise.resolve({ ok: true, json: async () => ({ client_secret: 'cs_x' }) });
    return Promise.resolve({ ok: true, json: async () => [] });
  });
});

describe('group C dialog guides (T12790)', () => {
  it('buy-credits: pick step has a sentence, pay step pulses Pay', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('60 credits')).toBeTruthy());
    expect(guideText()).toBe(M.buyCreditsPick);
    fireEvent.click(screen.getByText('60 credits'));
    await waitFor(() => expect(screen.getByTestId('buy-credits-pay')).toBeTruthy());
    expect(guideText()).toBe(M.buyCreditsPay);
    // Pay is disabled until Stripe is ready, so only the sentence is asserted for the pay step here.
  });

  it('insufficient-credits', () => {
    render(<InsufficientCreditsModal required={5} available={1} videoSeconds={5} onClose={vi.fn()} onBuyCredits={vi.fn()} />);
    expect(guideText()).toBe(M.insufficientCredits);
    pulsing('insufficient-credits-buy');
  });

  it('credit-history', async () => {
    render(<CreditHistoryModal onClose={vi.fn()} />);
    expect(guideText()).toBe(M.creditHistory);
  });

  it('payment-result success and failure', () => {
    const { unmount } = render(<PaymentResultModal result={{ status: 'success', credits: 5, balance: 9 }} onClose={vi.fn()} />);
    expect(guideText()).toBe(M.paymentSuccess);
    pulsing('payment-result-ok');
    unmount();
    render(<PaymentResultModal result={{ status: 'failed' }} onClose={vi.fn()} />);
    expect(guideText()).toBe(M.paymentFailed);
    pulsing('payment-result-ok');
  });

  it('storage-extension', () => {
    render(<StorageExtensionModal game={{ id: 1, name: 'g', video_size: 1024 ** 3, storage_expires_at: new Date(Date.now() + 864e5).toISOString() }} onClose={vi.fn()} />);
    expect(guideText()).toBe(M.storageExtension);
    pulsing('storage-extend-submit');
  });

  it('profiles: list then add then edit', () => {
    const { unmount } = render(<ManageProfilesModal isOpen onClose={vi.fn()} />);
    expect(guideText()).toBe(M.profilesList);
    pulsing('manage-profiles-add');
    fireEvent.click(screen.getByText('+ Add Profile'));
    expect(guideText()).toBe(M.profileAdd);
    // Submit is disabled (and so not pulsing) until a name is typed.
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Fall/), { target: { value: 'New Kid' } });
    pulsing('profile-form-submit');
    unmount();
    render(<ManageProfilesModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/Edit name/));
    expect(guideText()).toBe(M.profileEdit);
    pulsing('profile-form-submit');
  });

  it('move-profile: pick then confirm', () => {
    render(<MoveToProfileModal videoIds={[1]} otherProfiles={[{ id: 'p2', name: 'Kid Two' }]} moving={false} onMove={vi.fn()} onClose={vi.fn()} />);
    expect(guideText()).toBe(M.moveProfilePick);
    fireEvent.click(screen.getByText('Kid Two'));
    expect(guideText()).toBe(M.moveProfileConfirm);
    pulsing('move-to-profile-confirm');
  });
});
