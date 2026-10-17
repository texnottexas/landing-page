'use strict';
// The real tool list and its deployment: every tool valid, every script shipped, gates as agreed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OC = require('../ops-core.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const raw = JSON.parse(read('ops-tools.json'));
const list = OC.validateTools(raw);
const cpLine = read('.github/workflows/pages.yml').split('\n').find((l) => l.includes('all-bookmarklet.js') && l.includes('_site/'));

test('every tool in ops-tools.json passes validation', () => {
  assert.equal(list.tools.length, raw.tools.length);
  assert.deepEqual(list.tools.map((t) => t.title), [
    'Snapshot', 'Skill Dismantle', 'Treasure Guard Merge', 'Alliance Defense Skipper', 'Class Talent Reset (EL)', 'TC Squad Sync', 'Troop Optimizer', 'Map Collector', 'Mask Mystery Boxes', 'Emoji Sender', 'Angel Attacks', 'Refugee Camps', 'HT Gift Boxes', 'Enigma Veins', 'Odinium Gatherer', 'Looter Locator', 'Unattended mode', 'Rickroll'
  ]);
  const ads = list.tools.find((t) => t.id === 'alliance-defense');
  assert.deepEqual(ads.ready, ['game'], 'no defender panel needed: it reads the event state itself');
  assert.equal(ads.overlay, '#ads-root');
  const fun = list.tools.find((t) => t.id === 'fun-stuff');
  assert.equal(fun.gate, 'member', 'any member can launch Emoji Sender');
  assert.equal(fun.title, 'Emoji Sender', 'renamed from Fun Stuff (Tex, 2026-10-09)');
  assert.equal(fun.desc, 'Send any chat emoji, locked packs and animated ones too, to the chat you have open.');
  assert.equal(fun.overlay, '#fun-root');
  assert.equal(fun.icon, 'smile');
  assert.deepEqual(fun.scripts, ['ops-drag.js', 'fun-stuff-core.js', 'fun-stuff.js']);
  const mbx = list.tools.find((t) => t.id === 'mask-boxes');
  assert.equal(mbx.gate, 'member', 'any member can launch Mask Mystery Boxes');
  assert.equal(mbx.overlay, '#mbx-root');
  assert.equal(mbx.icon, 'gift');
  const mc = list.tools.find((t) => t.id === 'map-collector');
  assert.equal(raw.tools.find((t) => t.id === 'map-collector').owners, undefined, 'Map Collector is gated by its own password, not an owners list');
  assert.equal(mc.ownerOnly, false, 'no public owners list');
  // Tex 2026-10-14: only players in the Map Collector registry see the tile; the worker answers, the list stays secret
  assert.equal(mc.registered, 'mapcollector');
  assert.deepEqual(OC.visibleTools([mc], 'd847a198622a518d').map((t) => t.id), [], 'hidden until the worker says yes');
  assert.deepEqual(OC.visibleTools([mc], 'd847a198622a518d', { mapcollector: true }).map((t) => t.id), ['map-collector']);
  assert.equal(list.tools.filter((t) => t.registered != null).map((t) => t.id).join(), 'map-collector,ops-unattended', 'only these two are limited to a registry');
  assert.equal(mc.overlay, '#mapc-root');
});

test('the public registry names no player: no siteKey from player-data.json appears in a tool entry', () => {
  const text = JSON.stringify(raw.tools);   // codeSha256 left out: dev test player Artu's siteKey is deliberately its prefix
  const roster = JSON.parse(read('player-data.json'));
  const players = Array.isArray(roster) ? roster : (roster.players || []);
  const keys = players.map((p) => p.siteKey).filter((k) => /^[0-9a-f]{16}$/.test(k || ''));
  assert.ok(keys.length > 100, 'read the roster siteKeys');
  keys.forEach((k) => assert.ok(!text.includes(k), 'siteKey ' + k + ' is not published in a tool entry'));
  assert.ok(!/"owners"/.test(text), 'no owners list in the public registry');
});

test('gates match today: only Class Talent Reset needs the code, the rest are for members (Troop Optimizer opened 2026-10-08)', () => {
  const code = list.tools.filter((t) => t.gate === 'code').map((t) => t.id).sort();
  assert.deepEqual(code, ['class-reset']);
  assert.equal(list.tools.find((t) => t.id === 'troop').gate, 'member');
  assert.match(read('pages/rickroll.html'), /Class Talent Reset asks for this page\\'s code once per device\./);
  const page = read('pages/rickroll.html');
  const m = page.match(/PASS_SHA256 = '([0-9a-f]{64})'/);
  assert.ok(m, 'rickroll.html publishes its code hash');
  assert.equal(list.codeSha256, m[1], 'same unlock code as rickroll.html');
});

test('every script exists in the repo and is deployed by pages.yml', () => {
  assert.ok(cpLine, 'found the root-files cp line in pages.yml');
  const shipped = new Set(cpLine.trim().split(/\s+/));
  list.tools.forEach((t) => t.scripts.forEach((s) => {
    assert.ok(fs.existsSync(path.join(ROOT, s)), s + ' exists');
    assert.ok(shipped.has(s), s + ' is copied to the site');
  }));
  ['ops-center.js', 'ops-core.js', 'ops-kit.js', 'ops-tools.json', 'ops-center.txt'].forEach((f) => assert.ok(shipped.has(f), f + ' is copied to the site'));
});

test('player-facing text has no em dashes', () => {
  list.tools.forEach((t) => {
    assert.ok(!/—/.test(t.title + t.desc), t.id);
  });
  ['ops-center.js', 'ops-kit.js', 'ops-core.js'].forEach((f) => {
    const strings = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/—/.test(strings), f + ' (outside comments)');
  });
});

test('the bookmarklet is the standard loader for ops-center.js', () => {
  assert.equal(read('ops-center.txt').trim(),
    "javascript:(function(){var s=document.createElement('script');s.src='https://2864tw.com/ops-center.js?_='+Date.now();s.onerror=function(){alert('Ops Center failed to load. Check your connection and try again.');};document.body.appendChild(s);})();");
});

test('rickroll.html lists the Ops Center first', () => {
  const page = read('pages/rickroll.html');
  const first = page.slice(page.indexOf('var TOOLS = ['));
  assert.match(first.slice(0, 400), /file: 'ops-center'/);
});

test('tools carry the names players know, on their own screens and on rickroll.html', () => {
  const page = read('pages/rickroll.html');
  assert.match(page, /title: 'Troop Optimizer'/);
  assert.match(page, /title: 'Treasure Guard Merge \(standalone\)'/);
  assert.ok(!/Troop Placement/.test(page), 'rickroll.html');
  assert.ok(!/'Troop Placement/.test(read('troop-bookmarklet.js')), 'troop tool header and pill');
  assert.ok(!/Hunting Guild \u2014 Bulk Merge/.test(read('merge-bookmarklet.js')), 'merge tool header');
  assert.match(read('merge-bookmarklet.js'), /'Treasure Guard Merge'/);
});

test('only Troop Optimizer handles the base itself', () => {
  const auto = list.tools.filter((t) => t.auto.length).map((t) => t.id + ':' + t.auto.join(','));
  assert.deepEqual(auto, ['troop:base']);
});

test('rickroll.html shows only the Ops Center; the other tools are kept but hidden (Tex, 2026-10-08)', () => {
  const page = read('pages/rickroll.html');
  const list = page.slice(page.indexOf('var TOOLS = ['), page.indexOf('];', page.indexOf('var TOOLS = [')));
  const entries = list.split(/\n\s*\{ title: /).slice(1);
  assert.ok(entries.length >= 6, 'read the tool entries');
  entries.forEach((e) => {
    const isOps = /file: 'ops-center'/.test(e);
    assert.equal(/hidden: true/.test(e), !isOps, (isOps ? 'Ops Center shows: ' : 'hidden: ') + e.slice(0, 40));
  });
  assert.match(page, /TOOLS\.filter\(function\s*\(t\)\s*\{\s*return !t\.hidden;\s*\}\)\.forEach/, 'the page skips hidden tools');
  assert.match(page, /Copy the Ops Center link below/);
});

// Rickroll (Tex, 2026-10-09): the tile says "Rickroll" truthfully; the description stays generic.
test('Rickroll tile: titled Rickroll, a generic description, for members, its own overlay, script deployed', () => {
  const t = list.tools.find((x) => x.id === 'rickroll');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Rickroll');
  assert.equal(t.desc, 'A little something for the grind.');
  assert.ok(!/rick|roll|astley|never gonna|song|music|audio/i.test(t.desc + ' ' + t.keywords), 'the description gives nothing away');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'rickroll-audio.js']);
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#rr-root');
  assert.equal(t.icon, 'disco', 'a disco ball, drawn like the other tile icons (Tex, 2026-10-09)');
  assert.match(read('ops-kit.js'), /\n\s*disco: \[/, 'the Ops kit draws it');
});

// Angel Attacks (Tex, 2026-10-13): every member, its own tile and the Mask Boxes card's switch.
test('Angel Attacks tile: for members, game ready, its own overlay and crosshair icon, scripts deployed, rules in the deploy gate', () => {
  const t = list.tools.find((x) => x.id === 'angels');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Angel Attacks');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#ang-root');
  assert.equal(t.icon, 'target');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-stack.js', 'angel-attacks-core.js', 'angel-attacks.js']);
  assert.match(t.desc, /Doesn't use your normal marches/);
  const ver = (read('angel-attacks.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = script version');
  assert.ok(/test\/angel-attacks-core\.test\.js/.test(read('.github/workflows/pages.yml')), 'rules run before every deploy');
  assert.ok(/target:\s*\[/.test(read('ops-kit.js')), 'the crosshair is drawn');
  assert.match(read('pages/map-collector.html'), /'angels': \['attack', 'attacks'\]/);
});

// Refugee Camps (Tex, 2026-10-13): every member, direct requests only, its own tent icon.
test('Refugee Camps tile: for members, game ready, its own overlay and tent icon, scripts deployed, rules in the deploy gate', () => {
  const t = list.tools.find((x) => x.id === 'refugee-camps');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Refugee Camps');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#rfc-root');
  assert.equal(t.icon, 'tent');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-jam.js', 'refugee-camps-core.js', 'refugee-camps.js']);
  assert.match(t.desc, /"Help Me" Letters/);
  assert.ok(!/—/.test(t.desc), 'no em dash');
  const ver = (read('refugee-camps.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = script version');
  const yml = read('.github/workflows/pages.yml');
  assert.ok(/test\/refugee-camps-core\.test\.js/.test(yml), 'rules run before every deploy');
  assert.ok(/ refugee-camps-core\.js refugee-camps\.js /.test(cpLine), 'scripts deployed');
  assert.ok(/\n\s*tent: \[/.test(read('ops-kit.js')), 'the tent is drawn');
  assert.match(read('pages/map-collector.html'), /'refugee-camps': \['camp', 'camps'\]/);
});

// HT Gift Boxes (Tex, 2026-10-13): every member sees the tile; no password since 2026-10-16 (Tex).
test('HT Gift Boxes tile: for members, game ready, its own overlay and chest icon, scripts deployed, rules in the deploy gate', () => {
  const t = list.tools.find((x) => x.id === 'ht-gifts');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'HT Gift Boxes');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#htg-root');
  assert.equal(t.icon, 'chest');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-stack.js', 'ht-gifts-core.js', 'ht-gifts.js']);
  assert.ok(!/password/i.test(t.desc), 'no password to ask for');
  assert.ok(!/—/.test(t.desc) && !/bananas/i.test(t.desc + t.keywords), 'no em dash; no password word');
  const ver = (read('ht-gifts.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = script version');
  assert.ok(/test\/ht-gifts-core\.test\.js/.test(read('.github/workflows/pages.yml')), 'rules run before every deploy');
  assert.ok(/ ht-gifts-core\.js ht-gifts\.js /.test(cpLine), 'scripts deployed');
  assert.ok(/\n\s*chest: \[/.test(read('ops-kit.js')), 'the chest is drawn');
  assert.match(read('pages/map-collector.html'), /'ht-gifts': \['claim', 'claims'\]/);
});

// Enigma Veins (Tex, 2026-10-14): every member; tied to the Enigma Field Hunt (activity type 279).
test('Enigma Veins tile: for members, game ready, its own overlay and gem icon, scripts deployed, rules in the deploy gate', () => {
  const t = list.tools.find((x) => x.id === 'enigma-veins');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Enigma Veins');
  assert.equal(t.gate, 'member');
  assert.deepEqual(t.ready, ['game']);
  assert.equal(t.overlay, '#vein-root');
  assert.equal(t.icon, 'gem');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-jam.js', 'ops-stack.js', 'enigma-veins-core.js', 'enigma-veins.js']);
  assert.match(t.desc, /Enigma Field Hunt/);
  assert.ok(!/—/.test(t.desc), 'no em dash');
  const ver = (read('enigma-veins.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = script version');
  assert.ok(/test\/enigma-veins-core\.test\.js/.test(read('.github/workflows/pages.yml')), 'rules run before every deploy');
  assert.ok(/ enigma-veins-core\.js enigma-veins\.js /.test(cpLine), 'scripts deployed');
  assert.ok(/\n\s*gem: \[/.test(read('ops-kit.js')), 'the gem is drawn');
  assert.match(read('pages/map-collector.html'), /'enigma-veins': \['vein', 'veins'\]/);
});

// Movable cards (Tex, 2026-10-14): every floating card's tool loads the drag helper first; the helper ships and is gated.
test('movable cards: each floating tool lists ops-drag.js first, at version 2026-10-14 or later; the helper deploys and its rules gate', () => {
  for (const id of ['map-collector', 'mask-boxes', 'fun-stuff', 'angels', 'refugee-camps', 'ht-gifts', 'enigma-veins', 'alliance-defense', 'rickroll', 'troop']) {
    const t = list.tools.find((x) => x.id === id);
    assert.equal(t.scripts[0], 'ops-drag.js', id);
    assert.ok(t.version >= '2026-10-14', id + ' ' + t.version);   // the version that brought the helper, or a later bump
  }
  assert.ok(/ ops-drag\.js /.test(cpLine), 'deployed');
  assert.ok(/test\/ops-drag\.test\.js/.test(read('.github/workflows/pages.yml')), 'rules in the gate');
});

// Event tiles (Tex, 2026-10-14): Angel Attacks, Enigma Veins and Alliance Defense are tied to their events; HT Gift Boxes is not.
test('event tools: Angel Attacks 292, Enigma Veins 279, Alliance Defense 26, Looter Locator Loot Quest; no other tool has an event', () => {
  const ev = Object.fromEntries(list.tools.filter((t) => t.event.length).map((t) => [t.id, t.event]));
  assert.deepEqual(ev, { 'alliance-defense': [26], angels: [292], 'enigma-veins': [279], 'looter-locator': ['lootquest'] });
});

// Tex, 2026-10-14: TC Squad Sync and Class Talent Reset (EL) always sit under "Not running now"; whoever needs them finds them there.
test('tucked tools: TC Squad Sync and Class Talent Reset (EL), nothing else', () => {
  assert.deepEqual(list.tools.filter((t) => t.tucked).map((t) => t.id).sort(), ['class-reset', 'tc-sync']);
  assert.equal(list.tools.find((t) => t.id === 'class-reset').title, 'Class Talent Reset (EL)');
});

test('alongside (Tex 2026-10-14): only Rickroll runs alongside; the Jam cards list ops-jam.js second; the helper deploys and its rule runs in the gate', () => {
  assert.deepEqual(list.tools.filter((t) => t.alongside).map((t) => t.id), ['rickroll']);
  for (const id of ['mask-boxes', 'map-collector', 'enigma-veins', 'refugee-camps']) {
    const t = list.tools.find((x) => x.id === id);
    assert.deepEqual(t.scripts.slice(0, 2), ['ops-drag.js', 'ops-jam.js'], id);
  }
  assert.ok(/ ops-jam\.js /.test(cpLine), 'deployed');
  assert.ok(/test\/ops-jam\.test\.js/.test(read('.github/workflows/pages.yml')), 'rule in the gate');
});

test('Mask Boxes knows the Angel event types the registry names (Tex 2026-10-16)', () => {
  const MB = require('../mask-boxes-core.js');
  assert.deepEqual(MB.ANGEL_EVENT, raw.tools.find((t) => t.id === 'angels').event);
});

test('together (Tex 2026-10-16): exactly the six collectors run together (Looter Locator joined the same day), list ops-stack.js among their helpers before their own scripts, and the helper deploys and gates', () => {
  assert.deepEqual(list.tools.filter((t) => t.together).map((t) => t.id).sort(), ['angels', 'enigma-veins', 'ht-gifts', 'looter-locator', 'mask-boxes', 'odin-gather']);
  list.tools.filter((t) => t.together).forEach((t) => {
    const i = t.scripts.indexOf('ops-stack.js');
    assert.ok(i > 0, t.id);
    assert.ok(t.scripts.slice(0, i).every((f) => /^ops-(drag|jam)\.js$/.test(f)), t.id + ': helpers first');
    assert.match(t.version, /^2026-10-16/, t.id);
  });
  const yml = read('.github/workflows/pages.yml');
  assert.ok(/cp [^\n]*\bops-stack\.js\b/.test(yml), 'deployed');
  assert.ok(/node --test [^\n]*test\/ops-stack\.test\.js/.test(yml), 'gated');
});

test('Odinium Gatherer tile (Tex 2026-10-16): for members, game ready, its own overlay and ore icon, runs together; scripts deployed, rules in the deploy gate', () => {
  const t = list.tools.find((x) => x.id === 'odin-gather');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Odinium Gatherer');
  assert.equal(t.gate, 'member'); assert.deepEqual(t.ready, ['game']); assert.equal(t.overlay, '#odin-root'); assert.equal(t.icon, 'ore');
  assert.equal(t.together, true);
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-stack.js', 'odin-gather-core.js', 'odin-gather.js']);
  const ver = (read('odin-gather.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver);
  assert.ok(t.version >= '2026-10-16.2', 'not the ops-stack cache key that served the older helper (review I5)');
  assert.ok(!/\u2014/.test(t.desc + t.title), 'no em dash');
  const yml = read('.github/workflows/pages.yml');
  assert.ok(/cp [^\n]*\bodin-gather-core\.js\b/.test(yml) && /cp [^\n]*\bodin-gather\.js\b/.test(yml), 'deployed');
  assert.ok(/node --test [^\n]*test\/odin-gather-core\.test\.js/.test(yml), 'gated');
  assert.match(read('pages/map-collector.html'), /'odin-gather': \['march', 'marches'\]/, 'its count reads "N marches" in the Tool usage panel');
});

test('Looter Locator tile (Tex 2026-10-16): members, game ready, radar icon, runs together, tucked between Loot Quest windows; says one runner per alliance is enough; deployed and gated', () => {
  const t = list.tools.find((x) => x.id === 'looter-locator');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Looter Locator');
  assert.equal(t.gate, 'member'); assert.deepEqual(t.ready, ['game']); assert.equal(t.overlay, '#loot-root'); assert.equal(t.icon, 'radar');
  assert.equal(t.together, true);
  assert.deepEqual(t.event, ['lootquest']);
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-stack.js', 'looter-locator-core.js', 'looter-locator.js']);
  assert.match(t.desc, /posts them to world and alliance chat\. Only one person per alliance needs to run it\./);
  assert.ok(!/—/.test(t.desc + t.title), 'no em dash');
  const ver = (read('looter-locator.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = script version');
  const yml = read('.github/workflows/pages.yml');
  assert.ok(/cp [^\n]*\blooter-locator-core\.js\b/.test(yml) && /cp [^\n]*\blooter-locator\.js\b/.test(yml), 'deployed');
  assert.ok(/node --test [^\n]*test\/looter-locator-core\.test\.js/.test(yml), 'gated');
  assert.match(read('pages/map-collector.html'), /'looter-locator': \['looter', 'looters'\]/, 'its count reads "N looters" in the Tool usage panel');
  assert.match(read('ops-stack.js'), /'loot-root'/, 'its card keeps clear of the other group cards');
});

test('ops-stack.js knows the Looter Locator card: every group tool that loads it moved to a new version (its ?v= cache key)', () => {
  for (const id of ['mask-boxes', 'angels', 'ht-gifts', 'enigma-veins', 'odin-gather']) {
    const t = list.tools.find((x) => x.id === id);
    assert.ok(t.scripts.includes('ops-stack.js'), id);
    assert.ok(t.version >= '2026-10-16.5', id + ' ' + t.version);
  }
});

test('Unattended mode tile (Tex 2026-10-16): only allowed accounts (worker /opsremote/visible), its own overlay and remote icon; deployed and gated', () => {
  const list = JSON.parse(read('ops-tools.json'));
  const t = list.tools.find((x) => x.id === 'ops-unattended');
  assert.ok(t, 'listed');
  assert.equal(t.title, 'Unattended mode'); assert.equal(t.icon, 'remote'); assert.equal(t.gate, 'member');
  assert.deepEqual(t.ready, ['game']); assert.equal(t.overlay, '#opsu-root'); assert.equal(t.registered, 'opsremote');
  assert.deepEqual(t.scripts, ['ops-drag.js', 'ops-unattended-core.js', 'ops-unattended.js']);
  assert.ok(!t.together && !t.alongside && !t.owners, 'runs alone; no published owner list');
  const ver = (read('ops-unattended.js').match(/var VERSION = '([^']+)'/) || [])[1];
  assert.equal(t.version, ver, 'registry version = the script\'s');
  assert.ok(!/—/.test(t.desc + t.title), 'no em dash');
  const yml = read('.github/workflows/pages.yml');
  assert.ok(/cp [^\n]*\bops-unattended-core\.js\b/.test(yml) && /cp [^\n]*\bops-unattended\.js\b/.test(yml), 'deployed');
  assert.ok(/node --test [^\n]*test\/ops-unattended-core\.test\.js/.test(yml), 'gated');
  assert.ok(!/d847a198622a518d|c3c6f3200a4ec1fb/.test(read('ops-tools.json') + read('ops-unattended.js') + read('ops-unattended-core.js')), 'no account published');
});
