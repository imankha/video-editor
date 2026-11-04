// T14640: sharing, credits, profiles, guidance, ranking and account copy follows the copy
// glossary (.claude/references/copy-glossary.md). One dead-link message, "Turn off link",
// "Credit history", "intro card", "athlete", "Guidance", price packs counted in highlights.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import * as names from './displayNames';
import * as pricing from './pricing';
import { nextCardName } from '../components/introcards/introCardDefaults';
import { ConsentGate } from '../components/introcards/ConsentGate';
import { IntroExposureNotice } from '../components/introcards/IntroExposureNotice';
import { HeroIntroModal } from '../components/ranking/HeroIntroModal';
import { StorageExpiryBanner } from '../components/StorageExpiryBanner';
import { SHARE_CLIP_SCOPE_LABEL } from '../constants/shareClipScope';
import { CreditHistoryModal } from '../components/CreditHistoryModal';
import apiFetch from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

afterEach(cleanup);

const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const source = (rel) => stripComments(readFileSync(resolve(__dirname, '..', rel), 'utf8'));

// Exact retired strings, per file. An exact list, because these files keep code identifiers
// (handleRevoke, recipient_email, ConfidenceBanner) that a word regex would catch.
const RETIRED = {
  'components/ShareModal.jsx': ['Shares sent', 'Copy share link', 'Revoke access', 'Loading shares'],
  'components/ShareGameModal.jsx': [
    'Revoke this game link?', 'Revoke link', 'Revoking', 'different URL', 'Link revoked', 'Game link revoked',
    'recipient${', 'team recap', 'toast.success(url)', 'Enter email addresses',
  ],
  'components/SharePlaybackDialog.jsx': ['recipient${', 'press Enter', 'Enter email addresses'],
  'components/ShareWithTeammatesModal.jsx': [
    'Share With Teammates', 'claim', 'Press Enter', 'Enter email addresses', 'have been shared with',
    'email mappings...',
  ],
  'components/CollectionShareModal.jsx': ['Shares sent', 'Collection shared', 'for this collection', 'Manage Profile ->', 'Frozen when'],
  'components/SharedCollectionView.jsx': ['no longer active', 'Share link not found', 'This collection is restricted', '>Sign In<'],
  'components/SharedVideoOverlay.jsx': ['no longer active', 'Share link not found', 'This video is restricted', 'Sign In', 'Invite a Friend', 'Shared Video'],
  'components/SharedAnnotationView.jsx': ['no longer active', 'Share link not found', 'Invite a Friend', 'Loading shared highlights'],
  'components/SharedGameView.jsx': ['team recap', 'recap is', 'no longer active', 'could not be found'],
  'components/DraftReelPreview.jsx': ['copied to clipboard', 'Shared version', 'get a share link'],
  'components/PublishedReelsPanel.jsx': ['copied to clipboard', 'Public link copied', 're-rank this one', 'ranking game', 'Manage Profile ->'],
  'components/BuyCreditsModal.jsx': ['Buy Credits', 'Creating a highlight costs', 'generated highlights', 'Most Popular', 'Best Value'],
  'components/CreditHistoryModal.jsx': ['Usage history', 'Admin grant', 'Balance adjustment', 'Video generation', 'Generation refund', 'Signup bonus', 'Welcome credits', 'Footage added', 'Clip upload'],
  'components/CreditBalance.jsx': ['click to buy'],
  'components/InsufficientCreditsModal.jsx': ['Insufficient Credits', 'Buy Credits', 'This generation requires'],
  'components/PaymentResultModal.jsx': ['Credits Added!', 'Payment Issue', 'Something went wrong'],
  'components/StorageExtensionModal.jsx': ['Extend Storage', 'Extend by:'],
  'components/StorageExpiryBanner.jsx': ['generated everything', 'annotations'],
  'components/SourceExpiredPanel.jsx': ['Source video expired', 'source video', 'original footage', 'generated this highlight'],
  'components/ExpirationBadge.jsx': ['click to extend'],
  'components/GameTile.jsx': ['Generated everything'],
  'screens/ProjectsScreen.jsx': ['This upload requires'],
  'components/ManageProfilesModal.jsx': ['Manage Profiles', 'Add Profile', 'Edit Profile', 'Delete Profile', 'Athlete Intro Card', 'generated videos', 'projects, and'],
  'components/ProfileIntroSection.jsx': ['Athlete Intro Card', 'likeness', 'Full Name'],
  'components/introcards/ConsentGate.jsx': ['Athlete Intro Card', 'likeness', 'player'],
  'components/introcards/IntroCardCarousel.jsx': ['Athlete Intro Card', 'New card'],
  'components/introcards/IntroCardGrid.jsx': ['Athlete Intro Card', 'New card', 'Delete card', 'your player'],
  'components/introcards/IntroCardPicker.jsx': ['Athlete Intro Card', 'Manage Profile ->', 'Attach your new card'],
  'components/introcards/IntroCardRail.jsx': ['>Add it<', 'Add it\n', 'share link'],
  'components/introcards/IntroCardsModal.jsx': ['Athlete Intro Card'],
  'components/introcards/IntroExposureNotice.jsx': ['This card includes'],
  'components/instructions/GuidanceToggle.jsx': ['Helpful instructions'],
  'components/AccountSettings.jsx': ['Account Settings', 'Sign Out', 'email code', 'helpful instructions', 'Delete My Account', 'Your Privacy Rights', 'Link Account', 'Google Account', 'Delete Forever'],
  'components/QuestIcon.jsx': ['Quests'],
  'components/ranking/ConfidenceBanner.jsx': ['head-to-head', 'Ranking Progress', 'All Highlights Ranked'],
  'components/ranking/RankingGame.jsx': ['Rematch', 'matchups', 'Loading matchup', 'Which is better', 'Ranking Progress'],
  'components/ranking/HeroIntroModal.jsx': ['Which is better'],
  'components/collections/CollectionPlayer.jsx': ['Re-rank this highlight'],
  'components/auth/OtpAuthForm.jsx': ['Send Code', 'Resend code', 'Use different email'],
  'components/AuthGateModal.jsx': ['annotations'],
  'components/SignInButton.jsx': ['Sign In'],
  'components/ProfileDropdown.jsx': ['Sign In', 'Sign Out', 'Account Settings'],
  'components/SignInScreen.jsx': ['game film'],
  'hooks/useDownloads.js': ['Athlete Intro Card'],
};

describe('T14640 retired copy', () => {
  it.each(Object.entries(RETIRED))('%s no longer ships the retired strings', (file, words) => {
    const code = source(file);
    expect(words.filter((w) => code.includes(w))).toEqual([]);
  });
});

describe('T14640 sharing', () => {
  it('has one dead-link message and one restricted message', () => {
    expect(names.SHARE_COPY?.DEAD_LINK).toBe('This link no longer works.');
    expect(names.SHARE_COPY?.RESTRICTED).toBe(
      'Only people it was shared with can watch. Sign in with the email the link was sent to.',
    );
  });

  it.each([
    'components/SharedCollectionView.jsx', 'components/SharedVideoOverlay.jsx',
    'components/SharedAnnotationView.jsx', 'components/SharedGameView.jsx',
  ])('%s reads the one dead-link message', (file) => {
    expect(source(file)).toContain('SHARE_COPY.DEAD_LINK');
  });

  it('uses one email hint and Turn off link', () => {
    expect(names.SHARE_COPY?.EMAIL_HINT).toBe('Add emails, separated by commas');
    expect(names.SHARE_COPY?.TURN_OFF_LINK).toBe('Turn off link');
    expect(names.SHARE_COPY?.STOP_SHARING).toBe('Stop sharing');
    expect(names.SHARE_COPY?.LINK_COPIED).toBe('Link copied');
  });

  it('counts people with one helper', () => {
    expect(names.SHARE_COPY?.gameSharedWith?.(1)).toBe('Game shared with 1 person');
    expect(names.SHARE_COPY?.gameSharedWith?.(3)).toBe('Game shared with 3 people');
  });

  it('calls marked moments plays in the per-person scope picker', () => {
    expect(Object.values(SHARE_CLIP_SCOPE_LABEL)).toEqual([
      'All team plays', "Only plays they're tagged in", 'Game only (no plays)',
    ]);
  });

  it('drops share as a noun from the publish flow', () => {
    expect(names.RESULT_PUBLISH.PUBLISH_GET_LINK).toBe('Get link');
    expect(names.RESULT_PUBLISH.REVIEW_CONFIRM).toBe('Create link');
    expect(names.RESULT_PUBLISH.UPDATE_SHARED).toBe('Update link');
    expect(names.RESULT_PUBLISH.UPDATE_SHARED_HINT).not.toMatch(/generated/i);
  });
});

describe('T14640 credits and storage', () => {
  it('names credit history rows the way a parent would', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, amount: -5, source: 'framing_usage', created_at: '2026-11-01 10:00:00' },
        { id: 2, amount: 5, source: 'framing_refund', created_at: '2026-11-01 09:00:00' },
        { id: 3, amount: -2, source: 'game_video_add', created_at: '2026-11-01 08:00:00' },
        { id: 4, amount: 10, source: 'admin_grant', created_at: '2026-11-01 07:00:00' },
        { id: 5, amount: 10, source: 'set_to_40', created_at: '2026-11-01 06:00:00' },
      ],
    });
    render(<CreditHistoryModal onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Credit history' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Highlight')).toBeTruthy());
    expect(screen.getByText('Highlight refund')).toBeTruthy();
    expect(screen.getByText('Video added to a game')).toBeTruthy();
    expect(screen.getAllByText('Bonus credits')).toHaveLength(2);
  });

  it('counts price packs in highlights, with the same arithmetic', () => {
    expect(pricing.approxHighlights?.(140)).toBe(10);
    expect(pricing.CREDITS_PER_HIGHLIGHT).toBeGreaterThan(0);
    expect(pricing.approxPlays).toBeUndefined();
  });

  it('states the upload price the way the task words it', () => {
    expect(names.CREDIT_COPY?.uploadCost?.(1)).toBe('Adding this game costs 1 credit and keeps it for 30 days.');
    expect(names.CREDIT_COPY?.uploadCost?.(4)).toBe('Adding this game costs 4 credits and keeps it for 30 days.');
  });

  it('shares one expiry reassurance between the game tile and the banner', () => {
    render(<StorageExpiryBanner atRiskGameCount={1} dependentDraftCount={1} onExtend={() => {}} onDismiss={() => {}} />);
    expect(names.STORAGE_COPY?.EXPIRY_REASSURANCE).toBeTruthy();
    expect(screen.getByText(names.STORAGE_COPY?.EXPIRY_REASSURANCE ?? 'missing')).toBeTruthy();
    expect(source('components/GameTile.jsx')).toContain('STORAGE_COPY.EXPIRY_REASSURANCE');
  });

  it('retires generate and draft words from the retention lines', () => {
    expect(names.RETENTION.EXPORTED).not.toMatch(/generate/i);
    expect(names.RETENTION.DRAFT).not.toMatch(/generate|draft|source/i);
  });
});

describe('T14640 profiles and intro cards', () => {
  it('generates intro card names, and still sees old stored names', () => {
    expect(nextCardName([])).toBe('Intro card 1');
    expect(nextCardName([{ name: 'Intro card 1' }, { name: 'Athlete Intro Card 2' }])).toBe('Intro card 3');
  });

  it('asks for consent in two short sentences that keep all three promises', () => {
    render(<ConsentGate onBack={() => {}} onConsent={() => {}} />);
    const line = names.INTRO_COPY?.CONSENT_LINE ?? '';
    expect(screen.getByText(line || 'missing')).toBeTruthy();
    expect(line.split('. ')).toHaveLength(2);
    expect(line).toMatch(/parent or guardian/);
    expect(line).toMatch(/agree/);
    expect(line).toMatch(/anyone/i);
    expect(line).not.toMatch(/attest|likeness|player/i);
  });

  it('says intro card in the public exposure notice', () => {
    render(<IntroExposureNotice />);
    expect(screen.getByText(/This intro card includes a photo\./)).toBeTruthy();
  });
});

describe('T14640 guidance and ranking', () => {
  it('counts progress as Getting started, never Quests', () => {
    expect(names.GUIDANCE_COPY?.gettingStarted?.(3, 7)).toBe('Getting started: 3 of 7');
  });

  it('names the ranking step by what the parent does', () => {
    render(<HeroIntroModal onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Pick the better highlight' })).toBeTruthy();
    expect(names.RANKING_COPY?.UNDO).toBe('Undo last pick');
    expect(names.RANKING_COPY?.favorite?.(3)).toBe('Your #3 favorite highlight this season');
  });
});

describe('T14640 account', () => {
  it('uses sentence case and the agreed sign-in words', () => {
    expect(names.ACCOUNT_COPY?.SEND_CODE).toBe('Send code');
    expect(names.ACCOUNT_COPY?.RESEND_CODE).toBe('Send a new code');
    expect(names.ACCOUNT_COPY?.USE_DIFFERENT_EMAIL).toBe('Use a different email');
    expect(names.ACCOUNT_COPY?.SIGNED_IN_EMAIL).toBe('Signed in with email');
  });
});
