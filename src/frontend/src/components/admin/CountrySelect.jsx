import { useAdminStore } from '../../stores/adminStore';

// T15100: the standing Country filter. Options are the countries signed up in the current
// window. The picked one stays listed when a narrower window no longer contains it, so the
// control never shows a filter it cannot name. The store loads the options: with the
// dashboard on mount (T8020 keeps mount to one request), then as the window changes.
export function CountrySelect() {
  const countries = useAdminStore(s => s.countries);
  const country = useAdminStore(s => s.segmentCountry);
  const setSegmentCountry = useAdminStore(s => s.setSegmentCountry);

  const absent = country && country !== 'unknown' && !countries.includes(country);
  return (
    <label className="flex items-center gap-2 text-xs text-gray-400">
      Country
      <select
        value={country ?? ''}
        onChange={e => setSegmentCountry(e.target.value || null)}
        className="rounded border border-white/10 bg-gray-900 px-2 py-1 text-xs text-gray-200"
      >
        <option value="">All</option>
        {absent && <option value={country}>{country}</option>}
        {countries.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="unknown">Unknown</option>
      </select>
    </label>
  );
}
