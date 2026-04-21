#!/usr/bin/env node
/**
 * ud-distribute-r5.js — Round 5 UD Treasury Distribution
 * Usage: node scripts/ud-distribute-r5.js
 * Run from landing-page/ directory.
 *
 * Methodology (matches Round 3):
 * - P-Tier 1 = fame 80 (236 players), P-Tier 2 = fame < 80 (85 players)
 * - P-Tier 1 split into 3 sub-groups by merit:
 *   Group A (top N by merit): Legendary Beast Chest + Adv Catalyst + Shards + T3
 *   Group B (next N by merit): Top-tier Catalyst + Adv Catalyst + Shards + T3
 *   Group C (remaining): Shards + T3/T4 items
 * - P-Tier 2: Shards + T4 items + resources
 * - Seal Stone Badge to ALL eligible
 * - Legendary Beast Chest holders do NOT get Top-tier Catalyst (and vice versa)
 * - Max 5 reward categories per player
 * - P-Tier 1 does NOT get resources (T5)
 * - Shards are the flex item — quantity adjusted to maximize utilization
 * - Cross-round balancing against rounds 2, 3, and 4
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Load data ───────────────────────────────────────────────────────────────

const treasury = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'treasury-items.json'), 'utf8'));
const r5 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ud-round5-players.json'), 'utf8'));
const history = fs.existsSync(path.join(DATA_DIR, 'ud-distributions.json'))
  ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ud-distributions.json'), 'utf8'))
  : { event: 'Seal Stone Chaos/Fake UD', totalRounds: 15, dataAvailableFrom: 2, rounds: {} };

const players = r5.players;

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

// ─── Cross-round balance: who got what in R2/R3 ──────────────────────────────

const priorRewards = {}; // siteKey → Set of item names received
for (const rnd of ['2', '3', '4']) {
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

// ─── Tier assignment ─────────────────────────────────────────────────────────

const ptier1 = players.filter(p => (p.fame || 0) >= 80).sort((a, b) => (b.merit || 0) - (a.merit || 0));
const ptier2 = players.filter(p => (p.fame || 0) > 0 && (p.fame || 0) < 80);
const excluded = players.filter(p => (p.fame || 0) === 0);
const allEligible = [...ptier1, ...ptier2];

// Sub-groups within P-Tier 1:
// Group A size = Legendary Beast Chest available (97)
// Group B size = Top-tier Catalyst available (99)
// Group C = remainder
const legBeastAvail = inv['Legendary Beast Chest'] ? inv['Legendary Beast Chest'].remaining : 0;
const topCatAvail = inv['Top-tier Catalyst'] ? inv['Top-tier Catalyst'].remaining : 0;

// Cross-round: prefer giving Leg Beast to players who got Top Cat before, and vice versa
const groupA = [];
const groupB = [];
const groupC = [];

// Sort by: had Top-tier Catalyst before (priority for Beast Chest now), then merit desc
const tier1Candidates = ptier1.map(p => ({
  ...p,
  hadBeast: hadBefore(p, 'Legendary Beast Chest'),
  hadCat: hadBefore(p, 'Top-tier Catalyst'),
}));

// First pass: assign to A or B based on cross-round balance
for (const p of tier1Candidates) {
  if (groupA.length < legBeastAvail) {
    // Prefer for A: players who had Cat before but NOT Beast
    if (p.hadCat && !p.hadBeast) {
      groupA.push(p);
      continue;
    }
  }
  if (groupB.length < topCatAvail) {
    // Prefer for B: players who had Beast before but NOT Cat
    if (p.hadBeast && !p.hadCat) {
      groupB.push(p);
      continue;
    }
  }
  // Defer remaining
  groupC.push(p);
}

// Second pass: fill A and B from remaining (by merit)
const remaining = groupC.splice(0); // take all out
remaining.sort((a, b) => (b.merit || 0) - (a.merit || 0));
for (const p of remaining) {
  if (groupA.length < legBeastAvail) {
    groupA.push(p);
  } else if (groupB.length < topCatAvail) {
    groupB.push(p);
  } else {
    groupC.push(p);
  }
}

console.log(`P-Tier 1: ${ptier1.length} (Group A: ${groupA.length}, Group B: ${groupB.length}, Group C: ${groupC.length})`);
console.log(`P-Tier 2: ${ptier2.length}`);
console.log(`Excluded: ${excluded.length}`);

// ─── Shard distribution calculation ──────────────────────────────────────────

// Shards are the flex item. Calculate how many each group gets to maximize usage.
const shardItem = inv['Legendary Beast Chest Shard'];
const shardLimit = shardItem.perPlayerLimit; // 40
const totalShardPlayers = allEligible.length;
// Max possible: totalShardPlayers × 40 = 321 × 40 = 12,840
// Available: 19,860 → everyone gets max 40, still 7,020 left (per-player limit blocks more)
const shardPerPlayer = Math.min(shardLimit, Math.floor(shardItem.remaining / totalShardPlayers));

// ─── Seal Stone Badge calculation ────────────────────────────────────────────

const ssbItem = inv['Seal Stone Badge'];
const ssbPerPlayer = Math.min(ssbItem.perPlayerLimit, Math.floor(ssbItem.remaining / totalShardPlayers));

// ─── Build distributions ─────────────────────────────────────────────────────

const distributions = [];
const PLAYER_OVERRIDES = { '7550807444272': { skip: ['Mastery Research'] } };

function buildRewards(player, group) {
  const rewards = [];
  const overrides = PLAYER_OVERRIDES[player.uid] || {};
  const skipItems = overrides.skip || [];

  if (group === 'A') {
    // Group A: Legendary Beast Chest + Adv Catalyst + Shards + Seal Badge + T3
    rewards.push(allocate('Legendary Beast Chest', 1));
    if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 2)
      rewards.push(allocate('Advanced-tier Catalyst', 2));
    else if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 1)
      rewards.push(allocate('Advanced-tier Catalyst', 1));
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    // T3 filler
    if (rewards.length < 5 && !skipItems.includes('Mastery Research') && inv['Mastery Research'].remaining >= 10)
      rewards.push(allocate('Mastery Research', 10));
    if (rewards.length < 5 && inv['Titan Gear Random Material Box'].remaining >= 10)
      rewards.push(allocate('Titan Gear Random Material Box', 10));
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'B') {
    // Group B: Top-tier Catalyst + Adv Catalyst + Shards + Seal Badge + T3
    rewards.push(allocate('Top-tier Catalyst', 1));
    if (!skipItems.includes('Advanced-tier Catalyst') && inv['Advanced-tier Catalyst'].remaining >= 1)
      rewards.push(allocate('Advanced-tier Catalyst', 1));
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    if (rewards.length < 5 && !skipItems.includes('Mastery Research') && inv['Mastery Research'].remaining >= 10)
      rewards.push(allocate('Mastery Research', 10));
    if (rewards.length < 5 && inv['Epic Beast Chest'].remaining >= 2)
      rewards.push(allocate('Epic Beast Chest', 2));
    else if (rewards.length < 5 && inv['Titan Gear Random Material Box'].remaining >= 10)
      rewards.push(allocate('Titan Gear Random Material Box', 10));
    if (rewards.length < 5)
      rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));

  } else if (group === 'C') {
    // Group C: Shards + T3/T4 items + Seal Badge
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    // Rotate T3/T4 items
    const t3t4 = ['HT Chip Chest', 'Titan Gear Random Material Box', 'Mastery Research', 'Epic Beast Chest'];
    let filled = 0;
    for (const name of t3t4) {
      if (rewards.length >= 4) break; // save slot for Seal Badge
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
    // P-Tier 2: Shards + T4 items + resources
    rewards.push(allocate('Legendary Beast Chest Shard', shardPerPlayer));
    rewards.push(allocate('Seal Stone Badge', ssbPerPlayer));
    // T4 items
    const t4 = ['HT Chip Chest', 'Orange Universal Shard', 'Blue Material Choice Box'];
    for (const name of t4) {
      if (rewards.length >= 5) break;
      const item = inv[name];
      if (item && item.remaining >= item.perPlayerLimit) {
        rewards.push(allocate(name, item.perPlayerLimit));
      }
    }
    // Resources if slots remain
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

// Process Group A
for (const p of groupA) {
  const rewards = buildRewards(p, 'A');
  distributions.push({
    siteKey: `sha256:${p.siteKey}`,
    name: p.name,
    playerTier: 1,
    subGroup: 'A',
    fame: p.fame,
    merit: p.merit || 0,
    power: p.power,
    rewards,
  });
}

// Process Group B
for (const p of groupB) {
  const rewards = buildRewards(p, 'B');
  distributions.push({
    siteKey: `sha256:${p.siteKey}`,
    name: p.name,
    playerTier: 1,
    subGroup: 'B',
    fame: p.fame,
    merit: p.merit || 0,
    power: p.power,
    rewards,
  });
}

// Process Group C
for (const p of groupC) {
  const rewards = buildRewards(p, 'C');
  distributions.push({
    siteKey: `sha256:${p.siteKey}`,
    name: p.name,
    playerTier: 1,
    subGroup: 'C',
    fame: p.fame,
    merit: p.merit || 0,
    power: p.power,
    rewards,
  });
}

// Process P-Tier 2
for (const p of ptier2) {
  const rewards = buildRewards(p, 'T2');
  distributions.push({
    siteKey: `sha256:${p.siteKey}`,
    name: p.name,
    playerTier: 2,
    subGroup: null,
    fame: p.fame,
    merit: p.merit || 0,
    power: p.power,
    rewards,
  });
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const summary = {
  totalPlayers: distributions.length,
  byPlayerTier: { tier1: ptier1.length, tier2: ptier2.length },
  bySubGroup: { A: groupA.length, B: groupB.length, C: groupC.length },
  inventoryUsed: {},
};

for (const [name, item] of Object.entries(inv)) {
  const used = (item.available || item.remaining + 1) - item.remaining;
  // Recalculate from actual item.available
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

// ─── Output ──────────────────────────────────────────────────────────────────

const plan = {
  generatedAt: new Date().toISOString(),
  round: 5,
  summary,
  distributions,
};

const planPath = path.join(DATA_DIR, 'ud-round5-distribution-plan.json');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log(`\nPlan written to: ${planPath}`);

// Print summary
console.log('\n' + '='.repeat(60));
console.log('  UD Distribution Plan — Round 5');
console.log('='.repeat(60));
console.log(`\nTotal: ${distributions.length} players`);
console.log(`  P-Tier 1: ${ptier1.length} (A:${groupA.length} B:${groupB.length} C:${groupC.length})`);
console.log(`  P-Tier 2: ${ptier2.length}`);
console.log(`  Excluded: ${excluded.length}`);

console.log('\nInventory Usage:');
for (const [name, info] of Object.entries(summary.inventoryUsed)) {
  console.log(`  ${name.padEnd(35)} ${String(info.distributed).padStart(10)} / ${String(info.totalCount).padStart(10)}  (${info.utilization})`);
}

// Show sample distributions
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

// Check 5-item limit
const over5 = distributions.filter(d => d.rewards.length > 5);
if (over5.length > 0) {
  console.log(`\n⚠️  WARNING: ${over5.length} players have > 5 reward categories!`);
  over5.forEach(d => console.log(`  ${d.name}: ${d.rewards.length} categories`));
}

console.log('\n' + '='.repeat(60));
