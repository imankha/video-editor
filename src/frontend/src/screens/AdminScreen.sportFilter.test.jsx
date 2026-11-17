// T16850: one Sport control at the top of Admin (above Pulse), not inside Journey, and a
// note on each section the filter cannot split.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../config', () => ({ API_BASE: '' }));
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => mockApiFetch(...args) }));
vi.mock('../stores/creditStore', () => ({ useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) } }));
vi.mock('../components/admin/UserTable', () => ({ UserTable: () => null }));
vi.mock('../components/admin/PulseCards', () => ({ PulseCards: () => <div data-testid="pulse-cards" /> }));
vi.mock('../components/admin/ChannelsTable', () => ({ ChannelsTable: () => null }));
vi.mock('../components/admin/PlatformBreakdown', () => ({ PlatformBreakdown: () => null }));
vi.mock('../components/admin/RevenueReconciliation', () => ({ RevenueReconciliation: () => null }));
vi.mock('../components/admin/JourneyTab', () => ({ JourneyTab: () => <div data-testid="journey-root" /> }));

import { AdminScreen } from './AdminScreen';
import { useAdminStore } from '../stores/adminStore';

describe('AdminScreen Sport filter', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () => ({
      ok: true, json: async () => ({ users: [], page: 1, total_pages: 1, total_users: 0, page_size: 10 }),
    }));
    useAdminStore.setState({ segmentSport: null, fetchDashboard: vi.fn() });
  });

  it('sits at the top, above Pulse and outside Journey', () => {
    render(<AdminScreen onBack={() => {}} />);
    const group = screen.getByRole('group', { name: 'Sport' });
    expect(within(screen.getByTestId('journey-root').parentElement).queryByRole('group', { name: 'Sport' })).toBeNull();
    expect(group.compareDocumentPosition(screen.getByTestId('pulse-cards')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'All sports' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('picking a sport sets the filter; All sports clears it', () => {
    render(<AdminScreen onBack={() => {}} />);
    const group = screen.getByRole('group', { name: 'Sport' });
    fireEvent.click(within(group).getByRole('button', { name: 'Hockey' }));
    expect(useAdminStore.getState().segmentSport).toBe('hockey');
    fireEvent.click(within(group).getByRole('button', { name: 'All sports' }));
    expect(useAdminStore.getState().segmentSport).toBeNull();
  });

  it('notes the sections the Sport filter does not split', () => {
    render(<AdminScreen onBack={() => {}} />);
    for (const title of ['R2 Usage', 'By Sport']) {
      const header = screen.getByRole('button', { name: new RegExp(`^${title}`) });
      expect(header.textContent).toContain('Sport filter does not apply');
    }
  });
});
