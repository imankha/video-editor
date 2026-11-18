import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ChannelsTable } from './ChannelsTable';
import { channelsCsv } from './channelsCsv';

const CH = {
  origin: 'tiktok', signups: 3, revenue_cents: 1000, upload_success_pct: 100,
  first_highlight_14d: { aged: 24, hit: 3, pct: 12.5 }, upload_attempted: 7, upload_succeeded: 5, paywall_shown: 4, buy_modal_opened: 2, payers: 1,
  uploaded_pct: 33, clipped_pct: 33, exported_pct: 33, shared_pct: 0, purchased_pct: 33,
};

describe('ChannelsTable Unattributed remainder (T8650)', () => {
  it('renders an Unattributed row with the remainder when it is nonzero', () => {
    render(<ChannelsTable data={{ channels: [CH], unattributed_revenue_cents: 399 }} />);
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
  });

  it('hides the Unattributed row when the remainder is 0', () => {
    render(<ChannelsTable data={{ channels: [CH], unattributed_revenue_cents: 0 }} />);
    expect(screen.queryByText('Unattributed')).toBeNull();
  });

  it('still shows the remainder when there are no campaign rows (Gap 3)', () => {
    // Only deleted payers: no channels, but money must not be hidden behind
    // "No campaign data available."
    render(<ChannelsTable data={{ channels: [], unattributed_revenue_cents: 399 }} />);
    expect(screen.queryByText('No campaign data available.')).toBeNull();
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
  });

  it('shows the empty message only when there are no rows AND no remainder', () => {
    render(<ChannelsTable data={{ channels: [], unattributed_revenue_cents: 0 }} />);
    expect(screen.getByText('No campaign data available.')).toBeTruthy();
    expect(screen.queryByText('Unattributed')).toBeNull();
  });
});

describe('ChannelsTable campaign label (T13980)', () => {
  it('shows a registered campaign by its name, with the id muted beside it', () => {
    render(<ChannelsTable data={{
      channels: [{ ...CH, origin: 'k7x2m', campaign_name: 'Fall Tryouts 2026' }],
      unattributed_revenue_cents: 0,
    }} />);
    const name = screen.getByText('Fall Tryouts 2026');
    const id = screen.getByText('k7x2m');
    expect(name.contains(id)).toBe(true);
    expect(id.className).toContain('text-gray-500');
  });

  it('shows a non-campaign origin as the raw string', () => {
    render(<ChannelsTable data={{
      channels: [{ ...CH, origin: 'my-ad-manager-name', campaign_name: null }],
      unattributed_revenue_cents: 0,
    }} />);
    expect(screen.getByText('my-ad-manager-name')).toBeTruthy();
  });
});

describe('ChannelsTable paid-ads vs referral-programme (T15200)', () => {
  it('labels a paid campaign row "Paid ads" and a referral_programme row "Referral programme", never crossed', () => {
    render(<ChannelsTable data={{
      channels: [
        { ...CH, origin: 'k7x2m', campaign_name: 'Fall Tryouts 2026', group: 'paid' },
        { ...CH, origin: 'referral_programme', campaign_name: null, group: 'referral' },
      ],
    }} />);
    const name = screen.getByText('Fall Tryouts 2026');
    expect(name.textContent).toContain('Paid ads');
    expect(screen.getByText('Referral programme')).toBeTruthy();
    expect(screen.queryByText('referral_programme')).toBeNull();
  });
});

describe('ChannelsTable dimension read-out (T15120)', () => {
  const SRC = { ...CH, origin: undefined, utm_source: 'meta', campaign_name: null };

  it('offers the ten dimensions and reports a change', () => {
    const onByChange = vi.fn();
    render(<ChannelsTable data={{ channels: [CH] }} by="origin" onByChange={onByChange} />);
    const picker = screen.getByLabelText('Group by');
    expect([...picker.options].map(o => o.textContent)).toEqual(
      ['Origin', 'Campaign', 'Source', 'Medium', 'Term', 'Content', 'Click source',
        'Referral channel', 'Referring website', 'Country'],
    );
    fireEvent.change(picker, { target: { value: 'utm_source' } });
    expect(onByChange).toHaveBeenCalledWith('utm_source');
  });

  it('keeps the picker when a dimension has no rows, so a failed load is not a dead end', () => {
    render(<ChannelsTable data={null} by="utm_source" onByChange={() => {}} />);
    expect(screen.getByLabelText('Group by').value).toBe('utm_source');
  });

  it('labels rows by the chosen dimension', () => {
    render(<ChannelsTable data={{ channels: [SRC] }} by="utm_source" />);
    expect(screen.getByText('meta')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeTruthy();
  });

  it('origin rows click through; other dimensions do not, and say so', () => {
    const onRowClick = vi.fn();
    const { rerender } = render(<ChannelsTable data={{ channels: [CH] }} by="origin" onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('tiktok'));
    expect(onRowClick).toHaveBeenCalledWith('tiktok');
    expect(screen.queryByText(/Only Origin and Country rows filter/)).toBeNull();

    onRowClick.mockClear();
    rerender(<ChannelsTable data={{ channels: [SRC] }} by="utm_source" onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('meta'));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByText(/Only Origin and Country rows filter/)).toBeTruthy();
  });

  it('Download CSV saves the visible rows', async () => {
    const created = [];
    global.URL.createObjectURL = vi.fn((blob) => { created.push(blob); return 'blob:x'; });
    global.URL.revokeObjectURL = vi.fn();
    const clicked = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.download); };
    render(<ChannelsTable data={{ channels: [SRC] }} by="utm_source" />);
    fireEvent.click(screen.getByText('Download CSV'));
    HTMLAnchorElement.prototype.click = orig;
    expect(clicked[0]).toMatch(/^channels-utm_source-.*\.csv$/);
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(created[0]);
    });
    expect(text).toContain('meta');
  });
});

describe('channelsCsv (T15120)', () => {
  const row = { ...CH, origin: 'tiktok', campaign_name: 'Fall, "Tryouts"' };

  it('writes every read-out column, quoting commas and quotes', () => {
    const [head, line] = channelsCsv([row], 'origin', 'Origin', 0).split('\r\n');
    expect(head).toBe(
      'Origin,Campaign name,Signups,Upload attempted,Upload succeeded,Upload success %,'
      + 'First highlight aged,First highlight hit,First highlight %,Paywall shown,Buy modal opened,Payers,Revenue USD',
    );
    expect(line).toBe('tiktok,"Fall, ""Tryouts""",3,7,5,100,24,3,12.5,4,2,1,10.00');
  });

  it('neutralizes a utm value a spreadsheet would run as a formula', () => {
    for (const bad of ['=HYPERLINK("x")', '+1', '-1', '@cmd', '\tcmd']) {
      const line = channelsCsv([{ ...row, origin: bad, campaign_name: null }], 'origin', 'Origin', 0).split('\r\n')[1];
      expect(line.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('keeps the unattributed remainder, so the file reconciles like the table', () => {
    const lines = channelsCsv([row], 'origin', 'Origin', 399).split('\r\n');
    expect(lines[2].startsWith('Unattributed,')).toBe(true);
    expect(lines[2].endsWith(',3.99')).toBe(true);
  });
});

describe('ChannelsTable by country (T15100)', () => {
  const rows = [{ ...CH, origin: undefined, country: 'US' }, { ...CH, origin: undefined, country: 'unknown' }];

  it('offers Country in the picker', () => {
    const onByChange = vi.fn();
    render(<ChannelsTable data={{ channels: [CH] }} onByChange={onByChange} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'country' } });
    expect(onByChange).toHaveBeenCalledWith('country');
  });

  it('a country row, unknown included, filters the Users table', () => {
    const onCountryClick = vi.fn();
    render(<ChannelsTable data={{ channels: rows }} by="country" onCountryClick={onCountryClick} />);
    fireEvent.click(screen.getByText('unknown'));
    expect(onCountryClick).toHaveBeenCalledWith('unknown');
    expect(screen.queryByText(/rows filter the Users table/)).toBeNull();
  });
});

describe('ChannelsTable medium, term and referring website (T16900)', () => {
  it.each([['utm_medium', 'Medium'], ['utm_term', 'Term'], ['referrer_host', 'Referring website']])(
    'groups by %s with blanks as unknown', (by, label) => {
      const rows = [{ ...CH, origin: undefined, [by]: 'some-value' }, { ...CH, origin: undefined, [by]: 'unknown' }];
      render(<ChannelsTable data={{ channels: rows }} by={by} />);
      expect(screen.getByRole('columnheader', { name: label })).toBeTruthy();
      expect(screen.getByText('some-value')).toBeTruthy();
      expect(screen.getByText('unknown')).toBeTruthy();
    },
  );

  it('explains organic in the origin view when an organic row is present', () => {
    render(<ChannelsTable data={{ channels: [{ ...CH, origin: 'organic' }] }} by="origin" />);
    expect(screen.getByText(/organic: source unknown, for sign-ups before 2026-11-17/)).toBeTruthy();
  });

  it('shows no organic note without an organic row or outside the origin view', () => {
    const { rerender } = render(<ChannelsTable data={{ channels: [{ ...CH, origin: 'direct' }] }} by="origin" />);
    expect(screen.queryByText(/organic: source unknown/)).toBeNull();
    rerender(<ChannelsTable data={{ channels: [{ ...CH, origin: undefined, utm_source: 'organic' }] }} by="utm_source" />);
    expect(screen.queryByText(/organic: source unknown/)).toBeNull();
  });
});

describe('ChannelsTable origins not in Manage Campaigns (T17150)', () => {
  it('marks an origin row with no registered campaign and says why', () => {
    render(<ChannelsTable by="origin" data={{ channels: [{ ...CH, origin: 'abc', campaign_name: null }] }} />);
    const badge = screen.getByText('not in Manage Campaigns');
    expect(badge.getAttribute('title')).toMatch(/no campaign was created/);
  });

  it('does not mark a registered campaign row', () => {
    render(<ChannelsTable by="origin" data={{ channels: [{ ...CH, origin: 'c1x9', campaign_name: 'Spring push' }] }} />);
    expect(screen.getByText('Spring push')).toBeTruthy();
    expect(screen.queryByText('not in Manage Campaigns')).toBeNull();
  });

  it('does not mark rows of a non-origin dimension', () => {
    render(<ChannelsTable by="utm_source" onByChange={() => {}} data={{ channels: [{ ...CH, utm_source: 'abc', campaign_name: null }] }} />);
    expect(screen.queryByText('not in Manage Campaigns')).toBeNull();
  });
});
