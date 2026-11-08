// T15200: the origin dimension's "group" value, same labels as admin._channel_group.
const GROUP_LABEL = { paid: 'Paid ads', referral: 'Referral programme' };

function GroupBadge({ group }) {
  if (!group) return null;
  return <span className="ml-1.5 text-gray-500 text-[10px] uppercase">{GROUP_LABEL[group]}</span>;
}

/**
 * T13980: the one place an origin is turned into a label. A registered
 * campaign's origin is its short id; show the campaign's name with the id muted
 * beside it. Any other origin (organic, seo, invite origins, ad-manager utm
 * values) shows as the raw string, as before.
 *
 * T15200: `group` ("paid" | "referral" | null/undefined, origin dimension only) labels
 * which side of the Paid-ads / Referral-programme separation this row is on. The
 * synthetic `referral_programme` origin value (a referred sign-up whose inherited origin
 * would otherwise be a campaign id) has no campaign name, so it falls through to showing
 * the raw string -- give it a readable label instead of the internal bucket name.
 */
export function OriginLabel({ origin, campaignName, group }) {
  if (origin === 'referral_programme' && !campaignName) {
    return 'Referral programme';
  }
  if (!campaignName) return <>{origin}<GroupBadge group={group} /></>;
  return (
    <>
      {campaignName}
      <span className="ml-1.5 text-gray-500 font-mono text-[10px]">{origin}</span>
      <GroupBadge group={group} />
    </>
  );
}
