# Google Translate Integration + Rockfield Text Modal

**Date:** 2026-03-13
**Status:** Approved
**Repo:** texnottexas/landing-page
**File:** index.html

## Overview

Add Google Translate to the landing page so all HTML text is translatable into the browser's native language. Convert the Rockfield infographic from an image-only modal to a styled HTML text modal (with image toggle) so its content is also translatable.

## 1. Google Translate Widget

### Placement
- Globe icon (inline SVG, consistent with existing icon style) + dropdown in the header, right side, near the existing theme toggle button.
- Styled to match the site's dark/light theme using CSS overrides on the Google widget container.

### Behavior
- On page load, detect browser language via `navigator.language`.
- If the detected language is not English (`en`), auto-trigger Google Translate to that language.
- Store the user's preference in `localStorage`. If a user dismisses or reverts translation, remember that choice so it doesn't auto-trigger again on next visit.
- User can manually override via the dropdown at any time.
- Hide Google's default top banner bar with CSS (`body > .skiptranslate { display: none !important; }` and `body { top: 0 !important; }`).

### Graceful degradation
- If the Google Translate script fails to load (ad-blocker, network error), the globe icon still appears but the dropdown shows "Translation unavailable" on click.
- The page remains fully functional without translation.

### Non-translatable elements
- Apply `notranslate` class to game-specific terms that should remain in English:
  - Site branding: "2864", "TW Server 2864"
  - Game terms in Rockfield modal: "Rockfield", "Kuruzo", "Valhallas", "SSR", "Heavy Troopers", "Debilitation", "March Size"
  - Player names, URLs, code-like content

## 2. Rockfield Text Modal

### Current state
- `#rockfield-modal` contains a single `<img>` pointing to `https://i.ibb.co/Fb0bzjVh/Rockfield-Updated.png`.

### New design
Replace with a styled HTML modal containing all 5 guide sections as translatable text. Include a toggle to switch between text and original image.

#### Toggle
- Two buttons at the top with `aria-pressed` attributes for accessibility.
- "Text Guide" (default, active) and "Original Image".
- Text Guide view shows the HTML content below.
- Original Image view shows the existing infographic PNG.
- Default is Text Guide so that auto-translate works out of the box. This is intentional — the text version is the primary view going forward, with the original image available as a reference.

#### Content sections

Each section is a numbered card styled with `--card` background, `--border` border, and `--accent` section numbers.

**Section 1 — Heroes: The Cast**
- ROCKFIELD: The hero of our story!
- KURUZO: Boosts your March Size by 5*
- Requires Kuruzo at 5*, otherwise use any 5* SSR powerhouse of your choice.

**Section 2 — Skills: March Size Matters**
- ROCKFIELD Exclusive Skill
- MARCH SIZE (Rare)
- MARCH SIZE (Normal)

**Section 3 — Units: Air Force ONLY**
- Best optimal performance: VALHALLAS (level 105)
- Not recommended: Heavy Troopers (level 50)
- True damage is reduced if your units are lower level than the enemy.

**Section 4 — Maths: For the Geeks**
- Air Force Pre-Battle Skill:
  - Trigger: Activates once before the first battle round
  - Effect: Deals (X)% of each enemy unit's max HP as true damage
- Damage Reductions:
  - -35% damage per level your units are below enemy's average level
  - -1% damage for every 1% fewer troops than the enemy
- Bonus: Inflicts (X)% Debilitation on all enemy Naval units for 2 turns
- * (X varies by player)

**Section 5 — Field Tests**
- Air Force vs Ground: Effective (works)
- Air Force vs Naval: Effective (works)
- Air Force vs Air Force: Not effective (does not work)

#### Styling
- Modal max-width: 600px, scrollable on overflow.
- Section cards: padding 1rem, margin-bottom 0.75rem, border-radius matching existing modals.
- Title styled with accent color, large font.
- Section numbers use accent-colored circular badges.
- Game-specific names wrapped in `<span class="notranslate">`.

## 3. CSP Updates

**Important:** These are *additions* to the existing CSP directives. All existing values (e.g., `'unsafe-inline'` in `script-src` and `style-src`) must be preserved.

Note: `frame-src` is currently set to `'none'` — this must be *replaced* with the new value (since `'none'` overrides all other sources when present).

Update the `<meta http-equiv="Content-Security-Policy">` tag:

| Directive | Add |
|-----------|-----|
| `script-src` | `https://translate.googleapis.com https://translate.google.com https://www.gstatic.com` |
| `style-src` | `https://translate.googleapis.com` |
| `img-src` | `https://translate.google.com https://www.gstatic.com https://www.google.com` |
| `connect-src` | `https://translate.googleapis.com https://translate-pa.googleapis.com https://translate.google.com` |
| `frame-src` | Replace `'none'` with `https://translate.google.com` |
| `font-src` | Add new directive: `https://fonts.gstatic.com` |

## 4. Scope exclusions

- No image OCR/translation (paid API, out of scope).
- Individual Defense screenshots remain image-only (in-game screenshots, not practical to convert to text).
- Dice Guide remains image-only (simple enough, doesn't need translation per user).
- No changes to other repos (titan-canyon-rosters, worker).

## 5. Testing

- Verify auto-translate fires when browser language is non-English.
- Verify manual dropdown works and translates all visible text.
- Verify Rockfield text modal content translates correctly.
- Verify image toggle switches between text and original infographic.
- Verify `notranslate` elements remain in English.
- Verify CSP does not block Google Translate resources (check browser console).
- Verify Google's default banner is hidden.
- Verify existing functionality (other modals, wheel, theme toggle, triple-click shortcut) is unaffected.
- Verify graceful degradation when Google Translate script is blocked.
- Verify `localStorage` preference is respected on repeat visits.
