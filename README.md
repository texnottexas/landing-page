# 2864 Landing Page

A minimal landing page for Server 2864 (Top War) — built with vanilla HTML/CSS/JS and hosted on GitHub Pages.

## Features

- **Radial wheel navigation** with 6 tools + inactive inner icon
- **UD Calendar** — Seal Stone event browser with week-by-week rounds, Today/Round toggle, event and day filters, Add-to-Calendar (.ics) downloads, local timezone display
- **Dice Guide** — visual reference for dice event
- **Free Lv5 Unit** — unit unlock guide with image modal
- **Rockfield / Individual Defense** — strategy guides
- **Mathomhouse** — external resource link
- **Titan Canyon** — temporarily inactive, shown as inner icon
- Dark / Light mode toggle with localStorage persistence
- Responsive layout with list-view fallback on mobile
- Google Translate integration
- No dependencies — single-file HTML with inline CSS and JS

## Calendar Data

`seal-stone-calendar.json` contains all Seal Stone event times in UTC. The calendar UI converts to the user's local timezone automatically.

## Links

- **Signups** — [Google Form](https://forms.gle/2UaSmMxZEfVfhh617)
- **Rosters** — [titan.2864tw.com](https://titan.2864tw.com)

## Deployment

Automatically deployed via GitHub Pages from the `main` branch.

## Related

- [titan-canyon-rosters](https://github.com/texnottexas/titan-canyon-rosters) — Full roster management app
