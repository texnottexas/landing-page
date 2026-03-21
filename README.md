# 2864 Landing Page
## [2864tw.com](https://2864tw.com)
A landing page for Server 2864 (Top War) — built with vanilla HTML/CSS/JS and hosted on GitHub Pages.

## Features

- **Radial wheel navigation** with 7 tools + center hub, list-view fallback on mobile
- **UD Calendar** — Seal Stone event browser with rounds, filters, Add-to-Calendar (.ics), timezone override
- **Per-event push reminders** — 15/30/60 minute alerts for calendar events (beta)
- **Kartz Trial / March Setup** — tabbed guide with Kartz Trial and Individual Defense content
- **Join 2864** — Discord server link
- **Free Lv5 Unit** — unit unlock guide with image modal
- **Rockfield** — strategy guide with text/image toggle
- **Mathomhouse** — external resource link
- **Gold Blocks** — in-game bullion pay link
- **Player Roster** — 334 players with avatars, flags, and country flag overrides
- **Player Identity** — personalize notifications by selecting your name
- **Guest Identity** — visitors can use calendar reminders without being in the roster
- **Push Notifications** — event reminders, admin broadcasts, per-player/alliance targeting
- **Preferences Hub** — tabbed modal (Reminders / Identity / Display)
  - Theme toggle (dark/light)
  - Timezone override (15 curated + 400+ IANA zones)
  - Reduced motion toggle
  - Compact calendar toggle
- **Feedback Form** — bug reports to GitHub Issues, feature requests to Azure DevOps
- Dark / Light mode toggle with localStorage persistence
- Google Translate integration
- PWA-enabled with Add to Home Screen banner
- No dependencies — single-file HTML with inline CSS and JS

## Architecture

| Component | Location |
|-----------|----------|
| Landing page | `index.html` (single file, inline CSS/JS) |
| Push admin | `push-admin.html` |
| Service worker | `sw.js` |
| Calendar data | `seal-stone-calendar.json` |
| Player data | `player-data.json` (334 players, no UIDs) |
| Push worker | Cloudflare Worker ([source](../push-worker/)) |

## Deployment

Automatically deployed via GitHub Pages on push to `main`. Commits must be GPG-signed.

Push worker deployed separately via `wrangler deploy` from the `push-worker/` directory.

## Related

- [titan-canyon-rosters](https://github.com/texnottexas/titan-canyon-rosters) — Roster and battle plan management
- [Azure DevOps Board](https://dev.azure.com/texnottexas/TW-2864-LandingSite) — Feature tracking and roadmap
