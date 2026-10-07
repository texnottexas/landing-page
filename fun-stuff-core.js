// fun-stuff-core.js — Fun Stuff pure rules: the emoji catalog, which chat a send goes to, the 3 s gap and the
// Recent list. No DOM, no game access.
// window.FunStuffCore in the browser, module.exports for node tests.
(function (root) {
  'use strict';
  var GAP_MS = 3000, RECENT_MAX = 16, GIF_LEVEL = 20;
  // Catalog paths go straight into <img src>, so only these shapes are accepted.
  var FILE = { 'static': /^static\/\d+\.png$/, gif: /^gif\/\d+\.gif$/ };
  var THUMB = /^gif-thumb\/\d+\.png$/, PACK_ICON = /^(packs|static)\/\d+\.png$/;

  function posInt(v) { return typeof v === 'number' && v > 0 && v % 1 === 0; }
  function text(v) { return typeof v === 'string' ? v.slice(0, 60) : ''; }

  // {version, packs:[{id,name,icon}], emojis:[{id,kind,pack,name,file,thumb?}]}; bad rows dropped, null for junk.
  function parseCatalog(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.packs) || !Array.isArray(raw.emojis)) return null;
    var packs = raw.packs.filter(function (p) {
      return p && posInt(p.id) && typeof p.icon === 'string' && PACK_ICON.test(p.icon);
    }).map(function (p) { return { id: p.id, name: text(p.name) || 'Pack ' + p.id, icon: p.icon }; });
    var emojis = raw.emojis.filter(function (e) {
      return e && posInt(e.id) && FILE[e.kind] && typeof e.file === 'string' && FILE[e.kind].test(e.file);
    }).map(function (e) {
      var o = { id: e.id, kind: e.kind, pack: e.kind === 'gif' ? 'gif' : e.pack, name: text(e.name), file: e.file };
      if (e.kind === 'gif' && typeof e.thumb === 'string' && THUMB.test(e.thumb)) o.thumb = e.thumb;
      return o;
    });
    return { version: text(raw.version), packs: packs, emojis: emojis };
  }

  function emojiKey(e) { return e.kind + ':' + e.id; }

  // The open chat (newChatController NowChoiceKey): private with another player, alliance, else world.
  function target(key, myUid) {
    var world = { channel: 0, uid: '', name: '', label: 'World' };
    if (!key) return world;
    if (key._channel === 2) return { channel: 2, uid: '', name: '', label: 'Alliance' };
    if (key._channel === 1 && key._id != null && key._id !== '' && String(key._id) !== String(myUid)) {
      var name = key._name ? String(key._name) : '';
      return { channel: 1, uid: String(key._id), name: name, label: name || 'Private chat' };
    }
    return world;
  }

  function cooldown(lastAt, now) {
    var wait = lastAt ? lastAt + GAP_MS - now : 0;
    return wait > 0 ? { ok: false, waitMs: wait } : { ok: true, waitMs: 0 };
  }

  function iconUrl(base, e) { return String(base).replace(/\/+$/, '') + '/' + (e.thumb || e.file); }

  function recent(list, key) {
    return [key].concat((list || []).filter(function (k) { return k !== key; })).slice(0, RECENT_MAX);
  }

  function gifLocked(level, min) { return !(level >= (min || GIF_LEVEL)); }

  var FunStuffCore = {
    GAP_MS: GAP_MS, RECENT_MAX: RECENT_MAX, GIF_LEVEL: GIF_LEVEL,
    parseCatalog: parseCatalog, emojiKey: emojiKey, target: target, cooldown: cooldown, iconUrl: iconUrl, recent: recent, gifLocked: gifLocked
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FunStuffCore;
  else root.FunStuffCore = FunStuffCore;
})(typeof window !== 'undefined' ? window : globalThis);
