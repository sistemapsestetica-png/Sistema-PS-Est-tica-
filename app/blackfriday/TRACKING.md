# Black Friday tracking

Campaign parameters: utm_source, utm_medium, utm_campaign, utm_content,
utm_term, utm_id, campaign_id, adset_id, ad_id, placement and fbclid.
Stored first-party under ps-blackfriday-attribution-v1 for 30 days.
A new tagged visit replaces the prior campaign; an untagged visit retains it.
Storage failure falls back to memory without affecting navigation.

Events: existing global PageView, page-specific ViewContent, Contact for a group
link click (hero/video/convite), and blackfriday_video_play for first playback.
No Lead, Purchase or group membership event is emitted by this pressel.
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

Current activation blocker: Supabase secrets lookup returned HTTP 403 and
Vercel has no META_CONVERSIONS_API_TOKEN configured. Until configured the
endpoint explicitly returns 503; browser tracking continues normally.
No production test conversions should be generated to validate delivery.
Validate a real click in Meta Test Events once a test code is available, or
inspect the next genuine Contact's Browser/Server deduplication in Meta.
