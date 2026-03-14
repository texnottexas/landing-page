# Google Translate + Rockfield Text Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Translate auto-detect + manual dropdown to the landing page header, and convert the Rockfield infographic modal into translatable HTML text with an image toggle.

**Architecture:** Single-file changes to `index.html`. The Google Translate widget script is loaded externally and initialized via JS. The Rockfield modal HTML replaces the current image-only modal. CSP meta tag is updated to allow Google Translate domains.

**Tech Stack:** Google Translate Website Widget (`translate.googleapis.com`), vanilla JS, CSS variables (existing theme system)

**Spec:** `docs/superpowers/specs/2026-03-13-google-translate-rockfield-modal-design.md`

---

## Chunk 1: Google Translate Widget (CSP + CSS + HTML + JS)

All Google Translate changes are applied together in a single commit to avoid broken intermediate states.

### Task 1: Add Google Translate — full integration

**Files:**
- Modify: `index.html:7` (CSP meta tag)
- Modify: `index.html:789-792` (inside `<style>` block, before closing `</style>`)
- Modify: `index.html:798` (header-title — add notranslate)
- Modify: `index.html:801-808` (header-actions div)
- Modify: `index.html:821` (Titan Canyon w-label — add notranslate)
- Modify: `index.html:833` (Rockfield w-label — add notranslate)
- Modify: `index.html:837` (Mathomhouse w-label — add notranslate)
- Modify: `index.html:844` (wheel-center — add notranslate)
- Modify: `index.html:1171` (before closing `})();` of IIFE — add fallback)
- Modify: `index.html:1173-1174` (after IIFE script, before `</body>` — add translate init script)

- [ ] **Step 1: Update CSP meta tag (line 7)**

Replace the existing CSP meta tag:

```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://i.ibb.co https://translate.google.com https://www.gstatic.com https://www.google.com; style-src 'unsafe-inline' https://translate.googleapis.com; script-src 'unsafe-inline' https://translate.googleapis.com https://translate.google.com https://www.gstatic.com; connect-src https://rickroll-counter.27tb8s6fct.workers.dev https://translate.googleapis.com https://translate-pa.googleapis.com https://translate.google.com; frame-src https://translate.google.com; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'self'; font-src https://fonts.gstatic.com;">
```

- [ ] **Step 2: Add Google Translate + dismiss CSS (before closing `</style>` tag, line 792)**

Insert before the `</style>` closing tag:

```css
    /* Google Translate overrides */
    body { top: 0 !important; }
    body > .skiptranslate { display: none !important; }
    .goog-te-gadget { font-size: 0 !important; }
    .goog-te-gadget .goog-te-combo {
      background: var(--card);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: .35rem .5rem;
      font-size: .8rem;
      font-family: inherit;
      cursor: pointer;
      outline: none;
    }
    .goog-te-gadget .goog-te-combo:hover { border-color: var(--accent); }
    .translate-wrap {
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    .translate-wrap .globe-icon {
      color: var(--muted);
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .translate-unavailable {
      font-size: .75rem;
      color: var(--muted);
      cursor: default;
    }
    .translate-dismiss {
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: .85rem;
      padding: 0 .2rem;
    }
    .translate-dismiss:hover { color: var(--text); }
```

- [ ] **Step 3: Add notranslate to header branding (line 798)**

Change:
```html
      <div class="header-title">&#9876; TW Server 2864 Landing Page</div>
```
To:
```html
      <div class="header-title notranslate">&#9876; TW Server 2864 Landing Page</div>
```

- [ ] **Step 4: Replace header-actions with translate widget (lines 801-808)**

Replace:
```html
    <div class="header-actions">
      <a href="https://shattereddisk.github.io/rickroll/" target="_blank" rel="noopener noreferrer" class="easter-egg" title="">&#127828;</a>
      <a href="https://titan.2864tw.com" target="_blank" rel="noopener noreferrer" class="hdr-btn">&#9876; Rosters</a>
      <button class="hdr-btn" id="themeBtn" aria-label="Toggle dark/light theme">
        <span class="icon-dark">&#9790;</span>
        <span class="icon-light">&#9728;&#65039;</span>
      </button>
    </div>
```
With:
```html
    <div class="header-actions">
      <a href="https://shattereddisk.github.io/rickroll/" target="_blank" rel="noopener noreferrer" class="easter-egg" title="">&#127828;</a>
      <div class="translate-wrap">
        <svg class="globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
        <div id="google_translate_element"></div>
        <button id="translateDismiss" class="translate-dismiss" aria-label="Dismiss translation" style="display:none">&#10005;</button>
      </div>
      <a href="https://titan.2864tw.com" target="_blank" rel="noopener noreferrer" class="hdr-btn">&#9876; Rosters</a>
      <button class="hdr-btn" id="themeBtn" aria-label="Toggle dark/light theme">
        <span class="icon-dark">&#9790;</span>
        <span class="icon-light">&#9728;&#65039;</span>
      </button>
    </div>
```

- [ ] **Step 5: Add notranslate to game-specific wheel labels**

Line 821 — Change:
```html
        <span class="w-label">Titan Canyon</span>
```
To:
```html
        <span class="w-label notranslate">Titan Canyon</span>
```

Line 833 — Change:
```html
        <span class="w-label">Rockfield</span>
```
To:
```html
        <span class="w-label notranslate">Rockfield</span>
```

Line 837 — Change:
```html
        <span class="w-label">Mathomhouse</span>
```
To:
```html
        <span class="w-label notranslate">Mathomhouse</span>
```

Line 844 — Change:
```html
      <a href="https://shattereddisk.github.io/rickroll/" target="_blank" rel="noopener noreferrer" class="wheel-center">2864<span class="wheel-sub">fk boats</span></a>
```
To:
```html
      <a href="https://shattereddisk.github.io/rickroll/" target="_blank" rel="noopener noreferrer" class="wheel-center notranslate">2864<span class="wheel-sub">fk boats</span></a>
```

- [ ] **Step 6: Add graceful degradation fallback (inside IIFE, before closing `})();`)**

Insert just before the `})();` at the end of the existing IIFE script block (line 1172):

```js
      // Google Translate fallback: if script fails to load, show "unavailable"
      setTimeout(function() {
        var el = document.getElementById('google_translate_element');
        if (el && !el.querySelector('.goog-te-combo')) {
          var span = document.createElement('span');
          span.className = 'translate-unavailable';
          span.textContent = 'Translation unavailable';
          el.textContent = '';
          el.appendChild(span);
        }
      }, 5000);
```

- [ ] **Step 7: Add Google Translate init script (after IIFE `</script>`, before `</body>`)**

Insert after the closing `</script>` of the IIFE and before `</body>`:

```html
  <script>
    function googleTranslateElementInit() {
      new google.translate.TranslateElement({
        pageLanguage: 'en',
        autoDisplay: false,
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE
      }, 'google_translate_element');

      // Auto-detect: if browser is non-English and user hasn't dismissed, trigger translation
      try {
        var dismissed = localStorage.getItem('translate-dismissed');
        if (!dismissed) {
          var lang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
          if (lang !== 'en') {
            var attempts = 0;
            var trySet = setInterval(function() {
              var combo = document.querySelector('.goog-te-combo');
              if (combo) {
                combo.value = lang;
                combo.dispatchEvent(new Event('change'));
                clearInterval(trySet);
                showDismissBtn();
              }
              if (++attempts > 20) clearInterval(trySet);
            }, 250);
          }
        }
      } catch(e) {}

      // Show dismiss button when user manually selects a non-English language
      var combo = document.querySelector('.goog-te-combo');
      if (combo) {
        combo.addEventListener('change', function() {
          if (combo.value && combo.value !== 'en') {
            showDismissBtn();
          }
        });
      }
    }

    function showDismissBtn() {
      var btn = document.getElementById('translateDismiss');
      if (btn) btn.style.display = '';
    }

    // Dismiss handler
    document.getElementById('translateDismiss').addEventListener('click', function() {
      try { localStorage.setItem('translate-dismissed', '1'); } catch(e) {}
      document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      location.reload();
    });
  </script>
  <script src="https://translate.googleapis.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
```

- [ ] **Step 8: Commit all Google Translate changes**

```bash
git add index.html
git commit -S -m "feat: add Google Translate widget with auto-detect, manual dropdown, and notranslate protections"
```

---

## Chunk 2: Rockfield Text Modal (HTML + CSS + JS in single commit)

All Rockfield modal changes are applied together to avoid a broken intermediate state where the modal opens but can't close.

### Task 2: Replace Rockfield modal — full implementation

**Files:**
- Modify: `index.html:854-856` (rockfield-modal HTML)
- Modify: `index.html` (style block — add Rockfield CSS after Google Translate CSS)
- Modify: `index.html:1072` (modal close handler array)
- Modify: `index.html:1085` (Escape key handler selector)
- Modify: `index.html` (IIFE — add toggle JS)

- [ ] **Step 1: Add Rockfield modal CSS (in `<style>` block, after Google Translate CSS)**

Insert after the Google Translate CSS added in Task 1:

```css
    /* Rockfield text modal */
    .rockfield-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 300;
      background: rgba(0,0,0,0.7);
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .rockfield-modal.active { display: flex; }
    .rockfield-modal-content {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      padding: 1.5rem;
    }
    .rf-toggle {
      display: flex;
      gap: .5rem;
      margin-bottom: 1rem;
    }
    .rf-toggle-btn {
      background: var(--tag);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: .4rem .8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: .8rem;
      font-family: inherit;
    }
    .rf-toggle-btn.active {
      background: var(--accent);
      color: var(--bg);
      border-color: var(--accent);
    }
    .rf-title {
      color: var(--accent);
      font-size: 1.3rem;
      margin-bottom: 1rem;
      text-align: center;
    }
    .rf-section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: .75rem;
      position: relative;
      padding-left: 3rem;
    }
    .rf-num {
      position: absolute;
      left: .75rem;
      top: .85rem;
      width: 1.6rem;
      height: 1.6rem;
      background: var(--accent);
      color: var(--bg);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: .85rem;
    }
    .rf-section h3 {
      font-size: .95rem;
      margin-bottom: .5rem;
      color: var(--text);
    }
    .rf-section ul {
      list-style: disc;
      padding-left: 1.2rem;
      font-size: .85rem;
      color: var(--text);
    }
    .rf-section ul li { margin-bottom: .3rem; }
    .rf-section p {
      font-size: .85rem;
      color: var(--text);
      margin-bottom: .3rem;
    }
    .rf-note {
      font-size: .75rem;
      color: var(--muted);
      font-style: italic;
      margin-top: .5rem;
    }
    .rf-yes { color: var(--army); font-weight: 600; }
    .rf-no { color: #f85149; font-weight: 600; }
```

- [ ] **Step 2: Replace rockfield-modal HTML (lines 854-856)**

Replace:
```html
  <div id="rockfield-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Rockfield Guide">
    <img src="https://i.ibb.co/Fb0bzjVh/Rockfield-Updated.png" alt="Rockfield Guide" crossorigin="anonymous">
  </div>
```

With:
```html
  <div id="rockfield-modal" class="rockfield-modal" role="dialog" aria-modal="true" aria-label="Rockfield Guide">
    <div class="rockfield-modal-content">
      <div class="rf-toggle">
        <button class="rf-toggle-btn active" id="rf-text-btn" aria-pressed="true">Text Guide</button>
        <button class="rf-toggle-btn" id="rf-img-btn" aria-pressed="false">Original Image</button>
      </div>

      <div id="rf-text-view">
        <h2 class="rf-title">How To Do <span class="notranslate">Rockfield</span> Like A Pro</h2>

        <div class="rf-section">
          <span class="rf-num">1</span>
          <h3>Heroes: The Cast</h3>
          <ul>
            <li><strong class="notranslate">Rockfield</strong> &mdash; The hero of our story!</li>
            <li><strong class="notranslate">Kuruzo</strong> &mdash; Boosts your <span class="notranslate">March Size</span> by 5*</li>
            <li>Requires <span class="notranslate">Kuruzo</span> at 5*, otherwise use any 5* <span class="notranslate">SSR</span> powerhouse of your choice.</li>
          </ul>
        </div>

        <div class="rf-section">
          <span class="rf-num">2</span>
          <h3>Skills: <span class="notranslate">March Size</span> Matters</h3>
          <ul>
            <li><span class="notranslate">Rockfield</span> Exclusive Skill</li>
            <li><span class="notranslate">March Size</span> (Rare)</li>
            <li><span class="notranslate">March Size</span> (Normal)</li>
          </ul>
        </div>

        <div class="rf-section">
          <span class="rf-num">3</span>
          <h3>Units: Air Force ONLY</h3>
          <ul>
            <li>Best optimal performance: <strong class="notranslate">Valhallas</strong> (level 105)</li>
            <li>Not recommended: <span class="notranslate">Heavy Troopers</span> (level 50)</li>
            <li>True damage is reduced if your units are lower level than the enemy.</li>
          </ul>
        </div>

        <div class="rf-section">
          <span class="rf-num">4</span>
          <h3>Maths: For the Geeks</h3>
          <p><strong>Air Force Pre-Battle Skill:</strong></p>
          <ul>
            <li>Trigger: Activates once before the first battle round</li>
            <li>Effect: Deals (X)% of each enemy unit's max HP as true damage</li>
          </ul>
          <p><strong>Damage Reductions:</strong></p>
          <ul>
            <li>&minus;35% damage per level your units are below enemy's average level</li>
            <li>&minus;1% damage for every 1% fewer troops than the enemy</li>
          </ul>
          <p><strong>Bonus:</strong> Inflicts (X)% <span class="notranslate">Debilitation</span> on all enemy Naval units for 2 turns</p>
          <p class="rf-note">* (X varies by player)</p>
        </div>

        <div class="rf-section">
          <span class="rf-num">5</span>
          <h3>Field Tests</h3>
          <ul>
            <li>Air Force vs Ground: <span class="rf-yes">Effective</span></li>
            <li>Air Force vs Naval: <span class="rf-yes">Effective</span></li>
            <li>Air Force vs Air Force: <span class="rf-no">Not Effective</span></li>
          </ul>
        </div>
      </div>

      <div id="rf-img-view" style="display:none">
        <img src="https://i.ibb.co/Fb0bzjVh/Rockfield-Updated.png" alt="Rockfield Guide Infographic" crossorigin="anonymous" style="max-width:100%;border-radius:8px;">
      </div>

      <button class="unit-modal-close" id="rockfield-modal-close">Close</button>
    </div>
  </div>
```

- [ ] **Step 3: Update modal close handlers in JS**

The rockfield-modal changed from `class="modal-overlay"` to `class="rockfield-modal"`, so it no longer matches the `.modal-overlay` close handler (line 1065). Add it to the explicit close handler array.

Change line 1072:
```js
      ['unit-modal', 'tc-modal', 'defense-modal'].forEach(function(id) {
```
To:
```js
      ['unit-modal', 'tc-modal', 'defense-modal', 'rockfield-modal'].forEach(function(id) {
```

Update the Escape key handler (line 1085):
```js
          document.querySelectorAll('.modal-overlay.active, .unit-modal.active, .tc-modal.active, .defense-modal.active, .rockfield-modal.active').forEach(function(m) {
```

- [ ] **Step 4: Add text/image toggle JS (inside IIFE)**

Add inside the IIFE, after the modal close handlers:

```js
      // Rockfield modal: text/image toggle
      var rfTextBtn = document.getElementById('rf-text-btn');
      var rfImgBtn = document.getElementById('rf-img-btn');
      var rfTextView = document.getElementById('rf-text-view');
      var rfImgView = document.getElementById('rf-img-view');

      if (rfTextBtn && rfImgBtn) {
        rfTextBtn.addEventListener('click', function() {
          rfTextView.style.display = '';
          rfImgView.style.display = 'none';
          rfTextBtn.classList.add('active');
          rfTextBtn.setAttribute('aria-pressed', 'true');
          rfImgBtn.classList.remove('active');
          rfImgBtn.setAttribute('aria-pressed', 'false');
        });
        rfImgBtn.addEventListener('click', function() {
          rfTextView.style.display = 'none';
          rfImgView.style.display = '';
          rfImgBtn.classList.add('active');
          rfImgBtn.setAttribute('aria-pressed', 'true');
          rfTextBtn.classList.remove('active');
          rfTextBtn.setAttribute('aria-pressed', 'false');
        });
      }
```

- [ ] **Step 5: Commit all Rockfield modal changes**

```bash
git add index.html
git commit -S -m "feat: replace Rockfield image modal with translatable HTML text modal and image toggle"
```

---

## Chunk 3: Testing + Push

### Task 3: Manual testing checklist

- [ ] **Step 1: Open the page in browser and verify:**

1. Globe icon visible in header next to theme toggle
2. Google Translate dropdown loads and is styled to match theme
3. Selecting a language translates page text
4. Game terms with `notranslate` remain in English (check: header title, Titan Canyon, Rockfield, Mathomhouse, wheel center)
5. Auto-translate fires if browser language is non-English (test by changing language override in DevTools)
6. Dismiss button appears when translation is active
7. Clicking dismiss stores preference in localStorage and reloads without translation
8. No CSP errors in browser console
9. Rockfield wheel item opens the new text modal
10. Toggle between "Text Guide" and "Original Image" works
11. All 5 sections render with correct content and styling
12. Close button and backdrop click close the Rockfield modal
13. Escape key closes the Rockfield modal
14. Theme toggle still works (dark/light)
15. All other modals (Dice Guide, Free Unit, TC, Defense) still work
16. Triple-click banner shortcut still works
17. Mobile layout looks correct (test at 375px width)
18. "Translation unavailable" shows after 5s if Google Translate script is blocked (test by blocking domain in DevTools Network tab)

- [ ] **Step 2: Fix any issues found, commit**

```bash
git add index.html
git commit -S -m "fix: address issues found during testing"
```

- [ ] **Step 3: Push to remote**

```bash
git push origin main
```
