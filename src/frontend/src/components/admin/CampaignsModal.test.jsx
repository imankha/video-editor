import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../../utils/apiFetch';
import { useAdminStore } from '../../stores/adminStore';
import { CampaignsModal } from './CampaignsModal';

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const EXISTING = {
  id: 'p4q9r', name: 'Spring Clinic', url: 'http://localhost:5173/?ref=p4q9r',
  created_at: '2026-10-01T12:00:00+00:00', signups: 4,
};

describe('CampaignsModal (T13980)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAdminStore.setState({
      campaigns: [EXISTING], campaignsLoading: false, campaignsError: null, channelsData: null,
    });
  });

  it('lists campaigns by name with their link', () => {
    render(<CampaignsModal onClose={() => {}} />);
    expect(screen.getByText('Spring Clinic')).toBeTruthy();
    expect(screen.getByLabelText('Link for Spring Clinic').value).toBe(EXISTING.url);
    expect(screen.queryByText('p4q9r')).toBeNull();
  });

  it('Create posts the name and puts the new campaign on top, labelled by name', async () => {
    const created = {
      id: 'k7x2m', name: 'Fall Tryouts 2026', url: 'http://localhost:5173/?ref=k7x2m',
      created_at: '2026-10-30T12:00:00+00:00', signups: 0,
    };
    apiFetch.mockResolvedValueOnce(jsonResponse(created));
    render(<CampaignsModal onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Campaign name/), { target: { value: '  Fall Tryouts 2026 ' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(screen.getByText('Fall Tryouts 2026')).toBeTruthy());
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/campaigns$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Fall Tryouts 2026' });
    expect(useAdminStore.getState().campaigns.map(c => c.id)).toEqual(['k7x2m', 'p4q9r']);
    expect(screen.getByLabelText('Link for Fall Tryouts 2026').value).toBe(created.url);
    expect(screen.queryByText('k7x2m')).toBeNull();
  });

  it('shows the server error on a duplicate name and keeps the list unchanged', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({ detail: 'A campaign named "spring clinic" already exists' }, 409));
    render(<CampaignsModal onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Campaign name/), { target: { value: 'spring clinic' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    expect(useAdminStore.getState().campaigns).toEqual([EXISTING]);
  });

  it('rename patches the campaign and the Campaign table label for that origin', async () => {
    useAdminStore.setState({ channelsData: { channels: [{ origin: 'p4q9r', campaign_name: 'Spring Clinic' }] } });
    apiFetch.mockResolvedValueOnce(jsonResponse({ id: 'p4q9r', name: 'Spring Clinic (U10)' }));
    render(<CampaignsModal onClose={() => {}} />);

    fireEvent.click(screen.getByTitle('Rename'));
    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Spring Clinic (U10)' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Spring Clinic (U10)')).toBeTruthy());
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/campaigns\/p4q9r$/);
    expect(opts.method).toBe('PATCH');
    expect(useAdminStore.getState().channelsData.channels[0].campaign_name).toBe('Spring Clinic (U10)');
  });

  it('Save spend patches only the spend fields, and nothing saves until the gesture', async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({
      id: 'p4q9r', name: 'Spring Clinic', channel: 'coach_credits', spend_cents: 5000,
      landing_views: 400, platform_conversions: 50, spend_updated_at: '2026-11-08T00:00:00+00:00',
    }));
    render(<CampaignsModal onClose={() => {}} />);

    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Channel for Spring Clinic'), { target: { value: 'coach_credits' } });
    fireEvent.change(screen.getByLabelText('Spend for Spring Clinic'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Landing views for Spring Clinic'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Platform conversions for Spring Clinic'), { target: { value: '50' } });
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Save spend'));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/admin\/campaigns\/p4q9r$/);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({
      channel: 'coach_credits', spend_cents: 5000, landing_views: 400, platform_conversions: 50,
    });
    await waitFor(() => expect(useAdminStore.getState().campaigns[0].spend_cents).toBe(5000));
    expect(screen.getByText(/updated 2026-11-08/)).toBeTruthy();
  });
});
