'use strict';
// A deterministic, invented Enigma Beast roster for the optimizer tests (no player data): `n` beasts with valid config ids and buff ids,
// every platform hole of the five fields (data/enigma-platforms.json), some holes empty, the rest filled with the first beasts.
// Returns { enigmas (the merged.enigmas shape), bench (the bench supplement shape), holes }.
const P = require('./armory-page.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const MAIN = [520000, 520010, 520011, 520012, 520013, 520020, 520021, 520022, 520023, 520030, 520031, 520032, 520033, 520040, 520041, 520050, 520060, 520070, 520100, 520110, 520120, 520130, 520140];
const BASE = [520010, 520011, 520020, 520021, 520030, 520040, 520050, 520100, 520110, 520112, 520120, 520130, 520140, 520141, 520142];

function synth(seed, n, opts) {
  opts = opts || {};
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  const platforms = P.data('enigma-platforms.json');
  const beasts = [];
  for (let i = 0; i < n; i++) {
    const lynx = r() < 0.08, type = lynx ? 5 : 1 + Math.floor(r() * 9), fac = 1 + Math.floor(r() * 4), q5 = r() < 0.7;
    const cfg = lynx ? 80 + fac : (type - 1) * 20 + fac * 5 - (q5 ? 0 : 1);
    const q = lynx ? 5 : (q5 ? 5 : 4), maxSt = q === 5 ? 5 : 4;
    beasts.push({
      id: String(9000 + i), cfg, type: lynx ? 5 : type, fac, q, st: 1 + Math.floor(r() * maxSt), lv: Math.floor(r() * (q === 5 ? 100 : 80)),
      pot: Math.floor(r() * (q === 5 ? 16000 : 8000)), mb: pick(MAIN), bb: [pick(BASE), pick(BASE), pick(BASE)].filter((x, k, a) => a.indexOf(x) === k)
    });
  }
  const holes = platforms.holes.slice();
  const fields = [1, 2, 3, 4, 5].map((ft) => {
    const hs = holes.filter((h) => h.fieldType === ft).sort((a, b) => a.order - b.order);
    return { cfg: ft, active: true, slots: hs.map((h) => ({ id: h.id, beastId: '0', level: h.order % 7, potential: 0, buffs: [] })) };
  });
  // deployed: fill the slots in order with the first beasts, leaving every 7th hole empty
  let b = 0;
  fields.forEach((f) => f.slots.forEach((s, i) => { if ((opts.empty || 7) && (i + f.cfg) % (opts.empty || 7) === 0) return; if (b < beasts.length && b < (opts.deploy == null ? 99 : opts.deploy)) s.beastId = beasts[b++].id; }));
  const deployed = new Set(); fields.forEach((f) => f.slots.forEach((s) => { if (s.beastId !== '0') deployed.add(s.beastId); }));
  const toData = (x) => ({ id: x.id, cfg: x.cfg, star: x.st, level: x.lv, potential: x.pot, power: x.pot * 3, mainBuff: x.mb, baseBuff: x.bb.slice() });
  return {
    enigmas: { beastDatas: beasts.filter((x) => deployed.has(x.id)).map(toData), fields },
    bench: { beasts: beasts.filter((x) => !deployed.has(x.id)).map((x) => ({ id: x.id, cfgId: x.cfg, type: x.type, fac: x.fac, q: x.q, lv: x.lv, st: x.st, pot: x.pot, mb: x.mb, bb: x.bb.slice() })) },
    suppDecode: beasts.reduce((m, x) => { m[x.cfg] = { type: x.type, faction: x.fac, quality: x.q }; return m; }, {})
  };
}
module.exports = { synth };
