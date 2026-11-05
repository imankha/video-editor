# Club and coach kickback research for ReelBallers

Date: 2026-11-04. Author: research agent (web research only; no ReelBallers database reads).

Purpose: size what youth sports clubs and coaches are paid by vendors for putting an offer in front of their families, and compute what ReelBallers can afford to pay per sign-up given today's unit economics.

Labels: every number is marked **B** (published source: name, URL, year) or **A** (derivation with arithmetic shown). Owner-supplied model inputs are marked **O**. "Athlete" is used throughout except inside proper nouns and verbatim quotes. Nothing below assumes a sport calendar; "per cycle" means one registration cycle of whatever length the organisation runs.

## 0. ReelBallers inputs used in every computation (O unless marked A)

| Input | Value | Label |
|---|---|---|
| Pack prices | One Game $6.99, Popular $12.99, Season $29.99 (about 71 plays) | O |
| Season pack GPU cost | about $2.00 | O |
| Season pack Stripe fee | $1.17 | O |
| Gross margin per Season pack | (29.99 - 2.00 - 1.17) / 29.99 = 26.82 / 29.99 = 89.4% | A |
| GPU cost per play | 2.00 / 71 = $0.028, rounded to $0.03 | A |
| Free credits at sign-up | 48 (treated as 48 plays for costing: 48 x $0.03 = $1.44 upper bound if all used) | O, A |
| Payer rate today | 4 / 379 = 1.06% | O, A |
| Revenue per payer | $18.99 | O |
| Revenue per sign-up today | 0.0106 x 18.99 = $0.20 | A |
| Break-even cost per sign-up | $0.12 today; $1.54 in the optimistic model | O |
| Team size for schedules | 14 families | O |
| Take-up scenarios | 10% / 25% / 50% of a 14-family team = 1.4 / 3.5 / 7.0 sign-ups per team | A |

Caveat on the owner's rule ("clubs and coaches will not circulate anything without a kickback"): the research did not find a published study measuring coach acceptance of vendor asks with versus without a reward. Section 2.4 gives the nearest proxies and states the gap plainly.

## 1. Club rewards and revenue-share programmes

What a club actually earns when its families buy through the club's link, store or event, and what it must do to earn it.

### 1.1 Soccer retail: SOCCER.COM, Authentic Soccer, Capelli/Rush, 11teamsports (Germany)

| Programme | What the club gets | What the club must do | Label |
|---|---|---|---|
| SOCCER.COM Official Club Partner (team store) | The 2025 Club Partner Playbook lists the club's reward as "a rewards membership, coupon and exclusive content"; families get a free lifetime Goal Club membership (10% off every order, reward points, free shipping on required uniform orders of $125 or more) with purchase of the required uniform package. No percentage of family spend to the club is published anywhere found. Affiliate pages show individuals (not clubs) earning 7.5% to 10% of net sales. | Run the official team store, send families the ordering email. | B: SOCCER.COM Club Partner Playbook (hosted by Cutters SC), https://cutterssoccer.teamsnapsites.com/wp-content/uploads/sites/1210/2025/06/sDc-PLAYBOOK.pdf, 2025. B: FlexOffers SOCCER.COM affiliate listing, https://www.flexoffers.com/affiliate-programs/soccer-com-affiliate-program, 2026. B: Rakuten SOCCER.COM page, https://www.rakuten.com/shop/soccer, 2026. |
| Authentic Soccer team store | "Rebates are a minimum of 10% off the order total, at retail value." | Set up the club's team store with Authentic. | B: Authentic Soccer team store policies, https://www.authenticsoccer.com/my-team-policies.aspx, undated (live 2026). |
| Rush Soccer / Capelli Sport | "Rush Soccer gives back 15% of all uniform purchases to the club in Capelli promotional dollars. The club will receive the same amount in year two, even though no additional uniform purchases are required." Capelli promotional items for tournaments "anywhere from $1000-$6000 per event depending on the size of the event." Board of Directors apparel credit by club size: $1,000 under 200 athletes, $2,000 for 200 to 600, $3,000 over 600. Wilson Trophy: "8% cash back on all purchases made through Wilson Trophy for your tournaments." | Join Rush (exclusive Capelli kit). Paid in product credit, not cash. | B: Rush Soccer, Rush Benefits, https://rushsoccer.com/rush-benefits/, undated (live 2026). |
| Capelli Sport direct club deals (Lamorinda SC, Heartland, Grand Park and others) | Press releases describe exclusive supplier status; financial terms "were not disclosed." Cal South referee programme: "a percentage will go to our referee program" with no figure. | Exclusive kit supplier for the term. | B: Capelli Sport news, https://capellisport.com/blogs/news/cal-south-referee, 2024; Current, https://youarecurrent.com/2025/11/26/grand-park-reaches-apparel-agreement-with-capelli-sport/, 2025. |
| 11teamsports Vereinskasse (Germany, non-US) | Members get 15% off manufacturer RRP; "cashback" accrues to the club's Vereinskasse on every member order (rate not published) and is paid once a year on 30 June, usable only in the 11teamsports shop, and only "if the turnover target agreed in the HOC contract was reached." | Sign a HOC contract with a turnover target; members scan the club code at checkout. | B: 11teamsports, Vereinskasse, https://www.11teamsports.com/de-de/l/vereinskasse-hoc, undated (live 2026). |
| Teamo Rewards (UK, non-US) | Cashback on members' everyday online shopping flows to the club; paid quarterly; rate not published. | Club adopts Teamo. | B: Teamo, Rewards fundraising, https://teamo.chat/tweb/21/rewards-fundraising.jsp, 2023. |

Per $100 of parent spend (A): Authentic 10% = $10 credit; Rush/Capelli 15% = $15 promotional dollars (plus a second $15 in year two, so 30% over two years on one year's spend); SOCCER.COM = $0 to the club in published terms (the benefit is to the family).

### 1.2 Big-box and team-dealer programmes

| Programme | Finding | Label |
|---|---|---|
| DICK'S Sporting Goods Team Sports HQ / ScoreCard | No league or club rebate found. ScoreCard+ ($99 tier) coverage states DICK'S "is not announcing any [team, club, or league features] today." The DICK'S credit card pays 10% back in ScoreCard points to the cardholder, not to a club. | B: Youth Sports Business Report, https://youthsportsbusinessreport.com/dicks-launches-99-scorecard-extends-loyalty-rewards-to-services-for-youth-sports-families/, 2026; Synchrony, https://investors.synchrony.com/news-events/financial-news/detail/572/, 2026. |
| Academy Sports | No team or league rewards programme surfaced in any search. | Gap. |
| BSN SPORTS Sideline Store | BSN describes stores as "a no-risk source of funding"; no published rate. One school's shop states "the team receives 11% of the proceeds." | B: BSN Sideline, https://sideline.bsnsports.com/, 2026; Siuslaw School District, https://www.siuslaw.k12.or.us/article/1146406, 2024. |
| SquadLocker (also powers TeamSnap stores) | Admin sets a 5%, 10% or 15% markup on every item; the full markup is paid to the organisation by separate cheque once the balance passes about $10. | B: SquadLocker, Fundraising made easy, https://www.squadlocker.com/squad-blog/fundraising-made-easy-via-your-squadlocker-store, 2023. |

Per $100 of parent spend (A): SquadLocker $5 to $15 (parent pays the markup, so the vendor's margin is untouched); BSN about $11 at the one published school.

### 1.3 Scholastic Book Fairs (the canonical school kickback)

| Market | Terms | Label |
|---|---|---|
| US | Three revenue bands: up to $1,699; $1,700 to $3,999; $4,000 and up. "25% in cash available." Fairs scheduled 8/10/26 to 8/9/27 earning $4,000 or more "may choose 50% in Scholastic Dollars." A second Scholastic page lists: $3,800 and up = 50% Scholastic Dollars or 25% cash; $1,600 to $3,799.99 = 40% Scholastic Dollars, no cash; under $1,600 = 30% Scholastic Dollars, no cash; virtual fairs 25% Scholastic Dollars. Scholastic says choosing Scholastic Dollars earns "up to 50% more than cash." | B: Scholastic Book Fairs earnings page, https://bookfairs.scholastic.com/content/fairs/why-scholastic/earnings.html, 2026; Scholastic Dollars page, https://shop.scholastic.com/content/fairs/hub/scholastic-dollars.html, 2026. |
| Canada (non-US) | Under $2,000 after-tax sales: 15% Scholastic Dollars, no cash. $2,000 to $3,499: 30% Scholastic Dollars or 15% cash. $3,500 to $4,999: 40% Scholastic Dollars or 20% cash. Scholastic Dollars expire 24 months after issue; no cash option in Quebec. | B: Scholastic Canada, All About Scholastic Dollars, https://www2.scholastic.ca/bookfairs/?p=124, undated (live 2026). |

What the school must do: host the fair, staff it with volunteers, send the flyers home. Per $100 of parent spend at a US top-band fair (A): $25 cash or $50 product. The product-to-cash ratio is 2:1, the clearest published statement that organisations accept in-kind at double face value.

### 1.4 Youth sports photography

| Vendor | Published term | Label |
|---|---|---|
| TSS Photography (franchise) | "Competitive fundraising programs that put money back into your organization." No percentage published; set per franchise. Miracle League post: "a portion of the sales generated from those photos is donated back." | B: TSS Photography, https://tssphotography.com/?p=5021, 2024; Lillington Chamber listing for TSS of Clayton, https://members.lillingtonchamber.org/list/member/tss-photography-of-clayton-1531, 2025. |
| Independent league photographers | "We donate 10% of sales back to your organization" (Jennifer Woodard Photography). Photography proposal: 10% of all photo-day sales back to the league on a one-year commitment. Banner fundraiser: $65 banner, "$10 for each banner sold we give back to your non-profit organization" = 15.4% (A: 10 / 65). | B: https://jenniferwoodardphotography.mypixieset.com/sports-copy-1/, 2025; https://issuu.com/secogesphoto/docs/booklet, 2024; https://soulgrownphotography.mypixieset.com/sports/, 2025. |
| School photography commissions (comparable) | Schools "typically earn 15-30% of gross revenue from photo sales," which the source translates to $500 to $2,600 per year for a 500-student school. | B: Capturely, School photography pricing, https://capturely.com/?p=4186, 2026. |
| Trade guidance | "Expect to return some of your proceeds to the association to cover operating expenses." A league "will likely have a minimum package... along with a fundraising expectation." | B: PhotoDay, Bidding on youth sports jobs, https://photoday.com/blog/bidding-on-youth-sports-jobs-things-volume-photographers-should-know, 2024. |

Legends and Spoiled Rotten Photography: no published league percentage found. Per $100 of parent spend (A): $10 (youth league norm) to $15 to $30 (school norm), paid in cash after the sale. What the club must do: mandate a picture day, circulate the order form, provide the roster.

### 1.5 Fundraising platforms

| Platform | What the team keeps | Per-athlete amount raised | Label |
|---|---|---|---|
| Snap! Raise | "Organizations that we partner with keep 80% of the total dollars raised." A competitor's comparison (Jan 2026 pricing) says the 20% fee drops to 18% with team merchandise purchases; 10% for some special campaigns. Participation-goal misses carry an extra fee (specifics not public). | Oklahoma impact report: "each participant on average raised almost $1000!" against "the average fee to play sports is ~$161 per athlete" (self-reported, 2019). National page: band programmes average $7,937 per campaign; largest group 799 participants (2020). | B: Snap! Raise help desk, https://helpdesk.snapraise.com/what-does-it-cost-to-start-a-fundraiser, 2026; Zeffy comparison, https://www.zeffy.com/compare/zeffy-vs-snap-raise, 2026; Givebutter, https://givebutter.com/blog/is-snap-raise-worth-it, 2025; Snap! Raise Oklahoma, https://fundraise.snap-raise.com/oklahoma-fundraising, 2019; Snap! Raise national, https://fundraise.snap-raise.com/national-fundraising, 2020. |
| Vertical Raise | No flat fee published ("depends on three key factors"). A student paper reports a football team raised $17,812 and kept $14,249 (A: 80.0%), with another account of a 30% cut plus 3.76% transaction fee. | Not published. | B: Vertical Raise blog, https://www.verticalraise.com/blog/vertical-raise-fee, 2025; East Lansing Portrait, https://eastlansingportrait.com/4170/opinion/vertical-raise-needs-to-go/, 2024. |
| RallyUp | Free plan: 0% platform fee, donor tips. Flex: 2.9% ticketing/registration/storefront, 4.9% crowdfunding and auctions, 6.9% raffles. RallyUp+: 7.5% platform fee on Experiences, donation pages exempt. | Not published. | B: RallyUp pricing, https://rallyup.com/pricing/, 2026; RallyUp Advanced Pricing, https://learn.rallyup.com/understand-advanced-pricing, 2026. |
| FlipGive | Teams earn brand-funded cash back on everyday shopping; rates vary by brand (Nike fixed 12%; Under Armour "up to 5%" on one page and 10% on another; headline "up to 30%"). Team pages show lifetime totals from a few hundred dollars to $6,679.69 (AZ Phenoms). | Not published platform-wide. | B: FlipGive help, https://help.flipgive.com/en/articles/3528318-why-didn-t-i-earn-the-full-amount-i-should-have-for-my-purchase, 2025; FlipGive Phoenix locations page, https://flipgive.com/locations/arizona/phoenix, 2026. |

Per $100 raised (A): Snap! Raise team keeps $80; Vertical Raise about $80 (user-reported); RallyUp $92.50 to $100. The relevant lesson for ReelBallers is that teams routinely accept a 20% vendor take when the vendor does the work, and that a serious per-athlete fundraising ask is in the hundreds of dollars, not single digits.

### 1.6 Kit brand club deals

No Nike, adidas or Puma youth club deal with a published per-athlete allowance or rebate surfaced in searches. Capelli's published club figures (Rush, section 1.1) are the only brand kit numbers found: 15% of uniform spend in promotional dollars plus $1,000 to $3,000 board apparel credit by club size. Gap recorded.

### 1.7 Camera and app vendors' club deals

| Vendor | Club or team gets | Must do | Label |
|---|---|---|---|
| Trace x Florida Youth Soccer Association (2026) | "Trace is offering each Florida Youth Soccer team one (1) complimentary Trace camera and one (1) PlayerFocus Pro subscription," valid "for the first person from each team who checks out and registers members of their team"; code FYSAFREE at traceup.com/partner/fysa. PlayerFocus Pro lists at $300 per year, so the in-kind value is at least $300 per team (A) plus the camera lease. | Be an FYSA-sanctioned team; one person checks out and registers teammates (who then subscribe individually). | B: FYSA news, https://www.fysa.com/?p=13334, 2026; Trace help center pricing, https://trace.helpcenter.io/content/how-to-subscribe-to-trace-highlights-playerfocus, 2026. |
| Trace x USASA (adult) | "(1) FREE sideline camera and (1) PRO subscription for the first person who checks out," roster proof required. | Submit official league roster. | B: US Adult Soccer, https://usadultsoccer.com/?p=9653, 2025. |
| Veo state and club partnerships (FYSA, Rush, Cal South and others) | Families and clubs "are entitled to claim a $200 discount on the purchase of a Veo camera" (buyer discount, not a club payment). Seasonal promos reach $400 off with a 12-month Team subscription. Partner portal: "anytime they purchase a camera... you will be credited for the sale" (amount not published). | Partner lists Veo as official video provider and circulates the code. | B: Veo FYSA partnership page, https://www.veo.co/partnership/florida-youth-soccer-association, undated; Veo kick-off 2026, https://www.veo.com/kick-off-2026, 2026; Veo partner portal, https://share.veo.co/partner-portal, 2026. |
| NFHS Network (Pixellot cameras in high schools) | 2020 standard: "10% on the $10.99 monthly pass (for the life of the subscriber)" and a one-time $20 on the $69.99 annual pass (A: 28.6%). 2020-21 special tiers for annual passes: $20 (0 to 99 sold), $35 (100 to 399), $45 (400+). Free Pixellot units came with a $2,500 installation fee and a $1,500 charge to start revenue share immediately (otherwise revenue began in year 4 of 5). Michigan schools received $2,563,759 cumulative revenue share including $379,830 in 2025-26. | Install cameras, stream every home event, promote passes. | B: KHSAA Q&A, https://khsaa.org/?p=33383, 2020; MHSAA, https://www.mhsaa.com/live/nfhs-network, 2026. |
| Hudl club "Preferred Lineup" | Club-wide packages bundle Hudl Assist for every team, training, one invoice; no revenue share, rebate or referral reward published. | Buy club-wide. | B: Hudl, https://www.hudl.com/solutions/club/preferred-lineup, 2026. |
| GameChanger, TeamSnap, LeagueApps | No published revenue share to leagues. TeamSnap acquired LeagueSide (sponsorship brokerage) and runs brand sponsorships through organisations; terms not public. | n/a | B: TeamSnap blog, https://www.teamsnap.com/blog/clubs-leagues/teamsnap-celebrates-spring-sponsorships-1-2-million-participating-organizations, 2024. |

Per $100 of family spend (A): NFHS 10% on monthly ($10) or about 29% on annual ($20 of $69.99); Trace and Veo give the team or buyer product worth $200 to $300+ up front rather than a trailing percentage.

### 1.8 Summary band for club programmes

Cash or cash-like trailing share: 10% (photo-day norm, NFHS monthly, Authentic minimum) to 25% (Scholastic cash) with 15% a frequent midpoint (Rush/Capelli, SquadLocker option, school photo low end). In-kind share: up to 50% (Scholastic Dollars), typically double the cash offer. Up-front in-kind: $200 to $300+ per team (Trace, Veo discounts), $1,000 to $3,000 per club (Capelli board credit, Capelli tournament items). Platform take accepted by teams: 20% (Snap! Raise, Vertical Raise). All B-derived; band is A.

## 2. Coach-level incentives

### 2.1 What a coach is paid (to size a $25, $50, $100 reward)

| Market | Evidence | Label |
|---|---|---|
| US club and school coaches | Minnesota club posting: $2,500 stipend for a nine-week programme at 8 to 12 hours per week, extras at $20 per hour. Sports Backers school club stipend plan: $200 per cycle plus $50 bonus for twice-weekly. Volunteer-run developmental programme: $250 on completion. Select coaches "roughly $200 to $400 per month, but some aren't paid at all." Soccer Shots: $19 per session. | B: Career.com Tonka United posting, https://www.career.com/job/tonka-united-soccer-association/youth-soccer-coach/j202604251736200753026, 2026; Sports Backers stipend plan, https://sportsbackers.org/wp-content/uploads/2024/07/Stipend-Plan.pdf, 2024; Your Soccer Home, https://yoursoccerhome.com/how-much-a-soccer-coach-makes-with-specific-examples/, 2024; Soccer Shots careers, https://soccershotscareers.careerplug.com/jobs/3321001, 2026. |
| US volunteer share | 2018 State of Play coverage: the nation's 6.5 million youth coaches are "mostly volunteers." Adults 55+ were 40% of coaches of ages 6 to 14 in 2023. | B: Aspen Institute Project Play, State of Play 2024 coaching trends, https://projectplay.org/state-of-play-2024-coaching-trends, 2024. |
| UK (non-US) | Sessional grassroots coach adverts: "£25-£32 per session"; other adverts £10 to £15 per hour, FA Level 1 minimum for paid work. Sports Coaching in the UK III: 76% of coaches volunteer, 24% paid (all sports). | B: Jobs in Football, https://jobsinfootball.com/job/131319/sessional-football-coach/, 2025; sports coach UK via Issuu, https://issuu.com/scukres/docs/sports_coaching_in_the_uk_iii_final, 2008. |

Sizing (A): a $25 gift card equals about one UK session (£25 to £32 at roughly 1.25 to 1.30 USD per GBP, so $31 to $42; $25 is a little under one session) and 1% to 12.5% of a US cycle stipend ($25 / $2,500 to $25 / $200). A $100 card is 4% to 50% of a US cycle stipend and roughly three UK sessions. For the volunteer majority, any cash is above their coaching income; the binding constraint is effort and social cost, not price.

### 2.2 Referral bounty benchmarks (consumer products in the $20 to $300 range)

| Source | Finding | Label |
|---|---|---|
| Extole offer-structure guide | Consumer services company raised advocate reward $7 to $10: conversions 598 to 5,081 per month (+750%), conversion rate 11.78% to 34.43%. Another raised $5 to $7: share rate +25%, conversion rate -24% (6.23% to 4.68%), conversions per advocate 4.7% to 16.06%. VoIP company doubled $25 to $50 in a burst: advocacy rate 15% to 40%. Specialty retailer moved from 3:1 to 1:1 reward structure: conversion 5% to 11.8%. Copy change "15% off" to "up to $30 off": +33% conversion. "Promotions that do not show the incentive have about half the CTR's." Extole recommends testing in-kind (credit) versus external (Amazon gift card) rewards; no winner stated. | B: Extole, Create a compelling offer structure, https://success.extole.com/en/articles/10772148-create-a-compelling-offer-structure, 2025. |
| ReferralCandy benchmarks | Median ecommerce referral conversion 3% to 5%, top quartile 8%+; global average referral rate 2.35%; share click-through 10% to 25%; merchants average about 5.5% of monthly revenue from referrals. Sizing guidance: fix the reward against blended CAC (example $20 reward versus $30 CAC), use flat dollars for high-ticket orders ("Twenty percent of a $400 order is a number nobody wants to sign off on"). | B: ReferralCandy, Referral rates, https://www.referralcandy.com/blog/referral-rates, 2026; Referral program benchmarks 2025, https://www.referralcandy.com/blog/referral-program-benchmarks-whats-a-good-conversion-rate-in-2025, 2025; High-ticket brands, https://www.referralcandy.com/high-ticket-brands/, 2026. |
| Friendbuy | Examples, not benchmarks: UNTUCKit gives the advocate $25 and the friend 25% off; symmetric "Give 20%, Get 20%" structures. Secondhand: "most Friendbuy referral partners hover around $3 referral CPA." | B: Friendbuy, Referral incentive structure, https://www.friendbuy.com/blog/referral-incentive-structure, 2025; Konabayev, https://konabayev.com/blog/referral-marketing-statistics-2026/, 2026. |
| Two-sided versus one-sided | Impact: two-sided rewards can cost "up to double" a one-sided programme; adoption figures conflict (78% two-sided per one Impact citation, 26% per Referral Rock). Secondhand Extole claim of "up to 3x higher conversion" for mutual rewards, unverified. | B: Impact, 7 proven strategies, https://impact.com/referral/7-proven-strategies-for-growth/, 2025; Referral Rock reward types, https://product.referralrock.com/p/referral-reward-types, 2025. |
| Cash versus gift card versus credit | Xoxoday cites an unnamed study: non-cash incentives 24% more effective than cash for referrals; argues a multi-brand $25 card beats a single-retailer $25 card. GrowSurf: gift cards suit non-customer referrers; cash "reads as a payment" and needs a payout rail. Survey-incentive literature (the only controlled evidence found): prepaid cash beats promised and non-monetary incentives (Church 1993 meta-analysis); +0.2 percentage points response per dollar (Singer et al. 1999); money beat vouchers or lotteries in a recent systematic review of RCTs. | B: Xoxoday, https://www.xoxoday.com/blogs/plum/how-rewards-improve-referral-programs-a-data-backed-guide, 2025; GrowSurf gift card reward, https://growsurf.com/glossary/gift-card-reward/, 2025; BLS symposium summary of Church 1993 and Singer 1999, https://www.bls.gov/cex/workshop/2016/symposium/monetary-incentives-and-response-rates.pdf, 2016; PMC systematic review, https://pmc.ncbi.nlm.nih.gov/articles/PMC9844858, 2023. |

Reward-as-share-of-first-order (A, derived from published offers): UNTUCKit advocate $25 on a typical $50 to $100 shirt order = 25% to 50%; Trace $100 per referred team on a $300 PlayerFocus Pro year = 33% (both sides, 1:1); Outschool $200 once a referred teacher earns $100 = 200% of the trigger threshold (cash via PayPal); Veo buyer discount $200 on a camera-plus-subscription package of about $1,487 (EUR promo) to $1,800 to $2,200 (unofficial camera estimate) = 9% to 13%. Working benchmark band: 25% to 35% of first-order value for a referrer bounty on a sub-$300 consumer product, usually mirrored by an equal friend discount.

### 2.3 Coach- and teacher-directed bounty precedents

| Programme | Terms | Label |
|---|---|---|
| Trace referral | "You get $100 (digital gift card) for every new team that signs up with your code. Up to 3 teams." Friend: "$100 off their first year of PlayerFocus (annual subscriptions only)." Paid within 30 days via emailed redemption link; new-to-Trace customers only. | B: Trace support, https://support.traceup.com/content/trace-referral-program, 2026. |
| Veo ambassador | Buyer saves $200 / 200 EUR / AU$300 / £200 on Veo Cam 3 with an annual Team, Club or Enterprise subscription; "that's how ambassadors get rewarded" (ambassador amount not published). | B: Veo ambassador referral, https://www.veo.com/ambassador-referral, 2026. |
| Outschool teacher referral | "one-time, two hundred dollars cash ($200 USD) reward for each New Teacher Referral," paid to PayPal once the referred teacher earns $100. Parent referral: voucher only, "no cash value," amount set at redemption, 90-day expiry, triggers when the referred family attends a live class. | B: Outschool new educator referral terms, https://outschool.com/pages/outschool-new-educator-referral-program-terms, 2025; Outschool parent referral, https://support.outschool.com/en/articles/2087332-parent-referral-program, 2026. |
| Tutoring referrals (comparables) | TutorsPlus (Switzerland, non-US): CHF 50 lesson credit to both sides. Up Learn (UK, non-US): £20 to both when the friend signs up via link. Tutorful (UK): credit after the friend's first paid lesson, no cap. Varsity Tutors: no official referral terms found; third-party sites claim $100 for the referred side. | B: TutorsPlus, https://tutorsplus.com/refer-a-friend/, 2026; Up Learn, https://help.uplearn.co.uk/en/articles/7668827-how-do-referrals-work, 2025; Tutorful, https://support.tutorful.co.uk/hc/en-us/articles/360010220759, 2025. |
| Hudl, Krossover, Snap! Raise coach incentives | No coach referral or coach bounty programme published for any of the three. Snap! Raise's model pays the organisation (80% retained), not the coach personally. | Gap (searched 2026). |

### 2.4 Acceptance with versus without a reward

No published measurement of coach acceptance rates for vendor asks with versus without a reward was found. Nearest proxies: (1) the Extole burst case, where doubling a $25 reward to $50 moved advocacy from 15% to 40% of invited customers (B, section 2.2); (2) prepaid-incentive survey research, where a few dollars of unconditional cash lifts participation by single-digit percentage points and cash beats vouchers (B, section 2.2); (3) the youth sports precedents themselves, where every scaled vendor programme (Trace, Veo, Scholastic, photo day, Snap! Raise) carries a reward, and none of the searched vendors run an unrewarded "please circulate" programme. The owner's rule is consistent with the market, but it is an inference from vendor behaviour, not a measured rate.

## 3. Placement fees

### 3.1 Real club and league sponsor packets (2024 to 2026)

Lowest tier that includes a message to families (email, newsletter or social post), with the stated reach where the packet publishes one.

| Organisation (location) | Cycle | Lowest tier with an email or newsletter | Lowest tier with a social post | Stated reach | Price per family or member reached (A) | Label |
|---|---|---|---|---|---|---|
| PYSL / Blast SC (San Diego, CA) | Mar 2026 to Mar 2027 | Header $600: "Your name or logo on email communications to league participants" | Corner Kick $300: "social media shout out" | "roughly 1,400 families", "~150 teams" | Email: 600 / 1,400 = $0.43 per family for a year of logo presence. Social: 300 / 1,400 = $0.21. | B: https://pyslblast.org/sponsorships/, 2026 |
| Southside Youth Soccer (Lafayette, LA) | 2024/2025 | Halloween Havoc tournament $5,000: "Email blast to all SSYS members with logo." All-Fields Signage $6,000: "2 email blasts to all SSYS members 2x a year." Gold $20,000: "Weekly Email Blast." | Team Sponsorship $200 / $150: "Attempts will also be made for special recognition through social media." Camp Sponsor $3,000: "Social Media Blast before & after every camp." | "Over 3,500 members (Youth, Adult and camps)"; "Approx 6000 Soccer Jerseys" | One email blast: 5,000 / 3,500 = $1.43 per member (bundled with tournament banner and social). Team tier: 200 / 3,500 = $0.06 per member for a sign plus a social attempt. | B: https://www.southsideyouthsoccer.com/wp-content/uploads/2024/05/2024_2025-SSYS-Sponsorship-Booklet.pdf, 2024 |
| City of Rockville Youth Sports Leagues (MD) | annual, form dated 2025 | None (no email or social tier) | None; but Silver $300 per league includes "Opportunity to provide coupons to participants" plus logo on league schedules and a banner | Fall Soccer 350, Spring Soccer 280, Track 360, Cross Country 180, Tball 150, Basketball 1,400 participants | Coupon-to-participants at Silver: 300 / 350 = $0.86 per participant (soccer); 850 / 1,400 = $0.61 (basketball). Platinum all leagues $5,000 / 2,720 = $1.84. | B: https://www.rockvillemd.gov/wp-content/uploads/2025/09/Youth-Sports-Leagues-Sponsorship-Opportunities.pdf, 2025 |
| Liberty United Soccer Club (Liberty Hill, TX) | 2025 to 2026 | Gold 2 $1,000: "Two newsletters" plus two thank-you posts | Gold 1 $500: one thank-you post | "hundreds of local families" (no count) | Assuming 300 to 900 families: 1,000 / 900 to 1,000 / 300 = $1.11 to $3.33 per family for two newsletters and two posts (assumption flagged). | B: https://www.libertyhillsoccer.org/sponsors/, 2026 |
| Oceanside FC (Parksville, BC, Canada; non-US) | 2025 | None listed | Join the Club $250: "Facebook and Instagram post. Post includes sponsor logo." Silver $1,500 adds 3 posts. | Not stated | n/a | B: https://oceansidefc.com/wp-content/uploads/ofc_sponsorship_form_2025_rev080524-1.pdf, 2025 |
| Haverhill Youth Soccer (MA) | page dated 2022, live 2026 | None | Silver $500: "A monthly mention on our social media pages." Supporter's (under $250): one-time thank-you post. | Not stated ("Haverhill's largest athletic league") | n/a | B: https://www.haverhillyouthsoccer.org/sponsorship-opportunities, 2022 |
| Region Lacrosse (OH) | 2024 to 2025 form | Braveheart $2,000+: "Placement in the monthly newsletter." | Face-Off $250+: thank-you message; One-Timer $750+: quarterly post; Power Play $1,000+: monthly post | Not stated | n/a | B: https://regionlacrosse.org/sponsorship/, 2025 |
| Green Hills Recreation Association (MO) | 2026 | None | All tiers from Silver $400 include "recognition on the... website and social media platforms" | Not stated | n/a | B: https://www.kttn.com/recreation-association-announces-2026-sponsorship-tiers-for-youth-sports/, 2026 |
| Lincoln Sudbury Youth Baseball (MA) | 2025/2026 | Premium Team Sponsorship $1,000: "Social Media (email, TeamSnap or Facebook) blast thanking key sponsor... to all LS Youth Baseball Families with company link" (from search snippet; page returned 403) | same tier | Not stated | n/a | B: https://www.lsyb.org/Default.aspx?tabid=1718904, 2026 |

Reading the table (A): the market floor for a single social post is $250 to $300; the floor for logo presence in family emails is $600 (PYSL) to $1,000 (Liberty Hill two newsletters; LSYB one blast); a dedicated email blast at a 3,500-member club is bundled at $5,000. Where reach is published, price per family reached runs $0.43 (year-long email logo) to $1.43 (one dedicated blast with extras), and $0.61 to $0.86 per participant for a coupon-to-families right. Tournament vendor booths run $195 to $850 (Eventeny listing $195; Metro Atlanta soccer festival $850 for a 10x10; East Point World Soccer Games 2026 $370) with no email-blast fee published.

B for tournament fees: Eventeny vendor page, https://www.eventeny.com/events/vendor/?id=39899, 2025; East Point 2026 vendor form, https://eastpointga.gov/wp-content/uploads/2026/05/2026-World-Soccer-Games-Vendor-Form2-Modified.pdf, 2026; Sand Soccer 2025 vendor information, https://sandsoccer.com/wp-content/uploads/2025/02/2025-Vendor-Information.pdf, 2025.

### 3.2 Open-market email and newsletter sponsorship CPMs

| Source | Figure | Label |
|---|---|---|
| Sendercircle parenting rates | "Parenting newsletters typically earn $12 CPM on average" | B: https://sendercircle.com/guides/parenting-newsletter-advertising-rates, 2026 |
| Dupple newsletter advertising cost | Lifestyle, food, parenting $15 to $35 CPM; dedicated or primary placement 1.5x to 2x standard | B: https://dupple.com/learn/newsletter-advertising-cost-2026, 2026 |
| Newsletrix pricing guide | Consumer lifestyle / parenting $20 to $45 CPM | B: https://cf-newsletrix.pages.dev/blog/newsletter-sponsorship-pricing-guide, 2026 |
| beehiiv benchmarks | Average open rate 41.24% in 2025 (37.98% in 2024) | B: https://inboxempire.beehiiv.com/p/newsletter-benchmarks, 2026 |

Per subscriber per send (A): $12 CPM = $0.012; $20 to $45 CPM = $0.020 to $0.045; dedicated send at 1.5x to 2x = $0.018 to $0.090. Club placements at $0.43 to $1.43 per family are therefore 5x to 100x the open-market price per address, but they come with endorsement, signage and a full-cycle relationship rather than one anonymous send.

## 4. Conversion evidence for club-endorsed offers

| Evidence | Finding | Label |
|---|---|---|
| Cone Cause Evolution surveys | 2008: about 80% would switch to a cause-linked brand at equal price and quality, but only 38% actually bought a cause-linked product in the prior year (20% in 1993). 2010: 80% likely to switch. 2013: 170% increase in cause purchasing since 1993. | B: Chief Marketer, https://www.chiefmarketer.com/cause-related-marketing-brings-in-sales-study/, 2008; Faunalytics summary, https://faunalytics.org/even-as-cause-marketing-grows-83-of-consumers-still-want-to-see-more/, 2013 |
| Cone / Duke experiment | Lab mock store (n=182): +74% shampoo purchases, +28% toothpaste; online replication (n>1,000): +19% toothpaste; two other categories not significant. | B: MediaPost, https://www.mediapost.com/publications/article/92497/cause-related-marketing-influences-sales.html, 2008 |
| 3STEP Sports (youth club operator) | "68% of youth sports families are more likely to purchase from a youth sports sponsor vs a pro sports sponsor"; "81%... more likely to pay attention to advertising connected to youth sports." No methodology cited; vendor claim. | B: https://threestep.com/partner/, 2026 |
| School portrait buy rates | Photo Marketing Association: 64% of K to 11 students bought school portraits (2003). Gitnux roundup: 45% bought individual portraits (unverified source). Capturely: about 30% participation at a $25 average order is vendor break-even; 67% of parents "had no idea their photographs are actually a fundraiser" (PhotoDay). | B: Christian Science Monitor, https://www.csmonitor.com/2003/0930/p18s01-legn.html, 2003; Gitnux, https://gitnux.org/school-photography-industry-statistics/, 2026; Capturely, https://capturely.com/?p=4186, 2026; PhotoDay, https://photoday.com/blog/what-does-mom-really-want, 2024 |
| Youth sports photo-day buy rates | No published rate found for team picture day. The owner's 50% to 66% figure is unverified; the school figures (45% to 64%) are the nearest published comparables. | Gap |
| Fundraising participation | Snap! Raise defines participation as the share of roster receiving at least one donation and charges extra when the goal is missed; the goal itself is not public. Oklahoma self-report: almost $1,000 per participant. | B: Givebutter, https://givebutter.com/blog/is-snap-raise-worth-it, 2025; Snap! Raise Oklahoma, 2019 (section 1.5) |
| Referral offers generally | Median ecommerce referral conversion 3% to 5%; moving to a 1:1 reward structure doubled conversion (5% to 11.8%) in Extole's retailer case. | B: ReferralCandy 2025; Extole 2025 (section 2.2) |

What this supports (A): stated intent for "supports your club" runs 68% to 80%, realised behaviour runs 19% to 38% lift in controlled tests and 45% to 64% absolute buy rates when the purchase is a mandated-event product (portraits). A software sign-up with no event hook should be modelled at the referral-programme end: low single-digit conversion of those reached, with a 1:1 two-sided reward roughly doubling it.

## 5. Kickback schedules for ReelBallers (all A unless marked)

Common frame: a 14-family team; take-up = share of the 14 families who sign up (10% = 1.4, 25% = 3.5, 50% = 7.0 sign-ups); payer rate 1.06% today or 5% in the test hypothesis; $18.99 per payer; GPU $0.03 per play. Break-even cost per sign-up: $0.12 today, $1.54 optimistic (O). "Cost per sign-up" counts only incremental kickback cost; the existing 48 free credits ($1.44 upper bound per sign-up) are already in the owner's break-even.

### 5a. Per-sign-up bounty to the coach (cash or gift card)

Precedent scaling. Trace pays the referrer 33% of the referred team's first-year order ($100 of $300) and gives the friend the same (B, section 2.3; A for the ratio). Applied to ReelBallers' $18.99 per payer: 0.33 x 18.99 = $6.27 per paying referral. Converted to a per-sign-up expectation at today's payer rate: 6.27 x 0.0106 = $0.066 per sign-up; at 5%: 6.27 x 0.05 = $0.31.

| Bounty design | Cost per sign-up | Cost per 14-family team at 10% / 25% / 50% take-up | Versus $0.12 | Versus $1.54 | What the coach actually receives per team at 10% / 25% / 50% |
|---|---|---|---|---|---|
| Trace-scaled, paid per payer ($6.27) at 1% payers | $0.066 | $0.09 / $0.23 / $0.46 | 0.55x (affordable) | 0.04x | $0.09 / $0.23 / $0.46 expected (coach sees nothing most teams) |
| Trace-scaled, per payer, at 5% payers | $0.31 | $0.44 / $1.10 / $2.19 | 2.6x | 0.20x | $0.44 / $1.10 / $2.19 expected |
| $1 gift card per sign-up | $1.00 | $1.40 / $3.50 / $7.00 | 8.3x | 0.65x | $1.40 / $3.50 / $7.00 |
| $2 per sign-up | $2.00 | $2.80 / $7.00 / $14.00 | 16.7x | 1.30x | $2.80 / $7.00 / $14.00 |
| $5 per sign-up | $5.00 | $7.00 / $17.50 / $35.00 | 41.7x | 3.25x | $7.00 / $17.50 / $35.00 |
| $25 gift card per team at 5+ sign-ups (Trace-style threshold) | $0 below threshold; $25 / 7 = $3.57 at 50% | $0 / $0 / $25.00 | n/a / n/a / 29.8x | n/a / n/a / 2.3x | $0 / $0 / $25 |
| $100 per team at 7+ sign-ups (Trace face value) | $100 / 7 = $14.29 at 50% | $0 / $0 / $100 | 119x | 9.3x | $0 / $0 / $100 |

Reading: the only bounty that clears today's $0.12 break-even is one no coach would notice (under 50 cents per team). Against the $1.54 optimistic break-even, $1 per sign-up fits and $2 is marginal; a $25 team-threshold card fits only if more than 16 families sign up (25 / 1.54 = 16.2), which exceeds the team. Coach-pay context (section 2.1): $1 to $7 per team is below one UK session and under 1% of a US cycle stipend, so structure (a) at affordable levels is symbolic. Gift-card fees are excluded (typically zero for digital cards; Trace and Extole precedents all use digital cards).

### 5b. Club revenue share on attributed purchases plus a flat placement fee

Club earnings per 100 families reached = 100 x take-up x payer rate x $18.99 x share.

| Take-up | Payer rate | Payers per 100 families | Revenue per 100 families | Club at 10% | Club at 15% | Club at 20% |
|---|---|---|---|---|---|---|
| 10% | 1.06% | 0.106 | $2.01 | $0.20 | $0.30 | $0.40 |
| 25% | 1.06% | 0.265 | $5.03 | $0.50 | $0.75 | $1.01 |
| 50% | 1.06% | 0.53 | $10.06 | $1.01 | $1.51 | $2.01 |
| 10% | 5% | 0.5 | $9.50 | $0.95 | $1.42 | $1.90 |
| 25% | 5% | 1.25 | $23.74 | $2.37 | $3.56 | $4.75 |
| 50% | 5% | 2.5 | $47.48 | $4.75 | $7.12 | $9.50 |

Why pure rev share is worthless to the club today: the market's lowest placement tier is $250 to $300 (section 3.1). To earn $300 from a 15% share at $18.99 per payer the club needs 300 / 0.15 / 18.99 = 105.3 payers, which at a 1.06% payer rate is 105.3 / 0.0106 = 9,934 sign-ups, about seven times PYSL's entire 1,400-family membership even at 100% take-up. At 5% payers it is 2,106 sign-ups, still 1.5 PYSL memberships. A 1,400-family club at 50% take-up and 1% payers earns 14 x $1.51 = $21.14 for a cycle of endorsement. Scholastic pays a school 25% cash on $4,000+ of sales ($1,000+); photo day pays 10% on a few thousand dollars; those are the numbers a club treasurer has in mind.

Cost per sign-up of structure (b) = rev share per sign-up + placement fee / sign-ups generated.

| Component | 1% payers | 5% payers |
|---|---|---|
| 15% rev share per sign-up | 0.0106 x 18.99 x 0.15 = $0.030 | 0.05 x 18.99 x 0.15 = $0.142 |
| $300 social-post tier, 100 families, 10% / 25% / 50% take-up | 300 / 10 = $30.00; 300 / 25 = $12.00; 300 / 50 = $6.00 | same |
| $600 email tier at a 1,400-family club, 10% / 25% / 50% take-up | 600 / 140 = $4.29; 600 / 350 = $1.71; 600 / 700 = $0.86 | same |
| $5,000 dedicated blast at a 3,500-member club, 10% / 25% / 50% | 5,000 / 350 = $14.29; 5,000 / 875 = $5.71; 5,000 / 1,750 = $2.86 | same |

Against break-even: no placement fee clears $0.12 at any take-up. The $600 email tier at a 1,400-family club clears $1.54 only at 25% take-up or better (1.71 is close; 0.86 at 50%). Take-up of 25% to 50% from an email logo is far above the 3% to 5% referral-conversion median and the 10% to 25% share click-through band (B, ReferralCandy), so the realistic expectation is 1% to 5% take-up, giving $8.57 to $42.86 per sign-up at the $600 tier (600 / 70 and 600 / 14). Structure (b) is a brand buy, not an acquisition channel, at today's conversion.

### 5c. Credits-in-kind (free plays to parents and to the coach or club pool)

Cost basis $0.03 per play, incurred only when played; face value to the recipient is pack price per play, 29.99 / 71 = $0.42 per play (A), a 14:1 face-to-cost ratio. Scholastic's 2:1 product-to-cash ratio shows organisations accept in-kind at a premium; ReelBallers can offer in-kind at a far higher premium than any physical-goods vendor.

| In-kind design | Cost per sign-up (100% redemption) | Cost per team at 10% / 25% / 50% | Face value to recipient | Versus $0.12 | Versus $1.54 |
|---|---|---|---|---|---|
| +24 plays to each referred family | 24 x 0.03 = $0.72 | $1.01 / $2.52 / $5.04 | $10.08 per family | 6.0x | 0.47x |
| +24 plays to the coach pool per sign-up | $0.72 | $1.01 / $2.52 / $5.04 | $10.08 per sign-up; $14.11 / $35.28 / $70.56 per team | 6.0x | 0.47x |
| Free Season pack (71 plays) to the coach at 3+ sign-ups | $2.00 / sign-ups: n/a / 0.57 / 0.29 | $0 / $2.00 / $2.00 | $29.99 | n/a / 4.8x / 2.4x | n/a / 0.37x / 0.19x |
| Club pool: 1 free Season pack per 10 sign-ups | 2.00 / 10 = $0.20 | $0.28 / $0.70 / $1.40 | $29.99 per 10 sign-ups ($3.00 face per sign-up) | 1.7x | 0.13x |
| Family bonus +24 plays plus coach Season pack at 3+ | 10%: 0.72; 25%: (2.52 + 2.00) / 3.5 = $1.29; 50%: (5.04 + 2.00) / 7 = $1.01 | $1.01 / $4.52 / $7.04 | family $10.08 each; coach $29.99 | 6.0x / 10.8x / 8.4x | 0.47x / 0.84x / 0.66x |

Redemption is the lever: if half the bonus plays go unused, every in-kind cost above halves, and nothing is spent on a family that never comes back. Note the existing 48 free credits already put $1.44 of potential GPU cost into each sign-up; a +24 bonus is a 50% top-up of that.

### 5d. Which structure the market accepts, and which ReelBallers can afford

What clubs and coaches are used to (B, sections 1 to 3): cash or product in the hundreds per club per cycle (Capelli $1,000 to $3,000 credit; Scholastic $1,000+ at a $4,000 fair; a $250 to $600 sponsor tier), 10% to 25% trailing cash on spend that runs tens to hundreds of dollars per family (uniforms, photos, book fairs), and $100 to $200 per referral for an individual (Trace, Outschool). A coach will register a $25 to $100 card (one to three UK sessions; 1% to 50% of a US cycle stipend). A club will not register anything under its $250 floor.

What ReelBallers can afford (A, sections 5a to 5c): at today's $0.12 break-even, nothing a human would notice; at $1.54, about $1 per sign-up in cash or about 50 plays per sign-up in-kind at full redemption. The gap between what the market expects ($250+ per club, $25+ per coach) and what the economics allow ($0.12 to $1.54 per sign-up) is 100x to 2,000x at the club level and 15x to 200x at the coach level. No kickback schedule closes that gap at a 1% payer rate; only a higher payer rate among club-referred sign-ups does, which is the one thing a test can measure.

Recommended test schedule (A), spend-capped from a $300 to $1,000 pool:

1. Coach side (structure c with a small a): every family that signs up with the coach's code gets +24 plays (face $10.08, cost at most $0.72); the coach gets a free Season pack (face $29.99, cost at most $2.00) at 3 sign-ups and a $25 digital gift card at 7 sign-ups (half the team, mirroring Trace's team threshold at one quarter of Trace's amount). Cost per team at 10% / 25% / 50% take-up: $1.01 / $4.52 / $32.04; cost per sign-up $0.72 / $1.29 / $4.58. Twenty teams cost $20 to $641 depending on take-up, inside the pool; expected case at 25% take-up is $90.
2. Club side (structure b, one or two clubs only): pay the market's lowest family-message tier once, $300 to $600, as a placement fee with a tracked code, and promise a 15% revenue share on attributed purchases so the club has a line item to report, while stating in writing that the share is expected to be small until conversion is proven. One $600 email tier at a 1,400-family club plus 20 team kits fits a $1,000 pool only in the low and expected take-up cases (600 + 90 = $690); in the high case the team spend alone is $641, so cap the club buy at $300 if more than ten teams hit the 7-sign-up threshold.
3. Kill criterion: if the payer rate among code-attributed sign-ups is not above 5% after the first 200 attributed sign-ups (at 5% the optimistic $1.54 break-even holds; at 1% nothing holds), stop paying coaches and clubs and treat the spend as information purchased: it will have cost under $1,000 to learn that endorsement does not move the payer rate.

Why this and not a straight cash bounty: cash per sign-up at any level a coach notices ($5+) is 3x to 40x over the optimistic break-even (5a), while in-kind at 14:1 face-to-cost lets the coach receive a $30 product and families a $10 product for under $3 of real cost per team at expected take-up (5c), which is the Scholastic lesson (product at 2:1) taken to the margin structure of a software product.

## Sources

1. SOCCER.COM Club Partner Playbook (Cutters SC copy), https://cutterssoccer.teamsnapsites.com/wp-content/uploads/sites/1210/2025/06/sDc-PLAYBOOK.pdf, 2025
2. FlexOffers, SOCCER.COM affiliate program, https://www.flexoffers.com/affiliate-programs/soccer-com-affiliate-program, 2026
3. Rakuten, SOCCER.COM cash back and Goal Club notes, https://www.rakuten.com/shop/soccer, 2026
4. Authentic Soccer, My Team policies, https://www.authenticsoccer.com/my-team-policies.aspx, undated (live 2026)
5. Rush Soccer, Rush Benefits, https://rushsoccer.com/rush-benefits/, undated (live 2026)
6. Capelli Sport, Cal South Referee Program, https://capellisport.com/blogs/news/cal-south-referee, 2024
7. Current, Grand Park reaches apparel agreement with Capelli Sport, https://youarecurrent.com/2025/11/26/grand-park-reaches-apparel-agreement-with-capelli-sport/, 2025
8. 11teamsports, Vereinskasse (HOC), https://www.11teamsports.com/de-de/l/vereinskasse-hoc, undated (live 2026)
9. Teamo, Rewards and fundraising, https://teamo.chat/tweb/21/rewards-fundraising.jsp, 2023
10. Youth Sports Business Report, DICK'S launches $99 ScoreCard+, https://youthsportsbusinessreport.com/dicks-launches-99-scorecard-extends-loyalty-rewards-to-services-for-youth-sports-families/, 2026
11. Synchrony, DICK'S credit card 10% back, https://investors.synchrony.com/news-events/financial-news/detail/572/dicks-sporting-goods-and-synchrony-level-up-the-dicks-credit-card-offering-members-10-back-in-scorecard-rewards-on-qualifying-purchases, 2026
12. BSN SPORTS Sideline Store, https://sideline.bsnsports.com/, 2026
13. Siuslaw School District, BSN team shop 11%, https://www.siuslaw.k12.or.us/article/1146406, 2024
14. SquadLocker, Fundraising made easy via your SquadLocker store, https://www.squadlocker.com/squad-blog/fundraising-made-easy-via-your-squadlocker-store, 2023
15. Scholastic Book Fairs, Earnings, https://bookfairs.scholastic.com/content/fairs/why-scholastic/earnings.html, 2026
16. Scholastic, Scholastic Dollars hub, https://shop.scholastic.com/content/fairs/hub/scholastic-dollars.html, 2026
17. Scholastic Canada, All About Scholastic Dollars, https://www2.scholastic.ca/bookfairs/?p=124, undated (live 2026)
18. TSS Photography, Miracle League partnership, https://tssphotography.com/?p=5021, 2024
19. Lillington Chamber, TSS Photography of Clayton, https://members.lillingtonchamber.org/list/member/tss-photography-of-clayton-1531, 2025
20. Jennifer Woodard Photography, Photography that gives back, https://jenniferwoodardphotography.mypixieset.com/sports-copy-1/, 2025
21. Secoges Photo, Photography proposal, https://issuu.com/secogesphoto/docs/booklet, 2024
22. Soulgrown Photography, Sports division banner fundraiser, https://soulgrownphotography.mypixieset.com/sports/, 2025
23. Capturely, School photography pricing, https://capturely.com/?p=4186, 2026
24. PhotoDay, Bidding on youth sports jobs, https://photoday.com/blog/bidding-on-youth-sports-jobs-things-volume-photographers-should-know, 2024
25. PhotoDay, What does Mom really want, https://photoday.com/blog/what-does-mom-really-want, 2024
26. Snap! Raise help desk, What does it cost to start a fundraiser, https://helpdesk.snapraise.com/what-does-it-cost-to-start-a-fundraiser, 2026
27. Zeffy, Snap Raise 20% fee comparison, https://www.zeffy.com/compare/zeffy-vs-snap-raise, 2026
28. Givebutter, Is Snap! Raise worth it, https://givebutter.com/blog/is-snap-raise-worth-it, 2025
29. Snap! Raise, Oklahoma impact report, https://fundraise.snap-raise.com/oklahoma-fundraising, 2019
30. Snap! Raise, National fundraising report, https://fundraise.snap-raise.com/national-fundraising, 2020
31. Vertical Raise, Vertical Raise fee, https://www.verticalraise.com/blog/vertical-raise-fee, 2025
32. East Lansing Portrait, Vertical Raise needs to go, https://eastlansingportrait.com/4170/opinion/vertical-raise-needs-to-go/, 2024
33. RallyUp pricing, https://rallyup.com/pricing/, 2026
34. RallyUp, Advanced pricing, https://learn.rallyup.com/understand-advanced-pricing, 2026
35. FlipGive help, Why didn't I earn the full amount, https://help.flipgive.com/en/articles/3528318-why-didn-t-i-earn-the-full-amount-i-should-have-for-my-purchase, 2025
36. FlipGive, Phoenix teams, https://flipgive.com/locations/arizona/phoenix, 2026
37. Florida Youth Soccer Association, Trace partnership, https://www.fysa.com/?p=13334, 2026
38. Trace help center, How to subscribe to PlayerFocus, https://trace.helpcenter.io/content/how-to-subscribe-to-trace-highlights-playerfocus, 2026
39. Trace support, Trace referral program, https://support.traceup.com/content/trace-referral-program, 2026
40. US Adult Soccer, Trace offer, https://usadultsoccer.com/?p=9653, 2025
41. Veo, FYSA partnership, https://www.veo.co/partnership/florida-youth-soccer-association, undated
42. Veo, Ambassador referral, https://www.veo.com/ambassador-referral, 2026
43. Veo, Partner portal, https://share.veo.co/partner-portal, 2026
44. Veo, Kick-off 2026 offer, https://www.veo.com/kick-off-2026, 2026
45. Fluxnote, Veo pricing guide 2026 (unofficial), https://fluxnote.io/guides/veo-pricing-guide-2026, 2026
46. KHSAA, Questions and answers regarding NFHS Network Pixellot program, https://khsaa.org/?p=33383, 2020
47. MHSAA, NFHS Network revenue share, https://www.mhsaa.com/live/nfhs-network, 2026
48. Hudl, Club Preferred Lineup, https://www.hudl.com/solutions/club/preferred-lineup, 2026
49. TeamSnap, Spring sponsorships blog, https://www.teamsnap.com/blog/clubs-leagues/teamsnap-celebrates-spring-sponsorships-1-2-million-participating-organizations, 2024
50. Career.com, Tonka United youth soccer coach posting, https://www.career.com/job/tonka-united-soccer-association/youth-soccer-coach/j202604251736200753026, 2026
51. Sports Backers, Stipend plan, https://sportsbackers.org/wp-content/uploads/2024/07/Stipend-Plan.pdf, 2024
52. Your Soccer Home, How much a soccer coach makes, https://yoursoccerhome.com/how-much-a-soccer-coach-makes-with-specific-examples/, 2024
53. Soccer Shots careers, $19 per session, https://soccershotscareers.careerplug.com/jobs/3321001, 2026
54. Aspen Institute Project Play, State of Play 2024 coaching trends, https://projectplay.org/state-of-play-2024-coaching-trends, 2024
55. Jobs in Football, Sessional football coach, https://jobsinfootball.com/job/131319/sessional-football-coach/, 2025
56. sports coach UK, Sports Coaching in the UK III, https://issuu.com/scukres/docs/sports_coaching_in_the_uk_iii_final, 2008
57. Extole, Create a compelling offer structure, https://success.extole.com/en/articles/10772148-create-a-compelling-offer-structure, 2025
58. ReferralCandy, What's a good referral rate, https://www.referralcandy.com/blog/referral-rates, 2026
59. ReferralCandy, Referral program benchmarks 2025, https://www.referralcandy.com/blog/referral-program-benchmarks-whats-a-good-conversion-rate-in-2025, 2025
60. ReferralCandy, High-ticket brands, https://www.referralcandy.com/high-ticket-brands/, 2026
61. Friendbuy, Referral incentive structure, https://www.friendbuy.com/blog/referral-incentive-structure, 2025
62. Konabayev, Referral marketing statistics 2026, https://konabayev.com/blog/referral-marketing-statistics-2026/, 2026
63. Impact, 7 proven strategies for referral growth, https://impact.com/referral/7-proven-strategies-for-growth/, 2025
64. Referral Rock, Referral reward types, https://product.referralrock.com/p/referral-reward-types, 2025
65. Xoxoday, How rewards improve referral programs, https://www.xoxoday.com/blogs/plum/how-rewards-improve-referral-programs-a-data-backed-guide, 2025
66. GrowSurf, Gift card reward, https://growsurf.com/glossary/gift-card-reward/, 2025
67. BLS CE symposium, Monetary incentives and response rates (Church 1993; Singer et al. 1999), https://www.bls.gov/cex/workshop/2016/symposium/monetary-incentives-and-response-rates.pdf, 2016
68. PMC, Systematic review of incentives in RCTs, https://pmc.ncbi.nlm.nih.gov/articles/PMC9844858, 2023
69. Outschool, New educator referral program terms, https://outschool.com/pages/outschool-new-educator-referral-program-terms, 2025
70. Outschool, Parent referral program, https://support.outschool.com/en/articles/2087332-parent-referral-program, 2026
71. TutorsPlus, Refer a friend, https://tutorsplus.com/refer-a-friend/, 2026
72. Up Learn, How do referrals work, https://help.uplearn.co.uk/en/articles/7668827-how-do-referrals-work, 2025
73. Tutorful, How do I refer a friend, https://support.tutorful.co.uk/hc/en-us/articles/360010220759-For-Students-Parents-How-do-I-refer-a-friend, 2025
74. PYSL / Blast SC, Become a sponsor, https://pyslblast.org/sponsorships/, 2026
75. Southside Youth Soccer, 2024/2025 sponsorship booklet, https://www.southsideyouthsoccer.com/wp-content/uploads/2024/05/2024_2025-SSYS-Sponsorship-Booklet.pdf, 2024
76. City of Rockville, Youth sports leagues sponsorship opportunities, https://www.rockvillemd.gov/wp-content/uploads/2025/09/Youth-Sports-Leagues-Sponsorship-Opportunities.pdf, 2025
77. Liberty United Soccer Club, Sponsorship opportunities 2025-2026, https://www.libertyhillsoccer.org/sponsors/, 2026
78. Oceanside FC, Sponsorship pricing 2025, https://oceansidefc.com/wp-content/uploads/ofc_sponsorship_form_2025_rev080524-1.pdf, 2025
79. Haverhill Youth Soccer, Sponsorship opportunities, https://www.haverhillyouthsoccer.org/sponsorship-opportunities, 2022
80. Region Lacrosse, Sponsorship, https://regionlacrosse.org/sponsorship/, 2025
81. KTTN, Green Hills Recreation Association 2026 sponsorship tiers, https://www.kttn.com/recreation-association-announces-2026-sponsorship-tiers-for-youth-sports/, 2026
82. Lincoln Sudbury Youth Baseball, Sponsor letter 2026, https://www.lsyb.org/Default.aspx?tabid=1718904, 2026
83. Eventeny, Vendor booth listing, https://www.eventeny.com/events/vendor/?id=39899, 2025
84. City of East Point, 2026 World Soccer Games vendor form, https://eastpointga.gov/wp-content/uploads/2026/05/2026-World-Soccer-Games-Vendor-Form2-Modified.pdf, 2026
85. Sand Soccer, 2025 vendor information, https://sandsoccer.com/wp-content/uploads/2025/02/2025-Vendor-Information.pdf, 2025
86. Sendercircle, Parenting newsletter advertising rates, https://sendercircle.com/guides/parenting-newsletter-advertising-rates, 2026
87. Dupple, Newsletter advertising cost 2026, https://dupple.com/learn/newsletter-advertising-cost-2026, 2026
88. Newsletrix, Newsletter sponsorship pricing guide, https://cf-newsletrix.pages.dev/blog/newsletter-sponsorship-pricing-guide, 2026
89. Inbox Empire (beehiiv), Newsletter benchmarks, https://inboxempire.beehiiv.com/p/newsletter-benchmarks, 2026
90. Chief Marketer, Cause-related marketing brings in sales, https://www.chiefmarketer.com/cause-related-marketing-brings-in-sales-study/, 2008
91. MediaPost, Cause related marketing influences sales, https://www.mediapost.com/publications/article/92497/cause-related-marketing-influences-sales.html, 2008
92. Faunalytics, Even as cause marketing grows, https://faunalytics.org/even-as-cause-marketing-grows-83-of-consumers-still-want-to-see-more/, 2013
93. 3STEP Sports, Partner page, https://threestep.com/partner/, 2026
94. Christian Science Monitor, School photos endure (PMA 64%), https://www.csmonitor.com/2003/0930/p18s01-legn.html, 2003
95. Gitnux, School photography industry statistics, https://gitnux.org/school-photography-industry-statistics/, 2026
96. Core77, Trace camera lease notes, https://www.core77.com/posts/136929, undated

Gaps recorded: SOCCER.COM pays no published percentage to clubs; Dick's Team Sports HQ and Academy have no league rebate; TSS, Legends and Spoiled Rotten publish no league percentage; Nike, adidas and Puma publish no per-athlete club allowance; Veo's ambassador payout amount is unpublished; no coach acceptance-rate study exists; no youth sports picture-day buy rate is published; Hudl, Krossover and Snap! Raise have no coach referral programme.
