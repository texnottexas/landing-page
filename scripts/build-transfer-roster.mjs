// One-shot: build data/transfer-roster-1805.json from the two 1805 alliance
// extractions (which contain UIDs). UIDs are STRIPPED; siteKey = sha256(uid) hex,
// which matches push-worker's sha256Hex(uid) so the same player maps to the same key.
// Run from the landing-page dir:  node scripts/build-transfer-roster.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const INPUTS = [
  new URL('../../docs/cross-server-alliances/1805-whiskey.json', import.meta.url),
  new URL('../../docs/cross-server-alliances/1805-foxtrot.json', import.meta.url),
];
const OUT = new URL('../data/transfer-roster-1805.json', import.meta.url);
const SERVER = '1805';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const bySiteKey = new Map();
for (const url of INPUTS) {
  const d = JSON.parse(readFileSync(url, 'utf8'));
  for (const m of (d.members || [])) {
    if (!m.uid || !m.name) continue;
    const siteKey = sha(m.uid);
    if (bySiteKey.has(siteKey)) continue; // a player in both alliances counts once
    bySiteKey.set(siteKey, {
      siteKey,
      name: String(m.name),
      server: SERVER,
      cp: Number.isFinite(m.power) ? Math.round(m.power) : null,
      profession: m.profession || 'Unknown',
      // Keep only loadable CDN URLs; in-game icon refs can't render on the site.
      avatar: (typeof m.avatarurl === 'string' && /^https?:\/\//.test(m.avatarurl)) ? m.avatarurl : '',
    });
  }
}
const rows = Array.from(bySiteKey.values()).sort((a, b) => (b.cp || 0) - (a.cp || 0));

// Fail loud rather than ship a bad or privacy-leaking file.
const badKeys = rows.filter(r => !/^[0-9a-f]{64}$/.test(r.siteKey));
if (badKeys.length) { console.error('ERROR: bad siteKeys:', badKeys.length); process.exit(1); }
if (/"uid"/.test(JSON.stringify(rows))) { console.error('ERROR: uid leaked into output'); process.exit(1); }

writeFileSync(OUT, JSON.stringify(rows));
console.log('wrote', rows.length, 'rows');
