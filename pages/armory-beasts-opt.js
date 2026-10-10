/* armory-beasts-opt.js: the Beast Optimizer's engine for the Armory v2 page (phase 3), loaded the first time the Optimizer segment opens
 * (or, after first paint, when the player has saved optimizer preferences and Next moves wants the best swap).
 * The eleven functions in the "verbatim" block are copied unchanged from pages/armory-report.html (boOptimize and its data-prep helpers);
 * test/armory-beasts-opt.parity.test.js compares their source text with the page and their outputs on the same inputs.
 * Per-player state: ArmoryBeastsOpt.create(core) binds them to ONE ArmoryCore instance (platforms, enhance, field conditions, scoring);
 * nothing is written to window. The page read `boFieldConditions` from its own closure; here it is refreshed from the instance before every call.
 */
(function (root) {
'use strict';
var G = (typeof module === 'object' && module.exports) ? require('./tw-game-data.js') : root.TWGameData;

function create(core) {
  var boFieldConditions = null;
  var ebPlatformReq = core.ebPlatformReq, boLookupHole = core.boLookupHole, boBeastScore = core.boBeastScore, boBeastTiebreak = core.boBeastTiebreak,
      boClassifyBuff = core.boClassifyBuff, boPlaystyleMult = core.boPlaystyleMult, boRarityBonusBreakdown = core.boRarityBonusBreakdown,
      BO_FIELD_CONDITION_OFFSETS = G.BO_FIELD_CONDITION_OFFSETS, BO_TIEBREAK_EPSILON = G.BO_TIEBREAK_EPSILON, BO_SCOPE_MULT = G.BO_SCOPE_MULT,
      boMaxStarFor = G.boMaxStarFor, boMaxLevelFor = G.boMaxLevelFor, boFodderForStarUp = G.boFodderForStarUp, ebComputeBuffValue = G.ebComputeBuffValue;

  /* ---- verbatim from pages/armory-report.html ---- */
  function boBuildOwnedBeasts(merged, benchSupp, resolved) {
    var beasts = [];

    (resolved && resolved.fields || []).forEach(function(f) {
      // f.cfg is a numeric fieldType (1..5) — not an object.
      var fieldType = f && f.cfg;
      (f.slots || []).forEach(function(s) {
        if (!s.beast) return;
        var b = s.beast;
        beasts.push({
          id: String(b.id),
          cfgId: b.cfgId != null ? b.cfgId : b.cfg,
          type: b.type,
          fac: b.fac != null ? b.fac : b.faction,
          q: b.quality != null ? b.quality : (b.q || 0),
          lv: b.level != null ? b.level : (b.lv || 0),
          st: b.star != null ? b.star : (b.st || 0),
          pot: (b.potential != null) ? Number(b.potential) : (b.pot != null ? Number(b.pot) : 0),
          mb: b.mainBuff != null ? b.mainBuff : b.mb,
          bb: (b.baseBuff || b.bb || []).map(function(x) { return (x && typeof x === 'object') ? x.id : x; }),
          placement: { fieldType: fieldType, slot: s.fieldSlotNum }
        });
      });
    });

    if (benchSupp && Array.isArray(benchSupp.beasts)) {
      benchSupp.beasts.forEach(function(b) {
        beasts.push({
          id: String(b.id),
          cfgId: b.cfgId,
          type: b.type,
          fac: b.fac,
          q: b.q || 0,
          lv: b.lv || 0,
          st: b.st || 0,
          pot: b.pot != null ? Number(b.pot) : 0,
          mb: b.mb,
          bb: (b.bb || []).map(function(x) { return (x && typeof x === 'object') ? x.id : x; }),
          placement: null
        });
      });
    }

    return beasts;
  }

  function boBuildCurrentPlan(resolved) {
    var plan = {};
    (resolved && resolved.fields || []).forEach(function(f) {
      var fid = f && f.cfg;
      if (!fid) return;
      plan[fid] = {};
      (f.slots || []).forEach(function(s) {
        plan[fid][s.fieldSlotNum] = s.beast ? String(s.beast.id) : null;
      });
    });
    return plan;
  }

  function boConditionIdForSlot(fieldId, slotOrder) {
    var off = BO_FIELD_CONDITION_OFFSETS[fieldId];
    return off == null ? null : (off + Number(slotOrder));
  }

  function boConditionMatches(c, fieldBeasts, allFilled) {
    if (!c) return false;
    if (c.conditionType === 0) return allFilled;
    if (c.conditionType === 1) {
      // Per Tex 2026-05-18: the in-game gate is JUST the legendary count —
      // "deploy N at rarity ≥ R". Field-wide "fill all slots" is its own
      // type-0 condition on a different slot, not a prerequisite for the
      // count check. Previous coupling of allFilled into types 1/6 was
      // hiding slot 3 unlit for Pete even though he had 3 legendaries.
      var need = Number(c.conditionPara1 || 0);
      var rar  = Number(c.conditionPara2 || 0);
      var have = fieldBeasts.filter(function(b) { return b.q >= rar; }).length;
      return have >= need;
    }
    if (c.conditionType === 6) {
      var need6 = Number(c.conditionPara1 || 0);
      var star6 = Number(c.conditionPara2 || 0);
      var rar6  = Number(c.conditionPara3 || 0);
      var have6 = fieldBeasts.filter(function(b) {
        return b.q >= rar6 && b.st >= star6;
      }).length;
      return have6 >= need6;
    }
    return false;
  }

  function boBuildConditionMetMap(plan, beasts) {
    if (!boFieldConditions) return null;
    var byId = {};
    beasts.forEach(function(b) { if (b.id) byId[b.id] = b; });
    var out = {};
    Object.keys(plan).forEach(function(fidStr) {
      var fid = Number(fidStr);
      var slots = plan[fid] || {};
      var slotKeys = Object.keys(slots);
      var fieldBeasts = [];
      var filled = 0, total = 0;
      slotKeys.forEach(function(k) {
        total++;
        var bId = slots[k];
        if (bId) { filled++; if (byId[bId]) fieldBeasts.push(byId[bId]); }
      });
      var allFilled = filled === total && total > 0;
      slotKeys.forEach(function(k) {
        var slotOrder = Number(k);
        var cid = boConditionIdForSlot(fid, slotOrder);
        if (cid == null) { out[fid + ':' + slotOrder] = true; return; }
        var c = boFieldConditions[cid];
        out[fid + ':' + slotOrder] = boConditionMatches(c, fieldBeasts, allFilled);
      });
    });
    return out;
  }

  function boComputeActiveConditions(plan, beasts) {
    if (!boFieldConditions) return [];
    var byId = {};
    beasts.forEach(function(b) { if (b.id) byId[b.id] = b; });

    var active = [];
    Object.keys(plan).forEach(function(fidStr) {
      var fid = Number(fidStr);
      var slots = plan[fid] || {};
      var fieldBeastIds = [];
      var filledCount = 0;
      var totalCount = 0;
      Object.keys(slots).forEach(function(slotKey) {
        totalCount++;
        var bId = slots[slotKey];
        if (bId) { filledCount++; fieldBeastIds.push(bId); }
      });
      var allFilled = filledCount === totalCount && totalCount > 0;
      var fieldBeasts = fieldBeastIds.map(function(id) { return byId[id]; }).filter(Boolean);

      Object.keys(slots).forEach(function(slotKey) {
        var slotOrder = Number(slotKey);
        var cid = boConditionIdForSlot(fid, slotOrder);
        if (cid == null) return;
        var c = boFieldConditions[cid];
        if (!c) return;
        if (boConditionMatches(c, fieldBeasts, allFilled)) {
          active.push({
            fieldId: fid,
            slotOrder: slotOrder,
            conditionId: c.id,
            conditionName: c.descRendered || c.descLoc,
            conditionType: c.conditionType,
            buffId: null,
            buffValue: null
          });
        }
      });
    });
    return active;
  }

  function boBeastEligibleForSlot(beast, slotDesc, opts) {
    if (!beast || !slotDesc) return false;
    if (beast.q < (slotDesc.minQuality || 1)) return false;
    if (slotDesc.faction && beast.fac !== slotDesc.faction) return false;
    if (slotDesc.beastTypeIds && slotDesc.beastTypeIds.length) {
      var typeOk = slotDesc.beastTypeIds.indexOf(beast.type) >= 0;
      var maxOut = opts && opts.maxOut;
      var lynxFlex = maxOut && beast.type === 5 && (beast.st || 0) < 5;
      if (!typeOk && !lynxFlex) return false;
    }
    if (slotDesc.qualityCap && beast.q > slotDesc.qualityCap) return false;
    return true;
  }

  function boSlotDescriptor(fieldType, order, enhanceLevel, tgActive) {
    var req = ebPlatformReq(fieldType, order);
    var hole = boLookupHole(fieldType, order);
    if (!req && !hole) return null;
    var enhanceRowId = null;
    if (hole && hole.maxEnhanceValue) {
      enhanceRowId = String(hole.maxEnhanceValue).split('|')[0];
    }
    // minQuality + faction come from the hole row; req exposes them as
    // localized strings (minQualityName, elementId). Fall back to req when
    // the hole index is not loaded yet.
    var minQuality = (hole && hole.minQuality != null) ? hole.minQuality :
      (req && req.elementId != null ? req.minQuality : 1);
    var faction = (hole && hole.faction != null) ? hole.faction :
      (req && req.elementId != null ? req.elementId : 0);
    var beastTypeIds = (req && req.beastTypeIds) || (hole && hole.beastTypeIds) || [];
    var qualityCap = (req && req.qualityCap) || (hole && hole.qualityCap) || null;
    return {
      fieldType: fieldType,
      order: order,
      holeId: hole ? hole.id : null,
      minQuality: minQuality,
      faction: faction,
      beastTypeIds: beastTypeIds,
      qualityCap: qualityCap,
      enhanceRowId: enhanceRowId,
      enhanceLevel: enhanceLevel || 0,
      tgActive: !!tgActive
    };
  }

  function boOptimize(ownedBeasts, currentPlan, activeConditions, playstyle, playerEnhance, tgRefinementByHole) {
    // Pass 0: build slot descriptors for every (field, order) in the plan.
    var slots = [];
    Object.keys(currentPlan).forEach(function(fidStr) {
      var fid = Number(fidStr);
      Object.keys(currentPlan[fid] || {}).forEach(function(orderStr) {
        var order = Number(orderStr);
        var key = fid + ':' + order;
        var enhLevel = playerEnhance ? (playerEnhance[key] || 0) : 0;
        var hole = boLookupHole(fid, order);
        var tgActive = (hole && tgRefinementByHole) ? !!tgRefinementByHole[hole.id] : false;
        var desc = boSlotDescriptor(fid, order, enhLevel, tgActive);
        if (!desc) return;
        slots.push({ key: key, fieldType: fid, order: order, desc: desc });
      });
    });

    var beastById = {};
    ownedBeasts.forEach(function(b) { beastById[b.id] = b; });

    // March is a HARD floor per Tex's rule: a swap may never reduce march
    // at any slot. Compute each slot's current march contribution at max-out,
    // then filter every candidate set to beasts whose max-out march at that
    // slot is >= the current beast's max-out march. Returns 0 for empty slots
    // so empty -> non-march is fine, but march -> non-march is rejected.
    function boMarchOfBeast(b) {
      if (!b) return 0;
      return boBeastStatProfile(b, 'maxOut', playstyle).march || 0;
    }
    var slotMarchFloor = {};
    slots.forEach(function(s) {
      var origId = currentPlan[s.fieldType] && currentPlan[s.fieldType][s.order];
      slotMarchFloor[s.key] = origId ? boMarchOfBeast(beastById[origId]) : 0;
    });
    function boMarchEligible(s, b) {
      var floor = slotMarchFloor[s.key] || 0;
      if (floor <= 0) return true;
      return boMarchOfBeast(b) >= floor - 0.0001;
    }

    // Pass 1: compute each slot's impact ceiling (best at-max score among
    // any eligible owned beast) and sort by ceiling descending. March floor
    // applies here too so the ceiling reflects what we can actually reach
    // without reducing march.
    slots.forEach(function(s) {
      var best = 0;
      ownedBeasts.forEach(function(b) {
        if (!boBeastEligibleForSlot(b, s.desc, { maxOut: true })) return;
        if (!boMarchEligible(s, b)) return;
        var sc = boBeastScore(b, 'maxOut', s.desc, playstyle);
        if (sc > best) best = sc;
      });
      s.impactCeiling = best;
    });
    slots.sort(function(a, b) { return b.impactCeiling - a.impactCeiling; });

    // Pass 2: greedy first assignment — highest-impact slot picks first.
    var assignment = {};

    slots.forEach(function(s) {
      var bestBeast = null;
      var bestScore = -Infinity;
      ownedBeasts.forEach(function(b) {
        if (!boBeastEligibleForSlot(b, s.desc, { maxOut: true })) return;
        if (!boMarchEligible(s, b)) return;
        var sc = boBeastScore(b, 'maxOut', s.desc, playstyle);
        if (!bestBeast) { bestScore = sc; bestBeast = b; return; }
        var diff = sc - bestScore;
        if (diff > BO_TIEBREAK_EPSILON) {
          bestScore = sc; bestBeast = b;
        } else if (Math.abs(diff) <= BO_TIEBREAK_EPSILON &&
                   boBeastTiebreak(b) > boBeastTiebreak(bestBeast)) {
          bestScore = sc; bestBeast = b;
        }
      });
      if (bestBeast) assignment[s.key] = bestBeast.id;
    });

    // Pass 3: conflict resolution. If a beast was assigned to multiple slots,
    // keep it on the slot with the largest marginal gain over the next-best
    // available beast; the losing slots re-pick from beasts that aren't yet
    // single-claimed.
    var maxIters = 36;
    for (var iter = 0; iter < maxIters; iter++) {
      var counts = {};
      Object.keys(assignment).forEach(function(k) {
        var bId = assignment[k];
        counts[bId] = (counts[bId] || 0) + 1;
      });
      var conflicts = Object.keys(counts).filter(function(bId) { return counts[bId] > 1; });
      if (!conflicts.length) break;

      conflicts.forEach(function(bId) {
        var contestSlots = slots.filter(function(s) { return assignment[s.key] === bId; });
        var marginals = contestSlots.map(function(s) {
          var b = beastById[bId];
          var score = boBeastScore(b, 'maxOut', s.desc, playstyle);
          var runnerUp = 0;
          ownedBeasts.forEach(function(other) {
            if (other.id === bId) return;
            if (!boBeastEligibleForSlot(other, s.desc, { maxOut: true })) return;
            if (counts[other.id] === 1) return;
            var sc = boBeastScore(other, 'maxOut', s.desc, playstyle);
            if (sc > runnerUp) runnerUp = sc;
          });
          return { slotKey: s.key, marginal: score - runnerUp };
        });
        marginals.sort(function(a, b) { return b.marginal - a.marginal; });
        marginals.slice(1).forEach(function(m) {
          var s = slots.find(function(x) { return x.key === m.slotKey; });
          if (!s) { delete assignment[m.slotKey]; return; }
          var alreadyClaimed = {};
          Object.keys(assignment).forEach(function(k) {
            if (k !== m.slotKey) alreadyClaimed[assignment[k]] = true;
          });
          var bestBeast = null;
          var bestScore = -Infinity;
          ownedBeasts.forEach(function(other) {
            if (alreadyClaimed[other.id]) return;
            if (!boBeastEligibleForSlot(other, s.desc, { maxOut: true })) return;
            if (!boMarchEligible(s, other)) return;
            var sc = boBeastScore(other, 'maxOut', s.desc, playstyle);
            if (!bestBeast) { bestScore = sc; bestBeast = other; return; }
            var diff = sc - bestScore;
            if (diff > BO_TIEBREAK_EPSILON) {
              bestScore = sc; bestBeast = other;
            } else if (Math.abs(diff) <= BO_TIEBREAK_EPSILON &&
                       boBeastTiebreak(other) > boBeastTiebreak(bestBeast)) {
              bestScore = sc; bestBeast = other;
            }
          });
          if (bestBeast) assignment[m.slotKey] = bestBeast.id;
          else delete assignment[m.slotKey];
        });
      });
    }

    // Pass 3.5: no-vacancy enforcement.
    //
    // Hard invariant from Tex: a previously-filled slot must stay filled.
    // Pass 2/3 can produce assignments that leave a slot empty when the
    // bench has no eligible alternative — typically when the only eligible
    // beast for slot A is also the best for higher-impact slot B, so the
    // beast moves to B and A is stranded with no backfill candidate.
    // Walk the slot list and revert any such stranding by restoring the
    // original beast at the vacated slot, evicting it from wherever it
    // landed. Iterate because reverting one slot can cascade into another.
    var vacancyIters = slots.length + 4;
    for (var vIter = 0; vIter < vacancyIters; vIter++) {
      var didRevert = false;
      for (var vi = 0; vi < slots.length; vi++) {
        var vs = slots[vi];
        var vsOrig = currentPlan[vs.fieldType] && currentPlan[vs.fieldType][vs.order];
        if (!vsOrig) continue;            // slot was empty originally — empty stays empty
        if (assignment[vs.key]) continue; // slot has an assignment — fine
        // Slot was filled and is now stranded. Restore the original beast.
        var holderKey = null;
        var aKeys = Object.keys(assignment);
        for (var ak = 0; ak < aKeys.length; ak++) {
          if (assignment[aKeys[ak]] === vsOrig) { holderKey = aKeys[ak]; break; }
        }
        if (holderKey) delete assignment[holderKey];
        assignment[vs.key] = vsOrig;
        didRevert = true;
      }
      if (!didRevert) break;
    }

    // Pass 4: field-condition awareness.
    //
    // Each slot has a 1:1 unlock condition (see boConditionIdForSlot). When a
    // condition is unmet, the slot's RARITY BONUS deactivates - the slot
    // stays filled and the beast's main / sub buffs still count, but the
    // rarity bonus contributes nothing. Pass 5 picks this up automatically
    // because boBeastScore receives the proposed-plan condition map and
    // subtracts the rarity bonus when conditionMet is false. We do NOT
    // hard-revert a field: the natural score comparison in Pass 5 already
    // filters out swaps where the lost rarity bonus outweighs the gain, and
    // Tex's rule is "a filled slot stays filled; the only cost of breaking a
    // condition is the deactivated rarity bonus."
    var proposedPlan = {};
    Object.keys(currentPlan).forEach(function(fid) {
      proposedPlan[fid] = {};
      Object.keys(currentPlan[fid] || {}).forEach(function(order) {
        var key = fid + ':' + order;
        proposedPlan[fid][order] = assignment[key] || null;
      });
    });
    var currentCondMet  = boBuildConditionMetMap(currentPlan,  ownedBeasts) || {};
    var proposedCondMet = boBuildConditionMetMap(proposedPlan, ownedBeasts) || {};
    var newActive = boComputeActiveConditions(proposedPlan, ownedBeasts);
    var newActiveSet = {};
    newActive.forEach(function(c) { newActiveSet[c.fieldId + ':' + c.conditionId] = true; });

    // Same-type / same-rarity swap predicate. Per Tex 2026-05-18: if the
    // proposed beast matches the current beast on both type AND rarity, the
    // player can star-up the new beast with 1★ same-type, same-rarity fodder
    // until it reaches the current beast's exact specs. For warning purposes
    // (threshold + condition-break), these swaps should be silent — the slot
    // will never actually lose its rarity bonus or fail a star/rarity gate.
    function isInterchangeableSwap(origId, newId) {
      if (!origId || !newId || origId === newId) return false;
      var ob = beastById[origId], nb = beastById[newId];
      if (!ob || !nb) return false;
      return ob.type === nb.type && ob.q === nb.q;
    }

    // Build a virtualized proposed plan for the condition-warning check that
    // pretends every interchangeable swap is still the current beast. This
    // means slot-unlock conditions stay met under the proposed plan when the
    // only thing changing is which specific same-type, same-rarity beast
    // sits there, since the player can level the new one up. Scoring still
    // uses the real proposedCondMet — only the warning path uses this view.
    var virtualPlanForWarnings = {};
    Object.keys(proposedPlan).forEach(function(fid) {
      virtualPlanForWarnings[fid] = {};
      Object.keys(proposedPlan[fid] || {}).forEach(function(order) {
        var origId = currentPlan[fid] && currentPlan[fid][order];
        var newId = proposedPlan[fid][order];
        virtualPlanForWarnings[fid][order] = isInterchangeableSwap(origId, newId) ? origId : newId;
      });
    });
    var warningCondMet = boBuildConditionMetMap(virtualPlanForWarnings, ownedBeasts) || {};

    // brokeMap[slotKey] = ['Field N Slot M', ...] for every slot whose
    // unlock condition flipped from met to unmet under the proposed plan.
    // We tag every CHANGED slot in the affected field, not just the gated
    // slot itself, because the player needs to see "this rec deactivates
    // Slot Y" on the rec card for the slot they're swapping (which may be
    // a different slot in the same field). Surfaced via short field+slot
    // labels - the raw condition text ("deploy 4 Legendary...") was
    // confusing because it described the requirement, not which slot
    // dropped its rarity bonus.
    var brokeMap = {};
    Object.keys(currentCondMet).forEach(function(slotKey) {
      if (currentCondMet[slotKey] === false) return;
      // Use warningCondMet here (built from virtualPlanForWarnings) so an
      // interchangeable same-type, same-rarity swap doesn't spuriously flip
      // a condition unmet just because the new beast is 1★ Lv1 today — the
      // player can level it back to the current beast's specs.
      if (warningCondMet[slotKey] !== false) return;
      var parts = slotKey.split(':');
      var fid = Number(parts[0]);
      var order = Number(parts[1]);
      var cid = boConditionIdForSlot(fid, order);
      var cond = cid != null && boFieldConditions ? boFieldConditions[cid] : null;
      var reqText = cond ? (cond.descRendered || cond.descLoc || '') : '';
      var label = { fieldId: fid, slotOrder: order, slotLabel: 'Field ' + fid + ' Slot ' + order, reqText: reqText };
      // Tag every slot in the affected field whose swap is NOT interchangeable
      // — the actual responsibility for the break belongs to a real beast
      // change, not a same-type, same-rarity reshuffle.
      slots.filter(function(s) { return s.fieldType === fid; }).forEach(function(s) {
        var orig = currentPlan[fid] && currentPlan[fid][s.order];
        if (!orig) return;
        if (assignment[s.key] === orig) return;
        if (isInterchangeableSwap(orig, assignment[s.key])) return;
        brokeMap[s.key] = (brokeMap[s.key] || []).concat([label]);
      });
    });

    // Pass 5: build the recommendation list as net-positive MOVE CHAINS.
    //
    // The target `assignment` is already a complete plan — Pass 3.5 guarantees
    // every originally-filled slot stays filled. The danger is that a beast can
    // move FROM one deployed slot TO another (it scores better there), which
    // vacates its origin and forces a backfill. The old logic scored each slot
    // in isolation and dropped any slot whose own gain was non-positive, which
    // HID those backfill legs: the player was told "put X in slot B", pulled X
    // out of slot A, and slot A went empty — and the whole reshuffle could even
    // be a net loss. Tex's rule: a move is only worth recommending when the
    // SUMMED gain across every slot it touches is positive, and a move must
    // never be surfaced without its backfill.
    //
    // Approach: diff current vs target, group the changed slots into connected
    // "chains" (slot X links to slot Y when X's incoming beast currently sits
    // in slot Y), score each chain as a whole, and emit a chain only when its
    // net gain clears the bar. Every leg of an emitted chain is shown — even a
    // backfill leg whose own delta is negative — so no slot is ever stranded.
    // Singleton chains (a bench beast filling one slot) collapse to the old
    // per-slot behavior.

    // Current slot of each currently-deployed beast, for chain linking.
    var curSlotOfBeast = {};
    Object.keys(currentPlan).forEach(function(fid) {
      Object.keys(currentPlan[fid] || {}).forEach(function(order) {
        var bId = currentPlan[fid][order];
        if (bId) curSlotOfBeast[bId] = fid + ':' + order;
      });
    });

    // Score one changed slot ("leg"). Mirrors the prior per-slot computation:
    // both states for both beasts, condition-aware, with upgrade threshold +
    // bench-fodder feasibility attached. Returns null for unchanged / empty.
    // gainAtMax compares max-vs-max so "swap Lion 3* Lv70 for Lion 5* Lv80"
    // collapses to ~0 when the two beasts are structurally equivalent.
    function boScoreLeg(s) {
      var origId = currentPlan[s.fieldType] && currentPlan[s.fieldType][s.order];
      var newId = assignment[s.key];
      if (!newId || origId === newId) return null;
      var origBeast = origId ? beastById[origId] : null;
      var newBeast = beastById[newId];
      if (!newBeast) return null;

      var slotKey = s.fieldType + ':' + s.order;
      var curMet = currentCondMet[slotKey] !== false;
      var newMet = proposedCondMet[slotKey] !== false;
      var scoreNowCur = origBeast ? boBeastScore(origBeast, 'current', s.desc, playstyle, curMet) : 0;
      var scoreNowNew = boBeastScore(newBeast, 'current', s.desc, playstyle, newMet);
      var scoreMaxCur = origBeast ? boBeastScore(origBeast, 'maxOut', s.desc, playstyle, curMet) : 0;
      var scoreMaxNew = boBeastScore(newBeast, 'maxOut', s.desc, playstyle, newMet);

      var threshold = null;
      // Interchangeable swaps (same type + same rarity as the current beast)
      // don't need a threshold warning: the player can fodder the new beast
      // up to the current beast's exact specs with 1★ same-type, same-rarity
      // beasts, so the slot's stat ceiling never regresses during the swap.
      if (scoreNowNew <= scoreNowCur && !isInterchangeableSwap(origId, newId)) {
        threshold = boUpgradeThreshold(newBeast, scoreNowCur, s.desc, playstyle, newMet);
      }
      // Bench-fodder feasibility for the recommended star upgrade. Per Tex's
      // 2026-05-18 clarification: a beast can only be star-upgraded by sacrificing
      // 1★ beasts of the SAME type AND SAME rarity (bear-bear, lion-lion, etc.).
      // Higher-star beasts on the bench aren't eligible fodder — they're either
      // worth deploying or worth saving. We also exclude beasts the proposed
      // plan commits to slots, plus the new beast itself.
      if (threshold && threshold.starsFromCurrent > 0) {
        var fodderNeeded = boFodderForStarUp(newBeast.st || 0, threshold.star);
        var deployedAfter = {};
        Object.keys(assignment).forEach(function(k) { deployedAfter[assignment[k]] = true; });
        var fodderHave = ownedBeasts.filter(function(b) {
          return b.q === newBeast.q
              && b.type === newBeast.type
              && (b.st || 0) <= 1
              && !deployedAfter[b.id]
              && b.id !== newBeast.id;
        }).length;
        threshold.fodderNeeded = fodderNeeded;
        threshold.fodderHave = fodderHave;
        threshold.fodderFeasible = fodderHave >= fodderNeeded;
      }

      return {
        s: s, key: s.key, origId: origId, newId: newId,
        from: origBeast, to: newBeast,
        gainToday: scoreNowNew - scoreNowCur,
        gainAtMax: scoreMaxNew - scoreMaxCur,
        threshold: threshold,
        brokeConditions: brokeMap[s.key] || []
      };
    }

    var legs = [];
    var legByKey = {};
    slots.forEach(function(s) {
      var leg = boScoreLeg(s);
      if (leg) { legs.push(leg); legByKey[s.key] = leg; }
    });

    // Union-find over changed-slot keys. Link a leg to the current slot of its
    // incoming beast: a move A->B (B's new beast currently sits at A) joins
    // slots A and B into one chain. Cycles (A->B->C->A) and paths (bench->A,
    // A's beast->B, B's beast->bench) both fall out of this single edge rule.
    var parent = {};
    function boFind(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function boUnion(a, b) { var ra = boFind(a), rb = boFind(b); if (ra !== rb) parent[ra] = rb; }
    legs.forEach(function(leg) { parent[leg.key] = leg.key; });
    legs.forEach(function(leg) {
      var src = curSlotOfBeast[leg.newId];
      if (src && src !== leg.key && legByKey[src]) boUnion(leg.key, src);
    });

    // Aggregate legs into chains and sum each chain's net gain.
    var chains = {};
    legs.forEach(function(leg) {
      var root = boFind(leg.key);
      var c = chains[root] || (chains[root] = { legs: [], today: 0, max: 0 });
      c.legs.push(leg);
      c.today += leg.gainToday;
      c.max += leg.gainAtMax;
    });

    // Emit only chains whose summed gain clears the bar, and emit EVERY leg of
    // an emitted chain so no slot is stranded. Gate: the chain must improve the
    // durable MAX-OUT total (net > 0.5). We deliberately do NOT recommend
    // "better today / flat-or-worse at max-out" shuffles — they net ~0 once
    // everything is leveled, so a multi-leg chain there is just busywork (this
    // is what produced the confusing "net +0 pts at max-out" recs). Upgrade
    // paths (worse today, better at max) still pass because their max-out net
    // is positive; their per-leg threshold tells the player what to level.
    var recs = [];
    var chainSeq = 0;
    Object.keys(chains).forEach(function(root) {
      var c = chains[root];
      if (c.max <= 0.5) return;
      chainSeq += 1;
      var multi = c.legs.length > 1;
      c.legs.forEach(function(leg) {
        // A leg is a "backfill" when it only exists to keep a vacated slot
        // filled: part of a multi-leg chain and not a standalone win itself.
        var isBackfill = multi && leg.gainAtMax <= 0.5 && leg.gainToday <= 0.5;
        recs.push({
          slot: { fieldType: leg.s.fieldType, order: leg.s.order, holeId: leg.s.desc.holeId },
          from: leg.from,
          to: leg.to,
          gainToday: leg.gainToday,
          gainAtMax: leg.gainAtMax,
          threshold: leg.threshold,
          brokeConditions: leg.brokeConditions,
          chainId: chainSeq,
          chainSize: c.legs.length,
          chainNetToday: c.today,
          chainNetMax: c.max,
          isBackfill: isBackfill
        });
      });
    });

    return {
      recommendations: recs,
      totalGainToday: recs.reduce(function(sum, r) { return sum + r.gainToday; }, 0),
      totalGainAtMax: recs.reduce(function(sum, r) { return sum + r.gainAtMax; }, 0),
      conditionWarnings: activeConditions.filter(function(c) {
        return !newActiveSet[c.fieldId + ':' + c.conditionId];
      })
    };
  }

  function boUpgradeThreshold(newBeast, targetScore, slotDesc, playstyle, conditionMet) {
    var maxStar = boMaxStarFor(newBeast);
    var maxLv = boMaxLevelFor(newBeast);
    var curStar = newBeast.st || 0;
    var curLv = newBeast.lv || 0;
    for (var s = curStar; s <= maxStar; s++) {
      var lvStart = s === curStar ? curLv : 0;
      for (var l = lvStart; l <= maxLv; l++) {
        var projected = Object.assign({}, newBeast, { st: s, lv: l });
        var sc = boBeastScore(projected, 'current', slotDesc, playstyle, conditionMet);
        if (sc > targetScore) {
          return {
            star: s,
            level: l,
            starsFromCurrent: s - curStar,
            levelsFromCurrent: s === curStar ? (l - curLv) : (l + (maxLv - curLv))
          };
        }
      }
    }
    return null;
  }

  function boBeastStatProfile(beast, atState, playstyle, slot) {
    var out = { atk: 0, hp: 0, def: 0, dmgInc: 0, dmgDec: 0, march: 0 };
    if (!beast) return out;
    var star = atState === 'maxOut' ? boMaxStarFor(beast) : (beast.st || 0);
    var level = atState === 'maxOut' ? boMaxLevelFor(beast) : (beast.lv || 0);
    var pot = beast.pot || 0;
    function add(buffId, isMain) {
      if (!buffId) return;
      var cls = boClassifyBuff(buffId, isMain);
      if (!cls || cls.statKey === 'elemental') return;
      var raw = ebComputeBuffValue(buffId, star, level, pot, isMain);
      if (raw == null) return;
      var weighted = raw * BO_SCOPE_MULT[cls.scope] * boPlaystyleMult(cls.targetUnit, playstyle);
      if (out[cls.statKey] == null) out[cls.statKey] = 0;
      out[cls.statKey] += weighted;
    }
    if (beast.mb) add(beast.mb, true);
    (beast.bb || []).forEach(function(bid) { add(bid, false); });
    // Add the slot's rarity bonus contribution per stat so the modal delta
    // table reflects the same scoring the optimizer uses to rank the beast.
    if (slot) {
      var rb = boRarityBonusBreakdown(beast, slot, atState, playstyle);
      Object.keys(rb).forEach(function(k) {
        if (out[k] != null) out[k] += rb[k];
      });
    }
    return out;
  }

  /* ---- not from the page ---- */
  function sync() { boFieldConditions = core.getFieldConditions(); }

  /* The computation half of the page's boRenderPlan, in the same order: resolve, flatten, plan, conditions, enhance levels, TG links, optimize.
     `bench` is the bench supplement (or null), `prefs` the playstyle {mode, units, balance, weights}. */
  function plan(merged, bench, prefs, siteKey) {
    sync();
    var resolved = core.ebResolveBeasts((merged && merged.enigmas) || {});
    var owned = boBuildOwnedBeasts(merged, bench, resolved);
    var currentPlan = boBuildCurrentPlan(resolved);
    var active = boComputeActiveConditions(currentPlan, owned);
    var playerEnhance = core.boReadPlayerEnhance(merged, siteKey) || {};
    var tgRefinementByHole = core.boReadTgRefinement(merged, siteKey) || {};
    var result = boOptimize(owned, currentPlan, active, prefs, playerEnhance, tgRefinementByHole);
    return { resolved: resolved, owned: owned, currentPlan: currentPlan, result: result };
  }
  function statProfile(beast, atState, prefs, slot) { return boBeastStatProfile(beast, atState, prefs, slot); }
  function wrap(f) { return function () { sync(); return f.apply(null, arguments); }; }

  return {
    plan: plan, statProfile: wrap(statProfile),
    boBuildOwnedBeasts: wrap(boBuildOwnedBeasts), boBuildCurrentPlan: boBuildCurrentPlan, boConditionIdForSlot: boConditionIdForSlot,
    boConditionMatches: boConditionMatches, boBuildConditionMetMap: wrap(boBuildConditionMetMap), boComputeActiveConditions: wrap(boComputeActiveConditions),
    boBeastEligibleForSlot: boBeastEligibleForSlot, boSlotDescriptor: wrap(boSlotDescriptor), boOptimize: wrap(boOptimize),
    boUpgradeThreshold: wrap(boUpgradeThreshold), boBeastStatProfile: wrap(boBeastStatProfile)
  };
}

var api = { create: create };
root.ArmoryBeastsOpt = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
