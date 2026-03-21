# Design: Guest Identity + Display Preferences (F7 + F8)

**ADO:** #42 (F7), #43 (F8)
**Date:** 2026-03-21
**Status:** Approved (rev 2 — addressed spec review findings)

---

## F7: Guest/Visitor Identity for Calendar Notifications

### Problem

Non-2864 members (guests, visitors) cannot use per-event calendar reminders because the system ties push subscriptions to the player roster. There is no identity path for someone who isn't in `player-data.json`.

### Design

**Two entry paths to guest identity:**

1. **Explicit:** "Just visiting? Tap here" card at the top of the identity modal list, above the search bar. Styled distinctly (muted border, visitor icon). Supports `tabindex="0"` and Enter key (matches existing identity items). Has `role="button"` and `aria-label="Select guest identity"`.
2. **Implicit:** When an anonymous user (skipped identity) subscribes to push, they are auto-tagged as a guest. The subscribe gate (`getStoredIdentity()` returning null for anonymous) is relaxed: anonymous users CAN subscribe, and their subscription is sent with `player: { name: "Dingus", guest: true }`.

Both paths result in the same stored identity:
```json
{ "name": "Dingus", "guest": true, "alliance": null }
```

**Header greeting:** "Hi, Dingus" with the standard dismiss button. Dismissing resets identity to `"anonymous"` in localStorage (same as players). The worker subscription retains `guest: true` until the user picks a real identity or unsubscribes.

**Guest-to-player transition:** When a guest selects a real identity from the identity modal, `saveIdentity()` must also call `saveSubToWorker()` to re-sync the subscription with the new player data (replacing `guest: true` with the real name/alliance). This is a new behavior — currently `saveSubToWorker()` is only called during `subscribe()`.

### Client-side changes (`index.html`)

**`getStoredIdentity()` update:** Currently returns `null` for both unvisited and anonymous. Change to:
- `null` → never visited (no localStorage key)
- `"anonymous"` → skipped identity
- `{ name: "Dingus", guest: true, ... }` → guest
- `{ name: "Tex", alliance: "DOG*", ... }` → real player

**`subscribe()` gate:** Remove the hard block on anonymous users. Instead, when an anonymous user subscribes, auto-save guest identity to localStorage and send `{ name: "Dingus", guest: true }` to the worker.

**`saveSubToWorker()` update:** Forward the full identity object including `guest: true` when present:
```js
player: identity && identity.guest
  ? { name: identity.name, guest: true }
  : identity ? { name: identity.name, alliance: identity.alliance } : null
```

**Identity selection handler:** After `saveIdentity(identity)`, check if push is subscribed and call `saveSubToWorker(pushSub)` to sync the new identity to the worker. This handles the guest-to-player transition.

### Worker Changes (`push-worker/src/index.js`)

**`/subscribe` endpoint:** No structural changes. The `player` object now may include `guest: true`.

**`/notify` endpoint — targeting logic:**
- When `target` is `null` (All mode): filter out subscribers where `player.guest === true`, **unless** the request payload includes `includeGuests: true`.
- Player targeting (`target.players`): guests are never matched (they have no real name in the roster).
- Alliance targeting (`target.alliances`): guests are never matched (alliance is null).
- Cron-based reminders: **no filtering** — guests receive their per-event reminders like everyone else, since reminders are per-subscriber.

**`/subscribers` endpoint:** Include the `guest` field in the response so push-admin can display guests differently.

**Security note:** The `guest` flag is client-controlled. A malicious client could subscribe without `guest: true` to receive all broadcasts. This is accepted risk — broadcast content is not sensitive (game event reminders), and the "attacker" would only be opting in to more notifications. If filtering becomes important in the future, the worker can validate names against a server-side player list.

### push-admin.html Changes

- **"Include guests" checkbox** appears when "All" targeting is selected. Unchecked by default. Sends `includeGuests: true` in the `/notify` payload when checked.
- **Subscriber management modal:** Guest subscribers shown with "(Guest)" label.
- **"By Player" dropdown:** Guests excluded from the player list.

### localStorage

- Key: `playerIdentity`
- Guest value: `{ "name": "Dingus", "guest": true, "alliance": null }`
- Anonymous value (unchanged): `"anonymous"`

---

## F8: Display Preferences Tab

### Problem

The Display tab in the Preferences hub is an empty placeholder showing "More options coming soon." Users have no way to customize their visual experience.

### Accessibility note

The Preferences modal is currently only reachable via the bell icon (which toggles push subscribe/preferences). Since Display preferences are device-specific and don't require push, a gear icon button should be added to the header (next to the bell) that opens the Preferences modal directly to the Display tab. This ensures Display settings are accessible without push subscription.

### Design

Four settings, all stored in localStorage (device-specific, no worker involvement):

| # | Setting | Control | localStorage Key | Default |
|---|---------|---------|-----------------|---------|
| 1 | Theme | Toggle switch (dark/light) | `theme` (existing) | dark |
| 2 | Timezone | Curated dropdown + expandable | `tzOverride` | auto-detect |
| 3 | Reduced motion | Toggle switch | `reducedMotion` | off (inherits OS `prefers-reduced-motion`) |
| 4 | Compact calendar | Toggle switch | `compactCal` | off |

### Theme Toggle

- Same `setTheme()` function used by the header button.
- Bidirectional sync: `setTheme()` is augmented to also update the Display tab toggle state if the tab is currently visible. When the Display tab opens, it reads the current theme from `document.documentElement.getAttribute('data-theme')`.
- Display shows current state label: "Dark" or "Light".

### Timezone Override

**Curated list (~15 entries):**
Auto-detect (browser default), US Eastern, US Central, US Mountain, US Pacific, Hawaii, UK (London), Central Europe (Berlin), Eastern Europe (Bucharest), Turkey (Istanbul), India (Kolkata), Singapore, Japan (Tokyo), Australia Eastern (Sydney), New Zealand (Auckland).

**"More..." expand behavior:** Clicking "More..." replaces the curated `<select>` with a text `<input>` that filters all ~400 IANA timezones as the user types (using `Intl.supportedValuesOf('timeZone')` where available, with a hardcoded fallback list). A "Back to common" link restores the curated list.

**`getDisplayTimezone()` helper:** Defined early in the first `<script>` block (the existing block starting ~line 2062, before any calendar or modal code). Returns:
```js
function getDisplayTimezone() {
  return localStorage.getItem('tzOverride') || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
```

**Integration points — all date formatting must use the override:**

The current calendar code uses `toLocaleTimeString()`, `toLocaleDateString()`, `getDate()`, `getMonth()` etc. These all default to the browser's local timezone and must be refactored:

1. **`formatLocalTime()`, `formatLocalDate()`, `formatDateRange()`** — pass `{ timeZone: getDisplayTimezone() }` as options to all `toLocaleTimeString()` / `toLocaleDateString()` calls.
2. **`toDateKey()` and `getEventLocalDay()`** — replace `dt.getDate()` / `dt.getMonth()` with `Intl.DateTimeFormat('en', { timeZone: getDisplayTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt)` to correctly project UTC dates into the display timezone. This is critical for events near midnight (e.g., 23:00 UTC appearing under the correct date in Tokyo).
3. **`formatDayLabel()`** — pass timezone to the `Intl.DateTimeFormat` options.
4. **Calendar banner** — "Times shown in {X}" reads from `getDisplayTimezone()`, showing the IANA name or a friendly label from the curated list.
5. **ICS generation (Add to Calendar)** — keep UTC (`DTSTART:...Z` format). UTC timestamps are universally correct. Do NOT add VTIMEZONE blocks or local-time DTSTART values — this is display-only.
6. **Cron/worker reminder matching** — stays UTC. The override is display-only. Reminders fire at the correct absolute time regardless of the user's display timezone preference.

**On change:** When the user selects a new timezone while the calendar modal is open, re-render the event list immediately by calling the existing render function.

### Reduced Motion

- Toggle sets `data-reduced-motion="true"` attribute on `<html>` element.
- Loaded on page init from localStorage before first paint (early in the first script block).
- **Precedence:** On init, check localStorage first. If no stored preference, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and use that as default. The user's explicit toggle always overrides the OS preference.
- Do NOT use the `@media (prefers-reduced-motion)` CSS approach — use the `data-reduced-motion` attribute exclusively so the toggle has full control.
- CSS disables animations:
  ```css
  [data-reduced-motion="true"] .shimmer-text,
  [data-reduced-motion="true"] .wheel-center,
  [data-reduced-motion="true"] .pulse-dot,
  [data-reduced-motion="true"] .fk-boats { animation: none !important; transition: none !important; }
  ```

### Compact Calendar

- Toggle saves `compactCal` to localStorage.
- When calendar modal opens, checks the value and adds `.compact-cal` class to the calendar container.
- Compact mode:
  - Smaller font on event cards
  - Reduced padding
  - Single-line date/time
  - "Remind me" and "Add to Calendar" buttons shrink to icon-only (bell icon, calendar icon) with `aria-label` attributes for accessibility and `title` tooltips

---

## Files Changed

| File | Changes |
|------|---------|
| `index.html` | Guest card in identity modal, subscribe gate relaxation, identity-change re-sync, gear icon for Display access, `getDisplayTimezone()` helper (early), Display tab controls (4 settings), reduced-motion attribute + CSS, compact-cal CSS, timezone refactor of all calendar date functions |
| `push-worker/src/index.js` | Guest filtering in `/notify` All mode, `includeGuests` flag, guest field in `/subscribers` response |
| `push-admin.html` | "Include guests" checkbox, "(Guest)" labels in subscriber list, guest exclusion from player dropdown |

## Accepted Risks

- Guest flag is client-controlled. A malicious client could bypass guest filtering by omitting the flag. Accepted because broadcast content is non-sensitive.
- "Dingus" is a hardcoded name. If a real player ever uses this name, there would be a collision in the subscriber list. Low risk — can be addressed by prefixing with an emoji or symbol if it ever occurs.

## Not In Scope

- Syncing display preferences to the worker (device-specific by design).
- Guest-specific push categories or channels.
- Custom guest names (always "Dingus").
- VTIMEZONE blocks in ICS files (UTC is correct and universal).
