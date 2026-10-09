'use strict';
// A synthetic world for the armory data/view-model tests: a stub fetch that routes by URL (static data comes from the
// repo's public data/*.json game tables), an in-memory localStorage, and one invented player ("Tester") with one battle
// report. No real player, no UID that belongs to anyone (UID_RAW is an invented 12-digit number whose hash defines SK).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('./armory-page.js');

const UID_RAW = '123456789012';
const SK = crypto.createHash('sha256').update(UID_RAW).digest('hex').slice(0, 16);
const NAME = 'Tester';
const REPORT_ID = '1234567890123456789';
const WORKER = 'https://push-worker.27tb8s6fct.workers.dev';
const CDN = 'https://fight-report-va.oss-accelerate.aliyuncs.com/prod/';
const CDN_CN = 'https://fight-report.oss-accelerate.aliyuncs.com/prod/';
const reportUrl = (base, id) => base + id.substring(0, 4) + '/' + id + '.json';

function memStorage(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => Object.assign({}, m),
  };
}

function res(status, body, headers) {
  const h = {};
  Object.keys(headers || {}).forEach((k) => { h[k.toLowerCase()] = headers[k]; });
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (n) => (h[String(n).toLowerCase()] != null ? h[String(n).toLowerCase()] : null) },
    json: async () => { if (body === undefined) throw new Error('no json'); return JSON.parse(JSON.stringify(body)); },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// handler(url, opts, calls) -> {status, body, headers} | undefined (404) | a thrown error (network failure)
function makeFetch(handler) {
  const calls = [];
  const f = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    try {
      const r = handler(String(url), opts || {}, calls);
      if (r instanceof Promise) return r.then((x) => (x ? res(x.status, x.body, x.headers) : res(404, { error: 'not_found' })));
      return Promise.resolve(r ? res(r.status, r.body, r.headers) : res(404, { error: 'not_found' }));
    } catch (e) { return Promise.reject(e); }
  };
  f.calls = calls;
  return f;
}

const dataFile = (p) => JSON.parse(fs.readFileSync(path.join(P.ROOT, p), 'utf8'));
const STATIC = {};
function staticRoute(url) { // data/<file>.json and player-data.json from the repo's own public files
  const m = /^(data\/[a-z0-9-]+\.json)$/.exec(url);
  if (!m) return null;
  if (!STATIC[m[1]]) STATIC[m[1]] = dataFile(m[1]);
  return { status: 200, body: STATIC[m[1]] };
}

const gearHeroes = () => P.fixture('gear-heroes.json').heroes;
const decorMerged = () => P.fixture('decor.json').merged.decorations;

function battleReport(over) {
  over = over || {};
  const heroes = gearHeroes().slice(0, 3);
  return {
    logtime: over.logtime || 1779000000,
    battle: {
      attacker: {
        players: [{
          playerInfo: JSON.stringify({ username: over.name || NAME, avatarurl: 'hero_icon116_global' }),
          heroList: heroes.map((h) => ({ id: h.id, heroEquips: h.heroEquips, star: 5, level: 100 })),
          effectDecorations: { ids: decorMerged().ids.slice(0, 40), suit: [], suitLevelBuff: {} },
          enigmas: null, CTCs: null,
        }],
        mechas: over.mechas || [{ mechaId: 1006, chips: [{ chipId: 9404, level: 6 }, { chipId: 8501, level: 25 }] }],
      },
      defender: { players: [{ playerInfo: JSON.stringify({ username: 'Opponent' }), heroList: [] }] },
    },
  };
}

module.exports = { UID_RAW, SK, NAME, REPORT_ID, WORKER, CDN, CDN_CN, reportUrl, memStorage, res, makeFetch, staticRoute, battleReport, gearHeroes, decorMerged, dataFile };
