'use strict';
// The three hand-written exclusive-skill maps must cover every hero the game's hero table gives an exclusive skill
// (data/all-heroes.json), with the same skill id. Seven heroes added to the table on 2026-05-26 (Nova, Tannis, Ella,
// Lophy, Sinope, Margaretha, Franziska) never reached the maps, so the battle report showed no "Excl. Lv." label for
// Lophy and Ella (report 4862302168869658625, 2026-10-09).
// Run: node --test test/excl-skill-maps.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TABLE = JSON.parse(read('data/all-heroes.json'));
const TRUTH = new Map(TABLE.filter((h) => h.exclusiveSkill).map((h) => [h.heroId, h.exclusiveSkill]));

function mapIn(file, name, entry) {
  const m = read(file).match(new RegExp('var ' + name + '\\s*=\\s*(\\{.*?\\});'));
  assert.ok(m, name + ' not found in ' + file);
  const out = new Map();
  for (const x of m[1].matchAll(entry)) out.set(Number(x[1]), { id: Number(x[2]), n: x[3] });
  return out;
}
const RICH = /(\d+):\{id:(\d+),n:"([^"]*)"\}/g, IDS = /(\d+):(\d+)()/g;
const MAPS = [
  ['pages/battle-report.html', 'EXCL_SKILL', RICH],
  ['pages/report-render.js', 'EXCL_SKILL', RICH],
  ['pages/armory-report.html', 'EXCL_SKILL_ID', IDS]
];

test('the hero table is the one we expect: 121 heroes with an exclusive skill, Lophy and Ella among them', () => {
  assert.equal(TRUTH.size, 121);
  assert.equal(TRUTH.get(239).id, 20760);
  assert.equal(TRUTH.get(174).id, 20764);
});

for (const [file, name, entry] of MAPS) {
  // Skill ids must match the table; display names are hand-picked (the table holds raw strings for a few heroes,
  // e.g. 123 "skill_name20642"), so a name only has to be there.
  test(file + ': every hero with an exclusive skill is in ' + name + ', with the table\'s skill id', () => {
    const map = mapIn(file, name, entry);
    const missing = [...TRUTH.keys()].filter((id) => !map.has(id)).map((id) => id + ' ' + TRUTH.get(id).name);
    assert.deepEqual(missing, [], 'missing from ' + name);
    for (const [heroId, x] of map) {
      const t = TRUTH.get(heroId);
      assert.ok(t, 'hero ' + heroId + ' is not in the table');
      assert.equal(x.id, t.id, 'hero ' + heroId + ' skill id');
      if (entry === RICH) assert.ok(x.n.trim(), 'hero ' + heroId + ' has a skill name');
    }
  });
}
