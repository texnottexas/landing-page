// Guide films for the bookmarklets: unlisted YouTube videos built in the
// texnottexas/tw-guide-films repo. One place for the IDs, the device default and
// the embed, used by armory-report.html (Import modal) and rickroll.html.
(function (root) {
  'use strict';

  var FILMS = {
    armoryFirefox: { id: 'oJzwzk23Wy0', label: 'Firefox', shape: 'portrait' },
    armoryChrome: { id: 'AeJQdsfFOlQ', label: 'Chrome (Android)', shape: 'portrait' },
    opsFirefox: { id: 'kFM_6rfewek', label: 'Firefox', shape: 'portrait' },
    opsChrome: { id: 'rpVzcwY9kbw', label: 'Chrome (Android)', shape: 'portrait' },
    opsDesktop: { id: '7u_bMEbqXpk', label: 'Desktop', shape: 'landscape' }
  };

  var SETS = {
    armory: {
      title: 'Watch the walkthrough',
      sub: 'Battles, one bookmark, Snapshot. About 2 minutes.',
      films: ['armoryFirefox', 'armoryChrome'],
      pick: { ios: 'armoryFirefox', android: 'armoryChrome', desktop: 'armoryFirefox' },
      skip: {
        hint: 'Already have the Ops Center bookmark? ',
        label: 'Skip to Snapshot →',
        // Seconds from tw-guide-films out/youtube/skip.json (start of the Snapshot chapter).
        at: { armoryFirefox: 66, armoryChrome: 75 }
      },
      link: { film: 'opsDesktop', text: 'On a computer? Desktop setup video' },
      collapsed: false
    },
    ops: {
      title: 'Watch how',
      sub: 'About 1 to 1½ minutes.',
      films: ['opsFirefox', 'opsChrome', 'opsDesktop'],
      pick: { ios: 'opsFirefox', android: 'opsChrome', desktop: 'opsDesktop' },
      collapsed: true
    }
  };

  function platform(ua, maxTouch) {
    ua = ua || '';
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (maxTouch || 0) > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }
  function defaultFilm(setName, plat) { return SETS[setName].pick[plat]; }
  function embedSrc(id, startSec) {
    return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?rel=0' + (startSec > 0 ? '&start=' + Math.floor(startSec) : '');
  }
  function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); }

  function buildCard(setName) {
    var doc = root.document;
    var set = SETS[setName];
    var nav = root.navigator || {};
    var current = defaultFilm(setName, platform(nav.userAgent, nav.maxTouchPoints));

    var card = doc.createElement(set.collapsed ? 'details' : 'div');
    card.className = 'guide-videos';
    card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:.7rem .85rem;margin:0 0 .9rem;';
    var head = doc.createElement(set.collapsed ? 'summary' : 'div');
    head.style.cssText = 'font-size:.85rem;font-weight:600;color:var(--text);' + (set.collapsed ? 'cursor:pointer;' : '');
    head.textContent = set.title;
    var sub = doc.createElement('span');
    sub.style.cssText = 'font-weight:400;font-size:.72rem;color:var(--muted);margin-left:.5rem;';
    sub.textContent = set.sub;
    head.appendChild(sub);
    card.appendChild(head);

    var body = doc.createElement('div');
    body.style.cssText = 'margin-top:.55rem;';
    card.appendChild(body);

    var row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.55rem;flex-wrap:wrap;';
    var buttons = set.films.map(function (key) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.dataset.film = key;
      b.style.cssText = 'padding:.3rem .65rem;font-size:.72rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);font-family:inherit;';
      b.textContent = FILMS[key].label;
      b.onclick = function () { paint(key, 0); };
      row.appendChild(b);
      return b;
    });
    body.appendChild(row);

    if (set.skip) {
      var hint = doc.createElement('div');
      hint.style.cssText = 'font-size:.72rem;color:var(--muted);margin-bottom:.55rem;line-height:1.45;';
      hint.appendChild(doc.createTextNode(set.skip.hint));
      var skip = doc.createElement('button');
      skip.type = 'button';
      skip.className = 'guide-skip';
      skip.style.cssText = 'background:none;border:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font-size:inherit;font-family:inherit;';
      skip.textContent = set.skip.label;
      skip.onclick = function () { paint(current, set.skip.at[current] || 0); };
      hint.appendChild(skip);
      body.appendChild(hint);
    }

    var wrap = doc.createElement('div');
    body.appendChild(wrap);

    if (set.link) {
      var a = doc.createElement('a');
      a.className = 'guide-link';
      a.href = watchUrl(FILMS[set.link.film].id);
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.cssText = 'display:inline-block;margin-top:.5rem;font-size:.72rem;color:var(--accent);';
      a.textContent = set.link.text;
      body.appendChild(a);
    }

    function paint(key, startSec) {
      current = key;
      buttons.forEach(function (b) {
        var on = b.dataset.film === key;
        b.style.background = on ? 'var(--accent)' : 'var(--card)';
        b.style.color = on ? '#0d1117' : 'var(--text)';
        b.style.fontWeight = on ? '700' : '500';
        b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
      });
      var film = FILMS[key];
      // Portrait films: as wide as the card allows, but never taller than 70% of the screen.
      wrap.style.cssText = film.shape === 'portrait'
        ? 'position:relative;aspect-ratio:9/16;width:min(100%,calc(70vh * 9 / 16));margin:0 auto;background:#000;border-radius:6px;overflow:hidden;'
        : 'position:relative;aspect-ratio:16/9;width:100%;background:#000;border-radius:6px;overflow:hidden;';
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      var iframe = doc.createElement('iframe');
      iframe.src = embedSrc(film.id, startSec);
      iframe.title = 'Guide video: ' + film.label;
      iframe.allow = 'accelerometer; encrypted-media; picture-in-picture';
      iframe.allowFullscreen = true;
      // 2864tw.com sends Referrer-Policy: same-origin (a Cloudflare transform). Without
      // this override the embed sends no Referer and YouTube fails with error 153.
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;';
      wrap.appendChild(iframe);
    }

    // A collapsed card loads nothing from YouTube until the viewer opens it, and closing
    // it removes the player so a playing video doesn't keep going out of sight.
    if (set.collapsed) {
      card.addEventListener('toggle', function () {
        if (card.open) { if (!wrap.firstChild) paint(current, 0); }
        else while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      });
    }
    else paint(current, 0);
    return card;
  }

  var GuideVideos = { FILMS: FILMS, SETS: SETS, platform: platform, defaultFilm: defaultFilm, embedSrc: embedSrc, watchUrl: watchUrl, buildCard: buildCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = GuideVideos;
  else root.GuideVideos = GuideVideos;
})(typeof window !== 'undefined' ? window : this);
