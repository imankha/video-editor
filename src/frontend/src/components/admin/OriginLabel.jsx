// T16900: origins with no source signal: `organic` (legacy, before 2026-11-17),
// `direct` (no referring website) and `other-website` (a website not on our list).
export const NO_SOURCE_ORIGINS = new Set(['organic', 'direct', 'other-website']);

// T15200: the origin dimension's "group" value, same labels as admin._channel_group.
const GROUP_LABEL = { paid: 'Paid ads', referral: 'Referral programme' };

function NotInManageCampaigns({ why }) {
  return <span className="ml-1.5 text-gray-500 text-[10px]" title={why}>not in Manage Campaigns</span>;
}

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
 *
 * T17150: `markUnregistered` (the Campaigns table's origin rows) tags an origin with no
 * campaign name, since Manage Campaigns lists only registered campaigns.
 */
export function OriginLabel({ origin, campaignName, group, markUnregistered = false }) {
  if (origin === 'referral_programme' && !campaignName) {
    return (
      <>
        <span>Referral programme</span>
        {markUnregistered && (
          <NotInManageCampaigns why="Sign-ups invited by someone who joined through a campaign, counted apart from that campaign, so Manage Campaigns does not list this row" />
        )}
      </>
    );
  }
  if (!campaignName) {
    return (
      <>
        <span>{origin}</span>
        <GroupBadge group={group} />
        {markUnregistered && (
          <NotInManageCampaigns why="Sign-ups arrived with this ref, utm or source value, but no campaign was created for it, so Manage Campaigns does not list it" />
        )}
      </>
    );
  }
  return (
    <>
      {campaignName}
      <span className="ml-1.5 text-gray-500 font-mono text-[10px]">{origin}</span>
      <GroupBadge group={group} />
    </>
  );
}
