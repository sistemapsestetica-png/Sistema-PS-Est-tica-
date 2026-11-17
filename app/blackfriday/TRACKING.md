# Black Friday tracking

Campaign parameters: utm_source, utm_medium, utm_campaign, utm_content,
utm_term, utm_id, campaign_id, adset_id, ad_id, placement and fbclid.
Stored first-party under ps-blackfriday-attribution-v1 for 30 days.
A new tagged visit replaces the prior campaign; an untagged visit retains it.
Storage failure falls back to memory without affecting navigation.

Events: existing global PageView, page-specific ViewContent, and
blackfriday_video_play for first playback. No Contact, Lead, Purchase or group
membership event is emitted by the buttons. Older callers' Contact requests are
skipped (202, group_membership_not_confirmed) by both server layers.
The current invitation does not provide a verified participant-join signal.
Do not optimize or label Contact as a confirmed join. A future membership event
must be emitted only from authenticated, verified membership evidence, with a
deduplicated participant/group ID, never merely from a link click.

Matching fix: wait up to 1.5 seconds for the real SDK _fbp cookie; use _fbc only
from a real cookie or observed fbclid. Never fabricate email/phone/browser IDs.
Both server layers skip (202, no Meta request) events without fbp/fbc + user
agent. Browser Pixel remains independent when server matching is unavailable.
Historical diagnostics/counts are not rewritten by this deployment.
Regression checks: node scripts/check-blackfriday-tracking.cjs (no real Meta
requests). Covers delayed SDK cookies, absent matching data, duplicate IDs,
attribution persistence, both server layers and suppression of Contact clicks.
Campaign parameters accompany the page-specific events and the /grupovip link.
WhatsApp receives the original group invitation URL unchanged: this does not
provide member-level attribution after the visitor leaves the website.

POST /api/blackfriday/events is ready for Conversions API delivery. Configure
META_CONVERSIONS_API_TOKEN in this Vercel project's Production environment and
redeploy to activate. Optional META_GRAPH_API_VERSION defaults to v23.0.
It uses the existing NEXT_PUBLIC_META_PIXEL_ID, never returns the secret,
accepts only the three page-specific events, and shares event_name/event_id
with the browser Pixel for deduplication. It forwards fbp/fbc when available,
IP and user agent. No email/phone is collected on this group-entry page.

With no Vercel token, this endpoint relays validated events to the dedicated
Supabase function meta-blackfriday, which uses the existing Meta secrets there.
No database tables or existing lead/payment functions are changed. Deploy only
this new function with --no-verify-jwt --use-api (public tracking endpoint,
restricted event names and origin; it never accepts Lead or Purchase).
No production test conversions should be generated to validate delivery.
Validate a real click in Meta Test Events once a test code is available, or
inspect the next genuine Contact's Browser/Server deduplication in Meta.
