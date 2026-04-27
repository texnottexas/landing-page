#!/usr/bin/env node
/**
 * ud-distribute-r6.js — Round 6 UD Treasury Distribution
 * Usage: node scripts/ud-distribute-r6.js
 * Run from landing-page/ directory.
 *
 * Methodology (extends R5 with new "S" Special group for Beast Choice Chest):
 * - Group S (4 manual): Legendary Beast Choice Chest (Limited) — VIP0 + mining hub leaders
 * - Group A (top by merit, excl. S): Legendary Beast Chest + Adv Catalyst + Shards + Seal Badge + T3
 * - Group B (next): Top-tier Catalyst + Adv Catalyst + Shards + Seal Badge + T3
 * - Group C (remaining P-Tier 1): Shards + T3/T4 + Seal Badge
 * - P-Tier 2: Shards + Seal Badge + T4 + resources
 * - Cross-round balancing against rounds 2, 3, 4, 5
 * - Max 5 reward categories per player
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const treasury = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'treasury-items.json'), 'utf8'));
const r6 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ud-round6-players.json'), 'utf8'));
const history = fs.existsSync(path.join(DATA_DIR, 'ud-distributions.json'))
  ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ud-distributions.json'), 'utf8'))
  : { event: 'Seal Stone Chaos/Fake UD', totalRounds: 15, dataAvailableFrom: 2, rounds: {} };

const players = r6.players;

// ─── Build inventory map ─────────────────────────────────────────────────────

const inv = {};
for (const item of treasury.treasuryItems) {
  inv[item.name] = { ...item, remaining: item.available };
}
for (const res of treasury.warzoneResources) {
  const names = { 20: 'Odinium', 5: 'Oil', 7: 'Food' };
  const name = names[res.type] || `Resource ${res.type}`;
  inv[name] = { name, type: res.type, icon: res.icon, tier: res.tier || 'T5', remaining: res.available, perPlayerLimit: res.perPlayerLimit, isResource: true };
}

function allocate(name, qty) {
  const item = inv[name];
  if (!item || item.remaining < qty) return null;
  item.remaining -= qty;
  const reward = { name, count: qty, icon: item.icon || '' };
  if (item.tier) reward.tier = item.tier;
  return reward;
}

// ─── Cross-round balance: who got what in R2-R5 ──────────────────────────────

const priorRewards = {};
for (const rnd of ['2', '3', '4', '5']) {
  const rd = history.rounds[rnd];
  if (!rd || !rd.distributions) continue;
  for (const d of rd.distributions) {
    if (!priorRewards[d.siteKey]) priorRewards[d.siteKey] = new Set();
    for (const r of d.rewards) {
      priorRewards[d.siteKey].add(r.name);
    }
  }
}

function hadBefore(player, itemName) {
  const prior = priorRewards[`sha256:${player.siteKey}`] || priorRewards[player.siteKey];
  return prior ? prior.has(itemName) : false;
}

// ─── Special group: Beast Choice Chest recipients ────────────────────────────

const SPECIAL_UIDS = {
  '7554163018544': '20100 — VIP0',
  '7547091815216': 'OEL13 — VIP0',
  '7580532181842': 'Jopn17tl — #2 mining hub + heavy merit grind',
  '940029549339':  'AlexB — #1 mining hub'
};

// Manual group override: force specific UIDs into a group regardless of cross-round balance.
// Tex (R6): self-opted out of Beast Chest, takes Top-tier Catalyst slot instead so a random
// player in Group B benefits from the Lego Beast Chest swap.
const MANUAL_GROUP = {
  '7550807444272': 'B'
};

const groupS = [];
for (const p of players) {
  if (SPECIAL_UIDS[p.uid]) {
    groupS.push({ ...p, specialReason: SPECIAL_UIDS[p.uid] });
  }
}
console.log(`Group S (Beast Choice Chest): ${groupS.length}/4 recipients found`);
for (const p of groupS) console.log(`  ${p.name} (${p.uid}) — ${p.specialReason}`);

// ─── Tier assignment ─────────────────────────────────────────────────────────

const ptier1All = players.filter(p => (p.fame || 0) >= 80).sort((a, b) => (b.merit || 0) - (a.merit || 0));
const ptier1 = ptier1All.filter(p => !SPECIAL_UIDS[p.uid] && !MANUAL_GROUP[p.uid]); // exclude S + manual overrides
const ptier2 = players.filter(p => (p.fame || 0) > 0 && (p.fame || 0) < 80);
const excluded = players.filter(p => (p.fame || 0) === 0);
const allEligible = [...ptier1All, ...ptier2];

const legBeastAvail = inv['Legendary Beast Chest'] ? inv['Legendary Beast Chest'].remaining : 0;
const topCatAvail = inv['Top-tier Catalyst'] ? inv['Top-tier Catalyst'].remaining : 0;

const groupA = [];
const groupB = [];
const groupC = [];

// Pre-seed manual-group overrides
for (const p of ptier1All) {
  const forced = MANUAL_GROUP[p.uid];
  if (!forced) continue;
  const candidate = {
    ...p,
    hadBeast: hadBefore(p, 'Legendary Beast Chest'),
    hadCat: hadBefore(p, 'Top-tier Catalyst'),
    manualOverride: true
  };
  if (forced === 'A') groupA.push(candidate);
  else if (forced === 'B') groupB.push(candidate);
  else if (forced === 'C') groupC.push(candidate);
}

// Adjust caps to leave room for manual placements
const legBeastCap = Math.max(0, legBeastAvail - groupA.filter(p => p.manualOverride).length);
const topCatCap = Math.max(0, topCatAvail - groupB.filter(p => p.manualOverride).length);

const tier1Candidates = ptier1.map(p => ({
  ...p,
  hadBeast: hadBefore(p, 'Legendary Beast Chest'),
  hadCat: hadBefore(p, 'Top-tier Catalyst'),
}));

for (const p of tier1Candidates) {
  if (groupA.filter(x => !x.manualOverride).length < legBeastCap) {
    if (p.hadCat && !p.hadBeast) { groupA.push(p); continue; }
  }
  if (groupB.filter(x => !x.manualOverride).length < topCatCap) {
    if (p.hadBeast && !p.hadCat) { groupB.push(p); continue; }
  }
  groupC.push(p);
}

const remaining = groupC.splice(0).filter(p => !p.manualOverride);
remaining.sort((a, b) => (b.merit || 0) - (a.merit || 0));
for (const p of remaining) {
  if (groupA.filter(x => !x.manualOverride).length < legBeastCap) groupA.push(p);
  else if (groupB.filter(x => !x.manualOverride).length < topCatCap) groupB.push(p);
  else groupC.push(p);
}

console.log(`P-Tier 1: ${ptier1All.length} (S:${groupS.length} A:${groupA.length} B:${groupB.length} C:${groupC.length})`);
console.log(`P-Tier 2: ${ptier2.length}`);
console.log(`Excluded: ${excluded.length}`);

// ─── Shard + Seal Badge per-player calc ──────────────────────────────────────

const shardItem = inv['Legendary Beast Chest Shard'];
const totalShardPlayers = allEligible.length;
const shardPerPlayer = Math.min(shardItem.perPlayerLimit, Math.floor(shardItem.remaining / totalShardPlayers));

const ssbItem = inv['Seal Stone Badge'];
const ssbPerPlayer = Math.min(ssbItem.perPlayerLimit, Math.floor(ssbItem.remaining / totalShardPlayers));

// ─── Reward builders ─────────────────────────────────────────────────────────

const distributions = [];
const PLAYER_OVERRIDES = { '7550807444272': { skip: ['Mastery Research'] } };

function buildRewards(player, group) {
  const rewards = [];
  const overrides = PLAYER_OVERRIDES[player.uid] || {};
  const skipItems = overrides.skip || [];

  if (group === 'S') {
    // Group S: Beast Choice Chest + Adv Catalyst + Shards + Mastery + Seal Badge
    rewards.push(allocate('Legendary Beast Choice Chest (Limited)', 1));
    if (inv['Advanced-tier Catalyst'].remaining >= 2)
      rewards.push(allocate('Advanced-tier Catalyst', 2));
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    if (rewards.length < 5 && !skipItems.includes('Mastery Research') && inv['Mastery Research'].remaining >= 10)
      rewards.push(allocate('Mastery Research', 10));
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'A') {
    rewards.push(allocate('Legendary Beast Chest', 1));
    if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 2)
      rewards.push(allocate('Advanced-tier Catalyst', 2));
    else if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 1)
      rewards.push(allocate('Advanced-tier Catalyst', 1));
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    if (rewards.length < 5 && !skipItems.includes('Mastery Research') && inv['Mastery Research'].remaining >= 10)
      rewards.push(allocate('Mastery Research', 10));
    if (rewards.length < 5 && inv['Titan Gear Random Material Box'].remaining >= 10)
      rewards.push(allocate('Titan Gear Random Material Box', 10));
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'B') {
    rewards.push(allocate('Top-tier Catalyst', 1));
    if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 1)
      rewards.push(allocate('Advanced-tier Catalyst', 1));
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    if (rewards.length < 5 && !skipItems.includes('Mastery Research') && inv['Mastery Research'].remaining >= 10)
      rewards.push(allocate('Mastery Research', 10));
    if (rewards.length < 5 && inv['Epic Beast Chest'].remaining >= 2)
      rewards.push(allocate('Epic Beast Chest', 2));
    if (rewards.length < 5 && inv['Titan Gear Random Material Box'].remaining >= 10)
      rewards.push(allocate('Titan Gear Random Material Box', 10));
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'C') {
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    const t3t4 = ['HT Chip Chest', 'Titan Gear Random Material Box', 'Mastery Research', 'Epic Beast Chest'];
    let filled = 0;
    for (const name of t3t4) {
      if (rewards.length >= 4) break;
      if (skipItems.includes(name)) continue;
      const item = inv[name];
      if (item && item.remaining >= item.perPlayerLimit) {
        rewards.push(allocate(name, item.perPlayerLimit));
        filled++;
        if (filled >= 3) break;
      }
    }
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'T2') {
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));
    const t4 = ['HT Chip Chest', 'Orange Universal Shard', 'Blue Material Choice Box'];
    for (const name of t4) {
      if (rewards.length >= 5) break;
      const item = inv[name];
      if (item && item.remaining >= item.perPlayerLimit) {
        rewards.push(allocate(name, item.perPlayerLimit));
      }
    }
    const resources = ['Odinium', 'Oil', 'Food'];
    for (const name of resources) {
      if (rewards.length >= 5) break;
      const item = inv[name];
      if (item && item.remaining >= item.perPlayerLimit) {
        rewards.push(allocate(name, item.perPlayerLimit));
      }
    }
  }

  return rewards.filter(Boolean);
}

function pushDist(p, tier, sub) {
  const rewards = buildRewards(p, sub);
  const entry = {
    siteKey: `sha256:${p.siteKey}`,
    name: p.name,
    uid: p.uid,
    playerTier: tier,
    subGroup: sub,
    fame: p.fame,
    merit: p.merit || 0,
    power: p.power,
    rewards,
  };
  if (p.specialReason) entry.specialReason = p.specialReason;
  distributions.push(entry);
}

for (const p of groupS) pushDist(p, 1, 'S');
for (const p of groupA) pushDist(p, 1, 'A');
for (const p of groupB) pushDist(p, 1, 'B');
for (const p of groupC) pushDist(p, 1, 'C');
for (const p of ptier2) pushDist(p, 2, 'T2');

// ─── Summary ─────────────────────────────────────────────────────────────────

const summary = {
  totalPlayers: distributions.length,
  byPlayerTier: { tier1: ptier1All.length, tier2: ptier2.length },
  bySubGroup: { S: groupS.length, A: groupA.length, B: groupB.length, C: groupC.length },
  inventoryUsed: {},
};

for (const [name, item] of Object.entries(inv)) {
  const avail = item.available || 0;
  const distributed = avail - item.remaining;
  if (distributed > 0 || avail > 0) {
    summary.inventoryUsed[name] = {
      distributed,
      totalCount: avail,
      remaining: item.remaining,
      utilization: avail > 0 ? `${(distributed / avail * 100).toFixed(1)}%` : '0%',
      tier: item.tier,
    };
  }
}

const plan = {
  generatedAt: new Date().toISOString(),
  round: 6,
  summary,
  distributions,
};

const planPath = path.join(DATA_DIR, 'ud-round6-distribution-plan.json');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(`\nPlan written to: ${planPath}`);

console.log('\n' + '='.repeat(60));
console.log('  UD Distribution Plan — Round 6');
console.log('='.repeat(60));
console.log(`\nTotal: ${distributions.length} players`);
console.log(`  P-Tier 1: ${ptier1All.length} (S:${groupS.length} A:${groupA.length} B:${groupB.length} C:${groupC.length})`);
console.log(`  P-Tier 2: ${ptier2.length}`);
console.log(`  Excluded: ${excluded.length}`);

console.log('\nInventory Usage:');
for (const [name, info] of Object.entries(summary.inventoryUsed)) {
  console.log(`  ${name.padEnd(40)} ${String(info.distributed).padStart(10)} / ${String(info.totalCount).padStart(10)}  (${info.utilization})`);
}

console.log('\nGroup S — Beast Choice Chest recipients:');
distributions.filter(d => d.subGroup === 'S').forEach(d => {
  console.log(`  ${d.name.padEnd(20)} ${d.specialReason}`);
  d.rewards.forEach(r => console.log(`    → ${r.name} x${r.count}`));
});

console.log('\nSample Group A (first 3):');
distributions.filter(d => d.subGroup === 'A').slice(0, 3).forEach(d => {
  console.log(`  ${d.name.padEnd(20)} merit:${(d.merit||0).toLocaleString().padStart(10)}`);
  d.rewards.forEach(r => console.log(`    → ${r.name} x${r.count}`));
});

console.log('\nSample Group B (first 3):');
distributions.filter(d => d.subGroup === 'B').slice(0, 3).forEach(d => {
  console.log(`  ${d.name.padEnd(20)} merit:${(d.merit||0).toLocaleString().padStart(10)}`);
  d.rewards.forEach(r => console.log(`    → ${r.name} x${r.count}`));
});

console.log('\nSample Group C (first 3):');
distributions.filter(d => d.subGroup === 'C').slice(0, 3).forEach(d => {
  console.log(`  ${d.name.padEnd(20)} merit:${(d.merit||0).toLocaleString().padStart(10)}`);
  d.rewards.forEach(r => console.log(`    → ${r.name} x${r.count}`));
});

console.log('\nSample P-Tier 2 (first 3):');
distributions.filter(d => d.playerTier === 2).slice(0, 3).forEach(d => {
  console.log(`  ${d.name.padEnd(20)} fame:${d.fame}`);
  d.rewards.forEach(r => console.log(`    → ${r.name} x${r.count}`));
});

const over5 = distributions.filter(d => d.rewards.length > 5);
if (over5.length > 0) {
  console.log(`\n⚠️  WARNING: ${over5.length} players have > 5 reward categories!`);
  over5.forEach(d => console.log(`  ${d.name}: ${d.rewards.length} categories`));
}

console.log('\n' + '='.repeat(60));
