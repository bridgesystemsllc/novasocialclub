---
name: POSH event source
description: The reliable approach for displaying the NOVA Social Club's live POSH events.
---

Use a POSH-specific Apify source with an upcoming-events filter and cache the normalized event data in the app database. Do not rely on a browser scraper from a standard cloud proxy.

**Why:** POSH returned a 403 to Apify's generic browser scraper. One community POSH actor also returned old events that did not match the public organizer page, while the selected source returned the current NOVA event list, dates, venues, and RSVP links.

**How to apply:** Preserve the server-side cache and fallback cards. Validate any replacement source against the live public POSH group before switching the production event feed.