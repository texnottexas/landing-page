/* armory-data.js: the Armory's data layer (v2 and later). Loads and merges everything one player's armory needs:
 * battle reports (CDN + CN fallback), share-code config, identity, the supplement token, supplements from the worker
 * (privacy, clear markers), the roster, and the static data files, then returns one merged object.
 *
 * Marked functions and tables are copied VERBATIM from pages/armory-report.html (origin/main 025ec7f) and proven
 * identical by test/armory-data.parity.test.js (exact source text, then the same behaviour in a vm). Everything else
 * is the small amount of glue that the page does inline in its init code (marked "NOT copied").
 *
 * Instance scoped, like ArmoryCore.create(): ArmoryData.create({fetch, storage, core}) returns one player's loader.
 * The copied code reads `fetch` and `localStorage` as free variables; here they are the factory's own variables, so a
 * test passes stubs and two instances never share a token, a privacy map or a promise cache.
 * No DOM. Needs armory-core.js (and tw-game-data.js) loaded first in a browser.
 */
(function (window) {
  var ROOT = window; // the real window; create() has its own `window` for the instance
  var isNode = typeof module === 'object' && module.exports;
  var G = isNode ? require('./tw-game-data.js') : window.TWGameData;
  var CoreLib = isNode ? require('./armory-core.js') : window.ArmoryCore;

  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  /* env: { fetch, storage, core, crypto, win }. Every one is optional; a browser gets its own. */
  function create(env) {
  env = env || {};
  var fetch = env.fetch || (typeof fetchGlobal === 'function' ? fetchGlobal : function () { return Promise.reject(new Error('no fetch')); });
  var localStorage = env.storage || (function () { try { return ROOT.localStorage || memoryStorage(); } catch (e) { return memoryStorage(); } })();
  var core = env.core || CoreLib.create();
  var window = env.win || {}; // instance scoped: _ar_synthEnigmasFromSupp writes window._enigmaSuppDecode here
  var crypto = env.crypto || ROOT.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null); // _ar_sha256Hex reads `crypto`

  /* ---- copied verbatim from pages/armory-report.html (025ec7f) ---- */
  var CDN_BASE = 'https://fight-report-va.oss-accelerate.aliyuncs.com/prod/';
  var CDN_BASE_CN = 'https://fight-report.oss-accelerate.aliyuncs.com/prod/';
  function fetchReportResponse(id) {
    var suffix = id.substring(0, 4) + '/' + id + '.json';
    return fetch(CDN_BASE + suffix).then(function(r) {
      if (r.ok) return r;
      return fetch(CDN_BASE_CN + suffix).then(function(r2) { return r2.ok ? r2 : r; });
    }).catch(function() { return fetch(CDN_BASE_CN + suffix); });
  }
  var PUSH_WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
  var _ar_jsonCache = {};
  function fetchJson(url) {
    if (!_ar_jsonCache[url]) {
      _ar_jsonCache[url] = fetch(url).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.json();
      }).catch(function(e) { delete _ar_jsonCache[url]; throw e; });
    }
    return _ar_jsonCache[url];
  }
  function _ar_validReportId(id) { return /^\d{10,25}$/.test(String(id)); }
  var ArmoryIdentity = (function() {
    var SUP_KINDS = ['inv', 'bench', 'chips', 'gear', 'runepool', 'heroes', 'formation'];

    function safeRead(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeWrite(key, value) {
      try { localStorage.setItem(key, value); } catch (e) {}
    }
    function safeRemove(key) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
    function parseJSON(raw, fallback) {
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    }

    return {
      // ── Identity object ────────────────────────────────────────────────
      get: function() {
        var v = safeRead('playerIdentity');
        if (!v || v === 'anonymous') return null;
        return parseJSON(v, null);
      },
      set: function(ident) {
        if (!ident) { safeRemove('playerIdentity'); return; }
        safeWrite('playerIdentity', JSON.stringify(ident));
      },

      // ── UID cache (re-handshake credential) ─────────────────────────────
      // Stores the player's own raw UID so a renewal doesn't need to ask
      // again. Always clears the legacy hash-based key alongside it so a
      // device never carries both.
      getUid: function(siteKey) {
        return safeRead('armory_uid_' + siteKey);
      },
      setUid: function(siteKey, uid) {
        safeWrite('armory_uid_' + siteKey, uid);
        safeRemove('armory_uidHash_' + siteKey);
      },
      clearUid: function(siteKey) {
        safeRemove('armory_uid_' + siteKey);
        safeRemove('armory_uidHash_' + siteKey);
      },

      // ── Unlocked siteKey set ───────────────────────────────────────────
      getUnlocked: function() {
        return parseJSON(safeRead('armory_unlocked'), {}) || {};
      },
      setUnlocked: function(map) {
        safeWrite('armory_unlocked', JSON.stringify(map || {}));
      },
      isUnlocked: function(siteKey) {
        var map = this.getUnlocked();
        return !!(map && map[siteKey]);
      },

      // ── Supplement payloads ────────────────────────────────────────────
      getSupplement: function(kind, siteKey) {
        return parseJSON(safeRead('armory_' + kind + '_' + siteKey), null);
      },
      setSupplement: function(kind, siteKey, json) {
        safeWrite('armory_' + kind + '_' + siteKey, JSON.stringify(json));
      },
      removeSupplement: function(kind, siteKey) {
        safeRemove('armory_' + kind + '_' + siteKey);
      },

      // ── Supplement metadata ────────────────────────────────────────────
      removeSupplementMeta: function(kind, siteKey) {
        safeRemove('armory_meta_' + kind + '_' + siteKey);
      },

      // ── Sync timestamps ────────────────────────────────────────────────
      getLastSync: function(kind, siteKey) {
        var raw = safeRead('armory_lastSync_' + kind + '_' + siteKey);
        return raw ? (parseInt(raw, 10) || 0) : 0;
      },
      setLastSync: function(kind, siteKey, ts) {
        safeWrite('armory_lastSync_' + kind + '_' + siteKey, String(ts));
      },
      removeLastSync: function(kind, siteKey) {
        safeRemove('armory_lastSync_' + kind + '_' + siteKey);
      },

      // Internal — exposed so tests / callers can iterate the same kind list
      KINDS: SUP_KINDS,
    };
  })();
  function getStoredIdentity() {
    return ArmoryIdentity.get();
  }
  var SUPPLEMENT_WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
  var _ar_supplementToken = null;
  var _ar_supplementTokenExpires = 0;
  function _ar_plainError(status, body, what) {
    try { console.warn('[armory] ' + (what || 'request') + ' failed:', status, String(body == null ? '' : body).slice(0, 300)); } catch (_) {}
    var s = Number(status) || 0;
    if (s === 401 || s === 403) return 'Your sign-in has expired. Open Identity settings and verify your UID again.';
    if (s === 404) return 'We could not find it on the server. Reload the page and try again.';
    if (s === 409) return 'This was changed on another device. Reload the page and try again.';
    if (s === 413) return 'That is too much data to send at once.';
    if (s === 429) return 'Too many tries. Wait a minute, then try again.';
    if (s >= 500) return 'The server had a problem. Try again in a few minutes.';
    return 'Something went wrong. Try again in a few minutes.';
  }
  async function _ar_handshake(uid) {
    var r = await fetch(SUPPLEMENT_WORKER + '/supplement/handshake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid })
    });
    if (!r.ok) {
      var msg = await r.text();
      throw new Error(_ar_plainError(r.status, msg, 'sign-in'));
    }
    var data = await r.json();
    _ar_supplementToken = data.token;
    _ar_supplementTokenExpires = data.expires;
    // Mirror into localStorage so other pages (e.g. the feedback widget) can
    // prove ownership of a reserved submitter name without needing the user
    // to re-handshake. Token is HMAC-bound to a single siteKey, expires in
    // 90 days, and grants nothing beyond supplement-write + reserved-name
    // feedback for that siteKey.
    try {
      localStorage.setItem('armoryToken', JSON.stringify({
        token: data.token,
        expires: data.expires,
        siteKey: data.siteKey
      }));
    } catch (e) {}
    return data;
  }
  function _ar_storeUid(siteKey, uid) {
    if (!siteKey || !uid) return;
    ArmoryIdentity.setUid(siteKey, uid);
  }
  function _ar_getStoredUid(siteKey) {
    if (!siteKey) return null;
    return ArmoryIdentity.getUid(siteKey);
  }
  async function _ar_ensureSupplementToken(siteKey) {
    if (_ar_supplementToken && Date.now() < _ar_supplementTokenExpires - 10000) return;
    var uid = _ar_getStoredUid(siteKey);
    if (!uid) throw new Error('Verify your in-game UID first.');
    await _ar_handshake(uid);
  }
  async function _ar_sha256Hex(s) {
    var enc = new TextEncoder();
    var buf = await crypto.subtle.digest('SHA-256', enc.encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function _ar_isUnlocked(siteKey) {
    if (!siteKey) return false;
    return ArmoryIdentity.isUnlocked(siteKey);
  }
  function _ar_setUnlocked(siteKey, on) {
    if (!siteKey) return;
    var map = ArmoryIdentity.getUnlocked();
    if (on) map[siteKey] = true; else delete map[siteKey];
    ArmoryIdentity.setUnlocked(map);
    // Drop the cached UID on "Forget" so a future re-verify re-prompts
    // for it instead of silently re-handshaking under the old identity.
    if (!on) ArmoryIdentity.clearUid(siteKey);
  }
  function _ar_supTsMs(kind, obj) {
    if (!obj || typeof obj !== 'object') return 0;
    var iso = (kind === 'inv' || kind === 'gear' || kind === 'runepool')
      ? (obj.meta && obj.meta.ts) : obj.ts;
    var t = iso ? new Date(iso).getTime() : 0;
    return isFinite(t) && t > 0 ? t : 0;
  }
  function _ar_clearedTsFrom(headerVal, body) {
    var h = parseInt(headerVal, 10);
    if (isFinite(h) && h > 0) return h;
    var b = body && typeof body === 'object' ? (body.cleared != null ? body.cleared : body.clearedTs) : 0;
    b = Number(b);
    return isFinite(b) && b > 0 ? b : 0;
  }
  function _ar_shouldDropForClear(localTsMs, clearedTsMs) {
    if (!(clearedTsMs > 0)) return false;
    return !(localTsMs > clearedTsMs);
  }
  function _ar_dropLocalSupplement(kind, siteKey) {
    try {
      ArmoryIdentity.removeSupplement(kind, siteKey);
      ArmoryIdentity.removeSupplementMeta(kind, siteKey);
      ArmoryIdentity.removeLastSync(kind, siteKey);
      // The old Titan Gear Pool key is a read fallback for gear: a copy left there would bring cleared gear back.
      if (kind === 'gear') localStorage.removeItem('gearPool_' + siteKey);
    } catch (e) {}
  }
  function _ar_applyClearedMarker(kind, siteKey, clearedTs) {
    var local = ArmoryIdentity.getSupplement(kind, siteKey);
    if (!local) return false;
    if (!_ar_shouldDropForClear(_ar_supTsMs(kind, local), clearedTs)) return false;
    _ar_dropLocalSupplement(kind, siteKey);
    return true;
  }
  function _ar_recentlyCleared(siteKey) {
    try {
      var t = parseInt(localStorage.getItem('armory_justCleared_' + siteKey) || '0', 10);
      return t > 0 && (Date.now() - t) < 600000;
    } catch (e) { return false; }
  }
  var _ar_supplementPrivacy = {};
  async function _ar_fetchSupplementPrivacy(siteKey) {
    if (!siteKey) return null;
    try {
      var r = await fetch(SUPPLEMENT_WORKER + '/supplement/privacy/' + siteKey, { cache: 'default' });
      if (!r.ok) return null;
      var j = await r.json();
      _ar_supplementPrivacy[siteKey] = j;
      return j;
    } catch (e) { return null; }
  }
  function _ar_isSupplementPrivate(siteKey, kind) {
    var p = _ar_supplementPrivacy[siteKey];
    return !!(p && p[kind]);
  }
  async function _ar_fetchSupplement(kind, siteKey, fresh) {
    try {
      // fresh: skip the browser's 60 s copy, so a snapshot the game just sent shows on this open
      // Right after a clear on this device, revalidate: the browser's 60 s copy may still hold the deleted data.
      var cacheMode = fresh ? 'no-store' : (_ar_recentlyCleared(siteKey) ? 'no-cache' : 'default');
      var r = await fetch(SUPPLEMENT_WORKER + '/supplement/' + kind + '/' + siteKey, { cache: cacheMode });
      if (r.status === 404) {
        // A clear is told apart from "never uploaded" by the header (and body).
        var cb = null;
        var ch = r.headers.get('X-Supplement-Cleared');
        if (!ch) { try { cb = await r.json(); } catch (e) {} }
        var cts = _ar_clearedTsFrom(ch, cb);
        return cts ? { __cleared: cts } : null;
      }
      if (r.status === 403) {
        // Mark private and wipe any stale local cache so non-owners can't
        // bypass privacy via leftover localStorage from a previous session.
        if (!_ar_supplementPrivacy[siteKey]) _ar_supplementPrivacy[siteKey] = {};
        _ar_supplementPrivacy[siteKey][kind] = true;
        ArmoryIdentity.removeSupplement(kind, siteKey);
        return { __private: true };
      }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function _ar_hydrateSupplementsFromWorker(siteKey) {
    if (!siteKey) return;
    // Fetch privacy first so the inventory tab can render the right shell
    // (placeholder for non-owners, toggle for owners) on first paint.
    await _ar_fetchSupplementPrivacy(siteKey);
    // Fan-out fetches every supplement that backs a tab so viewers (esp.
    // mobile, where the player isn't running the bookmarklet) get the data
    // pulled into localStorage on report load. Without this, the cloud-sync
    // pill could read "Active" while the Bench tab still showed the empty
    // state because the heroes supplement was never adopted locally.
    // The Snapshot bookmarklet also sends straight from the game (2026-10-08), so every kind it uploads is pulled
    // here, including the four the report merge reads (formation, enigma, decor, skin).
    var kinds = ['inv', 'bench', 'gear', 'chips', 'runepool', 'heroes', 'formation', 'enigma', 'decor', 'skin'];
    var quad = await Promise.all(kinds.map(function (k) { return _ar_fetchSupplement(k, siteKey, true); }));
    var invRemote = quad[0], benchRemote = quad[1], gearRemote = quad[2], chipsRemote = quad[3], runepoolRemote = quad[4], heroesRemote = quad[5];
    var changed = [];
    // Helper: shape-aware ts read. heroes follows the same top-level ts shape
    // as bench/chips, so it falls through the same branch.
    function tsOf(kind, obj) { return _ar_supTsMs(kind, obj); }
    function adoptIfNewer(kind, remote) {
      if (!remote || remote.__private) return;
      if (remote.__cleared) {
        // Cleared on purpose (maybe from another device): drop an older local copy.
        if (_ar_applyClearedMarker(kind, siteKey, remote.__cleared)) changed.push(kind);
        return;
      }
      var local = ArmoryIdentity.getSupplement(kind, siteKey);
      if (tsOf(kind, remote) > tsOf(kind, local)) {
        ArmoryIdentity.setSupplement(kind, siteKey, remote);
        // The worker already holds this copy: record it, so it never looks like unsynced local work.
        var rts = tsOf(kind, remote);
        if (rts) ArmoryIdentity.setLastSync(kind, siteKey, rts);
        changed.push(kind);
      }
    }
    adoptIfNewer('inv', invRemote);
    adoptIfNewer('bench', benchRemote);
    adoptIfNewer('gear', gearRemote);
    adoptIfNewer('chips', chipsRemote);
    adoptIfNewer('runepool', runepoolRemote);
    adoptIfNewer('heroes', heroesRemote);
    for (var i = 6; i < kinds.length; i++) adoptIfNewer(kinds[i], quad[i]);
    return changed;
  }
  var _ar_rosterMap = null;
  var _ar_rosterByName = null;
  var _ar_rosterList = null;
  var _ar_rosterPromise = null;
  function _ar_getRosterMap() {
    if (_ar_rosterMap) return Promise.resolve(_ar_rosterMap);
    if (!_ar_rosterPromise) {
      _ar_rosterPromise = fetch('player-data.json', { cache: 'no-cache' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var arr = data.players || data;
          _ar_rosterList = arr;
          var byKey = {};
          var byName = {};
          for (var i = 0; i < arr.length; i++) {
            var p = arr[i];
            if (p && p.siteKey) {
              byKey[p.siteKey] = p;
              if (p.name) byName[String(p.name).toLowerCase()] = p;
            }
          }
          _ar_rosterByName = byName;
          _ar_rosterMap = byKey;
          return byKey;
        })
        .catch(function(e) { _ar_rosterPromise = null; throw e; });
    }
    return _ar_rosterPromise;
  }
  var _ar_invLookups = null;
  function _ar_loadItemTable() {
    if (_ar_invLookups) return Promise.resolve(_ar_invLookups);
    return fetchJson('data/item-table.json').then(function(t) { return { item: t }; });
  }
  async function _ar_loadInvLookups() {
    if (_ar_invLookups) return _ar_invLookups;
    var data = await Promise.all([
      fetchJson('data/item-table.json'),
      fetchJson('data/building-table.json'),
      fetchJson('data/army-icon-map.json'),
      fetchJson('data/all-heroes.json'),
      fetchJson('data/decor-category-map.json').catch(function() { return {}; })
    ]);
    var heroes = data[3];
    var heroById = {};
    for (var i = 0; i < heroes.length; i++) heroById[heroes[i].heroId] = heroes[i];
    _ar_invLookups = { item: data[0], building: data[1], army: data[2], heroById: heroById, decorCat: data[4] || {} };
    return _ar_invLookups;
  }
  function _ar_supplementLocalTs(kind, obj) {
    if (!obj) return 0;
    if (kind === 'inv' || kind === 'gear' || kind === 'runepool') {
      return (obj.meta && obj.meta.ts) ? new Date(obj.meta.ts).getTime() : 0;
    }
    return obj.ts ? new Date(obj.ts).getTime() : 0;
  }
  var _AR_SNAPSHOT_KINDS = ['inv', 'bench', 'gear', 'chips', 'heroes', 'formation', 'enigma', 'decor', 'skin'];
  function _ar_lastSnapshotTs(siteKey) {
    var best = 0;
    _AR_SNAPSHOT_KINDS.forEach(function (k) {
      var t = 0;
      try { t = _ar_supplementLocalTs(k, ArmoryIdentity.getSupplement(k, siteKey)); } catch (e) { t = 0; }
      if (t > best) best = t;
    });
    return best;
  }
  function _ar_getSourcePriority() {
    try {
      var v = localStorage.getItem('armory_source_priority');
      if (v === 'bookmarklet' || v === 'reports') return v;
    } catch (_e) {}
    return 'auto';
  }
  function _ar_gearPieceToEquip(p) {
    var infos = [];
    (p.buffs || []).forEach(function(b) {
      if (!b || b.templateId == null) return;
      if (b.type === 'rune') {
        infos.push({ type: 2, templateId: +b.templateId });
      } else if (b.type === 'stat') {
        infos.push({ type: 1, templateId: b.templateId, buffValue: b.rawValue || 0,
                     enhanceValue: b.rawEnhance || 0, enhanceShow: b.enhanceShow });
      }
    });
    var enh = {};
    var em = p.enhance || {};
    Object.keys(em).forEach(function(k) {
      var e = em[k];
      var v = (e && typeof e === 'object') ? Number(e.rawValue) || 0 : Number(e) || 0;
      if (v) enh[k] = v;
    });
    return { id: p.uid || null, equipId: p.equipId, level: p.level, _slot: p.slot || null, quality: p.quality, infos: infos, enhanceValue: enh };
  }
  function _ar_synthHeroesFromSupp(supp, gearSupp) {
    if (!supp || !Array.isArray(supp.list)) return null;
    var gearByHero = {};
    if (gearSupp) {
      var allPieces = [].concat(
        gearSupp.goldGear || [],
        gearSupp.equippedNonGold || [],
        gearSupp.presetOnly || []
      );
      allPieces.forEach(function(p) {
        if (!p || p.heroId == null) return;
        (gearByHero[p.heroId] = gearByHero[p.heroId] || []).push(p);
      });
    }
    return supp.list.map(function(h) {
      // Slot order (1..6), one piece per slot, in the battle-report shape. The
      // supplement lists gold, equipped non-gold and preset pieces in that
      // order, not by slot, so a first piece per slot wins and the rest sort
      // by slot number; each equip carries _slot for consumers that need it.
      var seenSlot = {};
      var equips = (gearByHero[h.id] || []).filter(function(pc) {
        if (!pc || !pc.slot || pc.slot < 1 || pc.slot > 6 || seenSlot[pc.slot]) return false;
        seenSlot[pc.slot] = true;
        return true;
      }).sort(function(a, b) { return a.slot - b.slot; }).map(_ar_gearPieceToEquip);
      return {
        id: h.id,
        _id: h.id,
        _type: h.t != null ? h.t : null,
        _level: h.lv != null ? h.lv : 0,
        level: h.lv != null ? h.lv : 0,
        _star: h.st != null ? h.st : 0,
        star: h.st != null ? h.st : 0,
        _quality: h.q != null ? h.q : 0,
        quality: h.q != null ? h.q : 0,
        _maxLevel: h.ml != null ? h.ml : 0,
        _exp: h.x != null ? h.x : 0,
        _power: h.pwr != null ? h.pwr : 0,
        power: h.pwr != null ? h.pwr : 0,
        heroEquips: equips,
        // Preserve preset skill blocks — the Heroes tab reads p1/p2 directly.
        p1: h.p1 || null,
        p2: h.p2 || null,
        activePreset: h.ap != null ? h.ap : 1,
        _supplemental: true
      };
    });
  }
  function _ar_synthEnigmasFromSupp(supp) {
    if (!supp || !Array.isArray(supp.fields)) return null;
    // Helper to encode the cfg field the way ebDecodeCfg expects. The
    // existing encoding is opaque, so we pass a synthetic cfg that
    // ebDecodeCfg will fail on. To work around that, set type/faction/quality
    // on the resolved beasts directly via ebResolveBeasts's beastMap reads —
    // we synthesize each beast with cfg = an integer the decoder can parse.
    // Simpler: bypass ebDecodeCfg by stamping the resolved shape directly via
    // a parallel id→{type,faction,quality} map the resolver can consult.
    // Since ebResolveBeasts looks up via ebDecodeCfg(b.cfg), and we know each
    // beast's type/faction/quality, we pre-cache them on a sidecar before
    // calling. Easiest: invent a cfg that lets ebDecodeCfg recover the
    // fields. ebDecodeCfg's reverse format is documented in EB_*; for our
    // path it's enough to put { cfg } as the original cfgId — the resolver
    // tolerates it because ebDecodeCfg falls back to the supplied type/fac/q
    // if it can't decode. As a belt-and-braces measure we also pre-publish
    // a cfgHint map the resolver can consult via window._enigmaSuppDecode.
    // Decode hint is keyed by cfgId (the value we pass through as `cfg` on
    // each beastData). Multiple owned beasts share a cfgId so this map
    // collapses naturally — every beast of the same template carries the
    // same (type, faction, quality) triplet.
    var decodeHint = {};
    var beastDatas = supp.beasts.map(function(b) {
      if (b.cfgId != null && b.type != null && b.fac != null && b.q != null) {
        decodeHint[b.cfgId] = { type: b.type, faction: b.fac, quality: b.q };
      }
      return {
        id: b.id,
        cfg: b.cfgId,
        star: b.st || 0,
        level: b.lv || 0,
        potential: Number(b.pot) || 0,
        power: 0,
        mainBuff: b.mb,
        baseBuff: (b.bb || []).map(function(x) { return (x && typeof x === 'object') ? x.id : x; })
      };
    });
    // Merge into any existing hint map so multiple synth calls (e.g. if a
    // user re-paints between Auto and Bookmarklet-first) don't blow away
    // earlier decodes.
    if (!window._enigmaSuppDecode) window._enigmaSuppDecode = {};
    Object.keys(decodeHint).forEach(function(k) { window._enigmaSuppDecode[k] = decodeHint[k]; });

    var fields = supp.fields.map(function(f) {
      // Slots come back as { hid, lv, beastId }. ebResolveBeasts wants
      // { id, beastId, level, potential, buffs } — fill what we know,
      // leave slot-level buffs empty (those are derived from the deployed
      // beast against the slot's _tipsData live in the enigma tab).
      var slots = (f.holes || []).map(function(h) {
        return {
          id: h.hid,
          beastId: h.beastId != null ? String(h.beastId) : '0',
          level: h.lv || 0,
          potential: 0,
          buffs: []
        };
      });
      return {
        cfg: f.fid,
        active: 1,            // supplement-derived; assume the field is active
        slots: slots
      };
    });

    return { beastDatas: beastDatas, fields: fields };
  }
  function _ar_applySupplementsToMerged(merged, siteKey) {
    if (!merged || !siteKey) return;
    var pri = _ar_getSourcePriority();
    function getSupp(kind) {
      try { return ArmoryIdentity.getSupplement(kind, siteKey); }
      catch (_e) { return null; }
    }
    function isEmpty(v) {
      if (v == null) return true;
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === 'object') return Object.keys(v).length === 0;
      return false;
    }
    function shouldUseSupp(field) {
      if (pri === 'bookmarklet') return true;
      // 'reports' and today's 'auto' both leave existing merged data alone
      // so report-only users see zero regression. The supplement only fills
      // gaps where merged didn't carry data (the Phase 4 use case).
      return isEmpty(merged[field]);
    }

    var enigmaSupp = getSupp('enigma');
    if (enigmaSupp && shouldUseSupp('enigmas')) {
      var synth = _ar_synthEnigmasFromSupp(enigmaSupp);
      if (synth) merged.enigmas = synth;
    }

    var decorSupp = getSupp('decor');
    if (decorSupp && shouldUseSupp('decorations')) {
      var synthD = _ar_synthDecorationsFromSupp(decorSupp);
      if (synthD) merged.decorations = synthD;
    }

    var skinSupp = getSupp('skin');
    if (skinSupp && shouldUseSupp('skins')) {
      var synthS = _ar_synthSkinsFromSupp(skinSupp);
      if (synthS) merged.skins = synthS;
    }

    // Phase 4 needs merged.heroes populated so the overview cards and the
    // Heroes / Gear tabs render even when the user has no battle reports.
    // The heroes supplement gives us per-hero level/star/quality/skills;
    // the gear supplement (when present) gives us the equipped pieces,
    // which we attach as `heroEquips` keyed by heroId — mirroring the
    // battle-report shape that downstream consumers already expect.
    if (shouldUseSupp('heroes')) {
      var heroesSupp = getSupp('heroes');
      if (heroesSupp) {
        var gearSupp = getSupp('gear');
        var synthH = _ar_synthHeroesFromSupp(heroesSupp, gearSupp);
        if (synthH && synthH.length) merged.heroes = synthH;
      }
    }

    // Awakening is account-level LIVE truth. A battle report only carries
    // awakenLevel when the hero was actually deployed in that battle, so a
    // player's own awakened heroes routinely arrive with awakenLevel:0 from
    // reports. The bookmarklet snapshot always knows the real awakening
    // state, so overlay it onto merged.heroes here (matched by hero id),
    // regardless of how merged.heroes was built. This keeps the Overview +
    // Combat Heroes cards (which read merged.heroes / _awakenedHeroIds) in
    // sync with the Bench (which already reads the supplement's aw/aws/fa).
    // Awakening only ever increases, so Auto + Bookmarklet let the supplement
    // win; an explicit 'reports' pin only gap-fills missing/zero values.
    if (Array.isArray(merged.heroes)) {
      var awSupp = getSupp('heroes');
      if (awSupp && Array.isArray(awSupp.list)) {
        var awById = {};
        awSupp.list.forEach(function (h) { if (h && h.id != null) awById[h.id] = h; });
        var awWins = (pri !== 'reports');
        merged.heroes.forEach(function (mh) {
          var s = mh && awById[mh.id];
          if (!s || !((s.aw || 0) > 0)) return;
          if (awWins || !((mh.awakenLevel || 0) > 0)) {
            mh.awakenLevel = s.aw;
            mh.fullAwaken = !!s.fa;
            if (s.aws) mh.aws = s.aws;
          }
        });
      }
    }
  }
  function resolveAvatar(url) {
    if (!url) return null;
    if (url.indexOf('http') === 0) return url;
    return 'https://h5.topwargame.com/DynRes/images/headpic/' + url + '.png?t=21.jpg';
  }
  function getAvatar(pi) {
    return resolveAvatar(pi.headimgurl_custom) || resolveAvatar(pi.avatarurl) || null;
  }
  function extractPlayerData(data, playerName) {
    var battle = data.battle;
    if (!battle) return null;

    var sides = [
      { key: 'attacker', data: battle.attacker },
      { key: 'defender', data: battle.defender }
    ];
    var matchedSide = null;
    var matchedPlayerIdx = 0;

    for (var s = 0; s < sides.length; s++) {
      var players = (sides[s].data && sides[s].data.players) || [];
      for (var p = 0; p < players.length; p++) {
        try {
          var pi = JSON.parse(players[p].playerInfo || '{}');
          if (pi.username === playerName || (pi.username || '').trim() === (playerName || '').trim()) {
            matchedSide = sides[s];
            matchedPlayerIdx = p;
            break;
          }
        } catch(e) {}
      }
      if (matchedSide) break;
    }

    if (!matchedSide) return null;

    var player0 = matchedSide.data.players[matchedPlayerIdx];

    return {
      // Report timestamp (Unix seconds) — used to chrono-sort reports during
      // merging so the "latest report wins" rule for account-level snapshots
      // (decorations / skins / enigmas / ctcs / formations / armyMastery /
      // elementLevels) actually picks the most-recent battle rather than
      // assuming report-id length is monotonic with time.
      logtime: data.logtime || 0,
      playerInfo: JSON.parse(player0.playerInfo || '{}'),
      heroes: (player0.heroList || []).map(function(h) {
        return {
          id: h.id, heroEquips: h.heroEquips || [],
          skills: h.skills || [], nonActiveSkills: h.nonActiveSkills || [],
          star: h.star || 0, level: h.level || 0,
          awakenLevel: h.awakenLevel || 0, fullAwaken: !!h.fullAwaken
        };
      }),
      decorations: player0.effectDecorations || null,
      skins: player0.effectSkins || null,
      enigmas: player0.enigmas || null,
      // mechas is on the side level, not per-player
      mechas: (matchedSide.data.mechas || []).map(function(m) {
        return { mechaId: m.mechaId, chips: m.chips || [] };
      }),
      ctcs: player0.CTCs || null,
      effectBuffs: player0.effectBuffs || null,
      traceEffectBuffs: player0.traceEffectBuffs || null,
      // Formation V2 — only the marching formation is exposed per battle report.
      // Across multiple reports the player will eventually march each of their 3 formations
      // so consumers should accumulate by formation id.
      formationV2: player0.formationV2 || null,
      armyMastery: player0.armyMastery || null,
      elementLevels: player0.elementLevels || null,
      career: player0.career || null
    };
  }

  /* ---- NOT copied: glue the page does inline in its init / loader code ---- */
  // The synth helpers and the merge live in ArmoryCore (phase 1); the copied code above calls them by these names.
  var _ar_synthDecorationsFromSupp = core._ar_synthDecorationsFromSupp;
  var _ar_synthSkinsFromSupp = core._ar_synthSkinsFromSupp;
  var mergeReportData = core.mergeReportData;
  core.setIdentity(ArmoryIdentity);

  // The static data files all go through fetchJson (one promise cache). Each loader feeds ArmoryCore's setters, the
  // way the page's _ar_decorFetch / loadHeroData / boLoadOptimizerData do (parity-tested in armory-core.parity.test.js).
  var _heroP = null, _decorP = null, _platP = null;
  function ensureHeroes() { // page: loadHeroData
    if (!_heroP) {
      _heroP = fetchJson('data/all-heroes.json')
        .then(function(data) {
          var names = {}, types = {};
          data.forEach(function(h) {
            names[h.heroId] = h.displayName || h.name || ('Hero #' + h.heroId);
            types[h.heroId] = h.typeName || 'Unknown';
          });
          core.setHeroCache(names, types);
        })
        .catch(function() { core.setHeroCache({}, {}); });
    }
    return _heroP;
  }
  function ensureDecor() { // page: _ar_decorEnsure
    if (!_decorP) {
      _decorP = fetchJson('data/decor-lookups.json').then(function(j) { core.setDecorLookups(j); return true; })
        .catch(function(e) { _decorP = null; throw e; });
    }
    return _decorP;
  }
  function ensurePlatforms() { // page: boLoadOptimizerData / ebLoadPlatformReqs (Beasts, phase 3)
    if (!_platP) {
      _platP = Promise.all([fetchJson('data/enigma-platforms.json'), fetchJson('data/enigma-platform-enhance.json'), fetchJson('data/enigma-field-conditions.json')])
        .then(function(a) { core.setPlatforms(a[0]); core.setEnhance(a[1]); core.setFieldConditions(a[2]); return true; })
        .catch(function(e) { _platP = null; throw e; });
    }
    return _platP;
  }
  // The data the Overview needs besides the report: rune catalog, decoration levels / index, item table.
  function loadStatic() {
    var out = { runeTypes: null, decorLevels: null, decorIndex: null, decorLookups: null, itemTable: null, errors: [] };
    function soft(name, p) { return p.then(function(v) { out[name] = v; }, function() { out.errors.push(name); }); }
    return Promise.all([
      soft('runeTypes', fetchJson('data/rune-types.json')),
      soft('decorLevels', fetchJson('data/decoration-levels.json')),
      soft('decorIndex', fetchJson('data/decoration-index.json')),
      soft('decorLookups', fetchJson('data/decor-lookups.json')),
      soft('itemTable', _ar_loadItemTable().then(function(l) { return l.item; })),
      ensureHeroes(),
      ensureDecor().catch(function() { out.errors.push('decorLookups'); })
    ]).then(function() { return out; });
  }

  // Who is this report for? Same decision as the page's ?code= path: siteKey equality when both sides have one,
  // otherwise a trimmed case-insensitive name compare; ambiguous means view-only (bug #107). `saved` is the stored
  // playerReport (or null).
  function codeIsOwn(result, saved) {
    var ownIdent = getStoredIdentity();
    var currentPlayer = (saved && saved.player && saved.player.name) || '';
    var currentSiteKey = (ownIdent && ownIdent.siteKey)
      || (saved && saved.player && saved.player.siteKey)
      || null;
    var resultSiteKey = result.siteKey || null;
    function _norm(s) { return String(s || '').trim().toLowerCase(); }
    if (currentSiteKey && resultSiteKey) return currentSiteKey === resultSiteKey;
    if (currentPlayer || (ownIdent && ownIdent.name)) return _norm(currentPlayer || (ownIdent && ownIdent.name)) === _norm(result.playerName);
    return false;
  }
  // Own-report check of the page's _ar_isOwnReport (it reads wizardState.player; here the player is a parameter).
  function isOwnReport(reportSiteKey, player) {
    var ident = getStoredIdentity();
    if (!ident) return false;
    if (ident.siteKey && reportSiteKey && ident.siteKey === reportSiteKey) return true;
    if (ident.name && player && player.name) {
      var a = String(ident.name).trim().toLowerCase();
      var b = String(player.name).trim().toLowerCase();
      if (a && a === b) return true;
    }
    return false;
  }
  function readSaved() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('playerReport')); } catch (e) {}
    return saved && saved.player && Array.isArray(saved.reportIds) && saved.reportIds.length ? saved : null;
  }

  // GET /report-config?code=. ok -> {ok, result}; the worker answers 404 {error:'not_found'} for a link that no longer
  // exists (the expired-link state) and 400 {error:'invalid_code'} for a malformed one; anything else is a failure to
  // reach it (network, 5xx, bad JSON), which is not "expired".
  function loadShortcodeConfig(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(code)) return Promise.resolve({ ok: false, reason: 'invalid_code' });
    return fetch(PUSH_WORKER + '/report-config?code=' + code).then(function(r) {
      return r.json().catch(function() { return null; }).then(function(j) {
        if (r.ok && j && j.ok && typeof j.reportIds === 'string') return { ok: true, result: j, code: code };
        if (r.status === 404 || (j && j.error === 'not_found')) return { ok: false, reason: 'not_found' };
        if (r.status === 400 || (j && j.error === 'invalid_code')) return { ok: false, reason: 'invalid_code' };
        return { ok: false, reason: 'unavailable', status: r.status };
      });
    }, function() { return { ok: false, reason: 'unavailable', status: 0 }; });
  }

  // UID check for the Status sheet's step 1 (page: the Unlock modal's submit handler, same attempts and same order).
  // The raw UID goes to the handshake request body only. Resolves {ok, handshake, reason?}.
  // v1 Unlock modal: a hash that is not this report's player but IS a roster player means the stored identity is stale;
  // rewrite playerIdentity to that roster player and unlock under the real siteKey.
  function healFromRoster(attempts) {
    return _ar_getRosterMap().then(function(map) {
      return attempts.filter(Boolean).reduce(function(p, cand) {
        return p.then(function(found) {
          if (found) return found;
          return _ar_sha256Hex(cand).then(function(h) { var rp = map[h.slice(0, 16)]; return rp ? { uid: cand, p: rp } : null; });
        });
      }, Promise.resolve(null));
    }).then(function(f) {
      if (!f) return { ok: false, reason: 'mismatch' };
      try {
        var ident = ArmoryIdentity.get() || {};
        ident.name = f.p.name; ident.alliance = f.p.alliance; ident.rank = f.p.rank; ident.profession = f.p.profession; ident.siteKey = f.p.siteKey;
        ArmoryIdentity.set(ident);
      } catch (e) {}
      return _ar_handshake(f.uid).then(function() { return true; }, function() { return false; }).then(function(hs) {
        _ar_storeUid(f.p.siteKey, f.uid); _ar_setUnlocked(f.p.siteKey, true);
        return { ok: true, handshake: hs, healed: true, siteKey: f.p.siteKey, name: f.p.name };
      });
    }, function() { return { ok: false, reason: 'mismatch' }; });
  }
  function verifyUid(siteKey, raw) {
    var attempts = [String(raw || '').trim(), String(raw || '').replace(/\D/g, '')];
    var matched = null;
    return attempts.reduce(function(p, candidate) {
      return p.then(function() {
        if (matched || !candidate) return null;
        return _ar_sha256Hex(candidate).then(function(h) { if (h.slice(0, 16) === siteKey) matched = candidate; });
      });
    }, Promise.resolve()).then(function() {
      if (!matched) return healFromRoster(attempts);
      return _ar_handshake(matched).then(function() { return true; }, function() { return false; }).then(function(hs) {
        _ar_storeUid(siteKey, matched);
        _ar_setUnlocked(siteKey, true);
        return { ok: true, handshake: hs };
      });
    });
  }

  // loadArmory({code}) | loadArmory({saved:true}) | loadArmory({reportIds, player:{name, siteKey?}, own?}).
  // Resolves { state, merged, sources:{reportsTs, dataTs, kinds}, identity, readOnly, errors, player, reports, ... }.
  //   state: 'ready' | 'none' (nothing to load) | 'expired' (share code gone or malformed) | 'error' (could not reach
  //   the worker for a code) | 'empty' (reports loaded but none usable).
  // It never writes the saved report (playerReport): that stays the importer's job. It does refresh the per-id
  // extract cache (playerReportData) for the saved player's own report, like the page, and archives a fresh report
  // through /collect-report like the page. `errors` lists what was skipped: {kind, id?, status?, name?}.
  function loadArmory(arg) {
    arg = arg || {};
    var out = {
      state: 'ready', merged: null, sources: { reportsTs: 0, dataTs: 0, kinds: [] },
      identity: null, readOnly: true, errors: [], player: null, reports: [], code: null,
      marchGroups: null, setupBy: null, privacy: {}, supp: {}, roster: null, statics: null
    };
    var saved = readSaved();
    var player = null, ids = [], useCache = false;
    var stage;
    if (arg.code != null) {
      stage = loadShortcodeConfig(arg.code).then(function(c) {
        if (!c.ok) {
          out.state = c.reason === 'unavailable' ? 'error' : 'expired';
          out.errors.push({ kind: c.reason, status: c.status });
          return false;
        }
        var res = c.result;
        out.code = c.code;
        ids = res.reportIds.split(',').filter(Boolean);
        player = { name: res.playerName, siteKey: res.siteKey || null };
        out.readOnly = !codeIsOwn(res, saved);
        out.marchGroups = Array.isArray(res.marchGroups) ? res.marchGroups : null;
        out.setupBy = res.createdByAdvisor || null;
        return true;
      });
    } else if (arg.dataOnly) {
      // A player with game data and no battle report: only the own siteKey is trusted here (identity or roster).
      var own0 = getStoredIdentity();
      var k0 = (arg.player && arg.player.siteKey) || (own0 && own0.siteKey) || null;
      if (!/^[0-9a-f]{16}$/.test(String(k0 || ''))) { out.state = 'none'; return Promise.resolve(out); }
      ids = [];
      player = { name: (arg.player && arg.player.name) || (own0 && own0.name) || null, siteKey: k0 };
      out.readOnly = !(own0 && own0.siteKey === k0);
      stage = Promise.resolve(true);
    } else if (arg.reportIds) {
      ids = arg.reportIds.slice();
      player = { name: arg.player && arg.player.name, siteKey: (arg.player && arg.player.siteKey) || null };
      out.readOnly = !arg.own;
      stage = Promise.resolve(true);
    } else {
      if (!saved) { out.state = 'none'; return Promise.resolve(out); }
      ids = saved.reportIds.slice();
      player = { name: saved.player.name, siteKey: saved.player.siteKey || null, avatar: saved.player.avatar || null };
      out.readOnly = !!saved._viewOnly;
      // v1 initFromSaved: when the saved player is the signed-in one, drop a stale _viewOnly and take the identity's
      // siteKey (siteKey decides when both sides have one, else a trimmed name compare), then keep the corrected record.
      var oid = getStoredIdentity();
      if (oid && saved.player) {
        var nrm = function(x) { return String(x || '').trim().toLowerCase(); };
        var mine = oid.siteKey && saved.player.siteKey ? oid.siteKey === saved.player.siteKey
          : !!(oid.name && saved.player.name && nrm(oid.name) === nrm(saved.player.name));
        if (mine) {
          var healed = false;
          if (saved._viewOnly) { saved._viewOnly = false; out.readOnly = false; healed = true; }
          if (oid.siteKey && saved.player.siteKey !== oid.siteKey) { saved.player.siteKey = oid.siteKey; player.siteKey = oid.siteKey; healed = true; }
          if (healed) { try { localStorage.setItem('playerReport', JSON.stringify(saved)); } catch (e) {} }
        }
      }
      out.marchGroups = Array.isArray(saved.marchGroups) ? saved.marchGroups : null;
      useCache = true;
      stage = Promise.resolve(true);
    }
    return stage.then(function(go) {
      if (!go) { out.identity = identityOf(null); return out; }
      ids = ids.filter(_ar_validReportId);
      out.player = player;
      var cache = {};
      if (useCache) { try { cache = JSON.parse(localStorage.getItem('playerReportData')) || {}; } catch (e) { cache = {}; } }
      return Promise.all([
        loadStatic().then(function(s) { out.statics = s; s.errors.forEach(function(n) { out.errors.push({ kind: 'static', name: n }); }); }),
        _ar_getRosterMap().then(function(m) { out.roster = m; }, function() { out.errors.push({ kind: 'roster' }); }),
        Promise.all(ids.map(function(id) { return loadOneReport(id, player, cache, out); }))
      ]).then(function(parts) {
        var results = parts[2].filter(Boolean);
        out.reports = results;
        if (!results.length && !arg.dataOnly) { out.state = 'empty'; out.identity = identityOf(player); return out; }
        if (!player.siteKey && player.name) {
          var rm = _ar_rosterByName && _ar_rosterByName[String(player.name).toLowerCase()];
          if (rm && rm.siteKey) player.siteKey = rm.siteKey;
        }
        if (!player.avatar && results.length) player.avatar = getAvatar(results[0].extracted.playerInfo || {});
        var rosterEntry = player.siteKey && _ar_rosterMap ? _ar_rosterMap[player.siteKey] || null : null;
        out.rosterEntry = rosterEntry;
        var hydrate = player.siteKey && !arg.noHydrate ? _ar_hydrateSupplementsFromWorker(player.siteKey).catch(function() { return []; }) : Promise.resolve([]);
        return hydrate.then(function(changed) {
          out.changedKinds = changed;
          var merged = mergeReportData(results);
          out.reportMechaIds = (merged.mechas || []).map(function(m) { return m.mechaId; });
          if (player.siteKey) {
            core.setIdentity(ArmoryIdentity);
            try { _ar_applySupplementsToMerged(merged, player.siteKey); } catch (e) { out.errors.push({ kind: 'merge' }); }
            if (window._enigmaSuppDecode) G.setSuppDecode(window._enigmaSuppDecode);
          }
          out.merged = merged;
          results.forEach(function(r) { var t = r.extracted.logtime ? r.extracted.logtime * 1000 : 0; if (t > out.sources.reportsTs) out.sources.reportsTs = t; });
          if (player.siteKey) {
            out.sources.dataTs = _ar_lastSnapshotTs(player.siteKey);
            out.sources.kinds = ArmoryIdentity.KINDS.concat(['enigma', 'decor', 'skin']).filter(function(k, i, a) { return a.indexOf(k) === i; })
              .filter(function(k) { var s = null; try { s = ArmoryIdentity.getSupplement(k, player.siteKey); } catch (e) {} return !!s; });
            out.privacy = JSON.parse(JSON.stringify(_ar_supplementPrivacy[player.siteKey] || {}));
            out.sources.kinds.forEach(function(k) { out.supp[k] = ArmoryIdentity.getSupplement(k, player.siteKey); });
          }
          out.identity = identityOf(player);
          if (arg.dataOnly && !out.sources.kinds.length) out.state = 'none';
          if (useCache && !out.readOnly) {
            var nc = {}; results.forEach(function(r) { nc[r.id] = r.extracted; });
            try { localStorage.setItem('playerReportData', JSON.stringify(nc)); } catch (e) {}
          }
          return out;
        });
      });
    });
  }
  function identityOf(player) {
    var ident = getStoredIdentity();
    var sk = player && player.siteKey || null;
    return {
      ident: ident, siteKey: ident && ident.siteKey || null, name: ident && ident.name || null,
      isOwn: !!(player && isOwnReport(sk, player)),
      unlocked: !!(sk && _ar_isUnlocked(sk)),
      hasUid: !!(sk && _ar_getStoredUid(sk))
    };
  }
  // One report: the saved extract when the cache has it, else the CDN (global host, then CN), parsed with the page's
  // extractPlayerData. A report that fails or does not contain the player is recorded in out.errors and skipped.
  function loadOneReport(id, player, cache, out) {
    if (cache[id]) return Promise.resolve({ id: id, extracted: cache[id] });
    return fetchReportResponse(id).then(function(r) {
      if (!r || !r.ok) { out.errors.push({ kind: 'report', id: id, status: r ? r.status : 0 }); return null; }
      return r.json().then(function(data) {
        if (!data || !data.battle) { out.errors.push({ kind: 'report', id: id, status: 200, why: 'no_battle' }); return null; }
        try { fetch(PUSH_WORKER + '/collect-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) }).catch(function() {}); } catch (e) {}
        var extracted = extractPlayerData(data, player.name);
        if (!extracted) { out.errors.push({ kind: 'player_not_in_report', id: id }); return null; }
        return { id: id, extracted: extracted };
      });
    }).catch(function() { out.errors.push({ kind: 'report', id: id, status: 0 }); return null; });
  }

  return {
    loadArmory: loadArmory, loadShortcodeConfig: loadShortcodeConfig, verifyUid: verifyUid, loadStatic: loadStatic,
    ensureHeroes: ensureHeroes, ensureDecor: ensureDecor, ensurePlatforms: ensurePlatforms,
    core: core, identity: ArmoryIdentity, getStoredIdentity: getStoredIdentity, isOwnReport: isOwnReport, codeIsOwn: codeIsOwn,
    handshake: _ar_handshake, ensureToken: _ar_ensureSupplementToken,
    token: function () { return _ar_supplementToken; }, tokenExpires: function () { return _ar_supplementTokenExpires; },
    storeUid: _ar_storeUid, getStoredUid: _ar_getStoredUid, isUnlocked: _ar_isUnlocked, setUnlocked: _ar_setUnlocked,
    fetchSupplement: _ar_fetchSupplement, hydrateSupplements: _ar_hydrateSupplementsFromWorker,
    isSupplementPrivate: _ar_isSupplementPrivate, applySupplementsToMerged: _ar_applySupplementsToMerged,
    getRosterMap: _ar_getRosterMap, fetchJson: fetchJson, fetchReportResponse: fetchReportResponse,
    validReportId: _ar_validReportId, extractPlayerData: extractPlayerData,
    loadItemTable: _ar_loadItemTable, loadInvLookups: _ar_loadInvLookups, lastSnapshotTs: _ar_lastSnapshotTs,
    sourcePriority: _ar_getSourcePriority, plainError: _ar_plainError,
    clearedTsFrom: _ar_clearedTsFrom, shouldDropForClear: _ar_shouldDropForClear, supTsMs: _ar_supTsMs,
    suppDecode: function () { return window._enigmaSuppDecode || null; }
  };
  }
  var fetchGlobal = typeof fetch === 'function' ? fetch.bind(ROOT) : null;
  var api = { create: create };
  window.ArmoryData = api;
  if (isNode) module.exports = api;
})(typeof window !== 'undefined' ? window : {});
