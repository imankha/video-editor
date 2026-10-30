/**
 * T13980: the one place an origin is turned into a label. A registered
 * campaign's origin is its short id; show the campaign's name with the id muted
 * beside it. Any other origin (organic, seo, invite origins, ad-manager utm
 * values) shows as the raw string, as before.
 */
export function OriginLabel({ origin, campaignName }) {
  if (!campaignName) return origin;
  return (
    <>
      {campaignName}
      <span className="ml-1.5 text-gray-500 font-mono text-[10px]">{origin}</span>
    </>
  );
}
