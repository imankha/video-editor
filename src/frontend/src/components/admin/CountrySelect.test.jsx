import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CountrySelect } from './CountrySelect';
import { useAdminStore } from '../../stores/adminStore';

const setSegmentCountry = vi.fn();
const options = () => [...screen.getByLabelText('Country').options].map(o => o.textContent);

describe('CountrySelect (T15100)', () => {
  beforeEach(() => {
    setSegmentCountry.mockReset();
    useAdminStore.setState({
      countries: ['US', 'DE'], segmentCountry: null, setSegmentCountry,
    });
  });
  afterEach(cleanup);

  it('offers All, the countries in the window, then Unknown', () => {
    render(<CountrySelect />);
    expect(options()).toEqual(['All', 'US', 'DE', 'Unknown']);
    expect(screen.getByLabelText('Country').value).toBe('');
  });

  it('a pick sets the filter; Unknown means no country; All clears it', () => {
    render(<CountrySelect />);
    const select = screen.getByLabelText('Country');
    fireEvent.change(select, { target: { value: 'DE' } });
    expect(setSegmentCountry).toHaveBeenLastCalledWith('DE');
    fireEvent.change(select, { target: { value: 'unknown' } });
    expect(setSegmentCountry).toHaveBeenLastCalledWith('unknown');
    fireEvent.change(select, { target: { value: '' } });
    expect(setSegmentCountry).toHaveBeenLastCalledWith(null);
  });

  it('still shows a picked country the current window does not contain', () => {
    useAdminStore.setState({ segmentCountry: 'BR' });
    render(<CountrySelect />);
    expect(options()).toEqual(['All', 'BR', 'US', 'DE', 'Unknown']);
    expect(screen.getByLabelText('Country').value).toBe('BR');
  });

  it('shows the Unknown pick once', () => {
    useAdminStore.setState({ segmentCountry: 'unknown' });
    render(<CountrySelect />);
    expect(options()).toEqual(['All', 'US', 'DE', 'Unknown']);
    expect(screen.getByLabelText('Country').value).toBe('unknown');
  });
});
