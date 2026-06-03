#!/usr/bin/env python3
"""R12.5 enrichment — focused on NC defense for the final wasteland cycle.

R12.5 is the LAST wasteland declaration round this week. After it resolves,
NC battles happen. So the threat model collapses:

  * 1-hop: enemy already owns a cell 4-adjacent to our NC. They will
    declare on our NC directly at the NC battle. We can't stop them via
    a wasteland win — we only defend at the NC battle itself.

  * 2-hop: enemy will gain 1-hop on our NC IF they WIN a neutral
    wasteland adjacent to our NC this round. Block by either winning
    that wasteland ourselves (we already declared it) or by knowing
    which adjacencies are vulnerable.

3-hop is no longer reachable (no second wasteland round to chain through).

Per Tex's R12.5 directive: focus on Lv.3 NCs (the prized targets) plus
Lv.2 NCs as secondary defense.

Also generates:
  * contestedRanked  — drives the contested-fights view (41 contested
    declarations this round, mostly vs S386, S2197, S2253)
  * ncCaptureFlow    — what enemy NCs we can attack at the NC battle
  * focusOverrides   — must-win pin list (leave empty for now; alliance
    can override)
  * No nextRoundCombatUnlocks (isLastWastelandCycle=true)
"""
import json
import re
from pathlib import Path
from collections import defaultdict

DATA = Path('/Users/shivabezwada/tw-projects/landing-page/data/ssc-map.json')
OWN_SID = 2864
ROUND_KEY = '12.5'

SPEC_NAMES = {4001:"ATK Buff",4002:"Truck Transport",4003:"Truck Heist",4004:"Mining Hub",4006:"HP Buff",4007:"DMG Increase",4008:"DMG Reduction",4010:"DEF Buff",4015:"Daily Tasks",4016:"Seal Stone Train",4017:"Realm",4018:"Realm Thief",4080:"Treasury Reward"}
SPEC_CAT = {4001:"combat",4006:"combat",4007:"combat",4008:"combat",4010:"combat",4002:"economy",4003:"economy",4004:"economy",4015:"economy",4016:"utility",4017:"utility",4018:"utility",4080:"special"}
SPEC_TO_EFFECT = {"4001":11001,"4006":11002,"4007":11003,"4008":11004,"4010":11006,"4002":11011,"4003":11012,"4015":11017,"4080":11080,"4004":11026,"4016":11020,"4017":11023,"4018":11015}
LV3_CONTRIB = {
    4001: {11001: 27000}, 4006: {11002: 27000}, 4007: {11003: 4500},
    4008: {11004: 4500}, 4010: {11006: 1500},
    4002: {11011: 3}, 4003: {11012: 3}, 4015: {11017: 6}, 4080: {11080: 1},
    4004: {11026: 500, 11013: 1, 11014: 1},
    4016: {11020: 1, 11021: 2, 11022: 1},
    4017: {11023: 3000, 11024: 1},
    4018: {11015: 1000, 11016: 3000},
}

def wseq(cell):
    name = cell.get('name') or ''
    m = re.search(r'#(\d+)', name)
    return int(m.group(1)) if m else None

def adj4(rc, nrows, ncols, grid):
    out = []
    for dr, dc in ((-1,0),(1,0),(0,-1),(0,1)):
        nr, nc = rc[0]+dr, rc[1]+dc
        if (nr, nc) in grid:
            out.append((nr, nc))
    return out

def main():
    data = json.loads(DATA.read_text())
    r = data['rounds'][ROUND_KEY]
    cells = r['cells']
    grid = {(c['r'], c['c']): c for c in cells}
    nrows = max(c['r'] for c in cells) + 1
    ncols = max(c['c'] for c in cells) + 1

    own_cells = set((c['r'], c['c']) for c in cells if c.get('sid') == OWN_SID)
    declared_seqs = {w['seq'] for w in r.get('warTargets', [])}
    seq_to_cell = {}
    for c in cells:
        if c.get('type') == 3:
            s = wseq(c)
            if s: seq_to_cell[s] = c

    # ── NC threat analysis (L3-first, L2-second) ─────────────────
    # For each of our NCs, find:
    #   direct[]  : sids who own a cell 4-adjacent to the NC (1-hop now,
    #               unblockable via wasteland win — defend at NC battle)
    #   setup[]   : per neutral wasteland 4-adjacent to NC, the sids that
    #               could win it this round (we don't know whose declared
    #               there, but any enemy with a cell 4-adjacent to it could
    #               have declared). We do know if WE declared.
    own_l23 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) >= 2]
    nc_threat = []
    for nc in own_l23:
        nc_rc = (nc['r'], nc['c'])
        direct = []
        setup_blockers = []
        for nb in adj4(nc_rc, nrows, ncols, grid):
            ncell = grid[nb]
            if ncell.get('type') == 1 or ncell.get('type') == 3:
                # Cell that, if hostile-owned, gives 1-hop direct threat
                sid = ncell.get('ownerSid') or ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({
                        'sid': sid,
                        'sourceCell': {
                            'r': ncell['r'], 'c': ncell['c'],
                            'type': ncell['type'],
                            'name': ncell.get('name'),
                            'specId': ncell.get('specId'),
                            'landType': ncell.get('landType'),
                        }
                    })
                elif ncell.get('type') == 3 and (sid == 0):
                    # Neutral wasteland adj to NC → setup-threat candidate.
                    # Anyone who could declare on it = 2-hop attacker.
                    w_seq = wseq(ncell)
                    we_declared = w_seq in declared_seqs
                    # Find sids with cells 4-adjacent to this wasteland (so
                    # they had reach to declare on it this round)
                    threat_sids = set()
                    for nbnb in adj4((ncell['r'], ncell['c']), nrows, ncols, grid):
                        nb_cell = grid[nbnb]
                        nb_sid = nb_cell.get('ownerSid') or nb_cell.get('sid') or 0
                        if nb_sid and nb_sid != OWN_SID:
                            threat_sids.add(nb_sid)
                    setup_blockers.append({
                        'seq': w_seq, 'r': ncell['r'], 'c': ncell['c'],
                        'specId': ncell.get('specId'),
                        'landType': ncell.get('landType'),
                        'landCat': ncell.get('landCat'),
                        'weDeclared': we_declared,
                        'threateningSids': sorted(threat_sids),
                    })
            elif ncell.get('type') == 2:
                # Adjacent NC — hostile NC means 1-hop too
                sid = ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({
                        'sid': sid,
                        'sourceCell': {
                            'r': ncell['r'], 'c': ncell['c'],
                            'type': ncell['type'],
                            'name': ncell.get('name'),
                            'level': ncell.get('level'),
                        }
                    })
        # Threat tier
        tier = 'NONE'
        if direct: tier = 'HIGH'
        elif any(b['threateningSids'] and not b['weDeclared'] for b in setup_blockers): tier = 'MEDIUM'
        elif any(b['threateningSids'] for b in setup_blockers): tier = 'LOW'
        # Count uncontested-by-us setup risks
        uncovered_blockers = [b for b in setup_blockers if b['threateningSids'] and not b['weDeclared']]
        # ── Backward-compat schema for existing renderer (hex hub viz) ──
        # Map new fields back to legacy ones: threats[] = direct (dist=1) +
        # setup blocker entries flattened per (sid, blocker) as dist=2.
        # blockerWastelands = the same setup-blocker cells the renderer
        # expects to highlight as "claim to block".
        threats_legacy = []
        for d in direct:
            threats_legacy.append({
                'sid': d['sid'], 'dist': 1,
                'hopLabel': '1-hop DIRECT',
                'intermediates': [],
            })
        for b in setup_blockers:
            if not b['threateningSids']: continue
            interm_desc = [{
                'r': b['r'], 'c': b['c'], 'seq': b['seq'],
                'type': 3, 'specId': b['specId'],
                'landType': b['landType'], 'landCat': b['landCat'],
            }]
            for sid in b['threateningSids']:
                threats_legacy.append({
                    'sid': sid, 'dist': 2,
                    'hopLabel': '2-hop (needs to win W-{0} this round)'.format(b['seq']),
                    'intermediates': interm_desc,
                    'weDeclared': b['weDeclared'],
                })
        threats_legacy.sort(key=lambda t: (t['dist'], t['sid']))
        blocker_legacy = [
            {'r': b['r'], 'c': b['c'], 'seq': b['seq'],
             'specId': b['specId'], 'landType': b['landType'],
             'landCat': b['landCat'], 'weDeclared': b['weDeclared']}
            for b in setup_blockers if b['threateningSids']
        ]
        adj_wls_legacy = []
        adj_ncs_legacy = []
        for nb in adj4(nc_rc, nrows, ncols, grid):
            ncell = grid[nb]
            if ncell.get('type') == 3:
                adj_wls_legacy.append({
                    'seq': wseq(ncell), 'r': ncell['r'], 'c': ncell['c'],
                    'specId': ncell.get('specId'),
                    'landType': ncell.get('landType'),
                    'landCat': ncell.get('landCat'),
                    'ownerSid': ncell.get('ownerSid', 0),
                    'neutral': ncell.get('ownerSid', 0) == 0,
                })
            elif ncell.get('type') == 2:
                adj_ncs_legacy.append({
                    'name': ncell.get('name'),
                    'level': ncell.get('level'),
                    'ownerSid': ncell.get('ownerSid', 0) or ncell.get('sid', 0),
                    'r': ncell['r'], 'c': ncell['c'],
                })

        nc_threat.append({
            'name': nc.get('name'),
            'level': nc.get('level'),
            'r': nc['r'], 'c': nc['c'],
            'threatTier': tier,
            # New schema
            'directThreats': direct,
            'setupBlockers': setup_blockers,
            'uncoveredBlockerCount': len(uncovered_blockers),
            'directThreatCount': len(direct),
            'setupThreatCount': sum(1 for b in setup_blockers if b['threateningSids']),
            # Legacy schema (so existing hex viz + threat counts render)
            'threatCount': len(threats_legacy),
            'twoHopCount': sum(1 for t in threats_legacy if t['dist'] == 2),
            'threeHopCount': 0,
            'threats': threats_legacy,
            'adjacentWastelands': adj_wls_legacy,
            'adjacentNCs': adj_ncs_legacy,
            'blockerWastelands': blocker_legacy,
        })
    # Sort: L3 first, then by tier severity, then by uncovered blocker count desc
    tier_rank = {'HIGH':0,'MEDIUM':1,'LOW':2,'NONE':3}
    nc_threat.sort(key=lambda x: (-x['level'], tier_rank[x['threatTier']], -x['uncoveredBlockerCount']))

    # ── contestedRanked ─────────────────────────────────────────
    power_by_sid = {p['sid']: p for p in r.get('sectorPower', [])}
    card_by_sid = {c['sid']: c for c in r.get('sectorServerCards', [])}
    # Top-level sectorPower/sectorServerCards may not exist on R12.5 yet
    # (it's copied/inherited from the most recent extraction). If absent,
    # look at R12 for fallback.
    if not power_by_sid:
        r12 = data['rounds'].get('12', {})
        power_by_sid = {p['sid']: p for p in r12.get('sectorPower', [])}
        card_by_sid = {c['sid']: c for c in r12.get('sectorServerCards', [])}
        # Also carry forward sector intel to R12.5 so the page doesn't lose it
        r['sectorPower'] = r12.get('sectorPower', [])
        r['sectorServerCards'] = r12.get('sectorServerCards', [])
        if 'rankingCoverage' in r12: r['rankingCoverage'] = r12['rankingCoverage']

    contested_ranked = []
    for w in r.get('warTargets', []):
        others = w.get('contestedBy') or []
        if not others: continue
        is3way = len(w.get('fightSids', [])) >= 3
        for opp_sid in others:
            pw = power_by_sid.get(opp_sid, {})
            cd = card_by_sid.get(opp_sid, {})
            contested_ranked.append({
                'seq': w['seq'], 'level': w.get('level'), 'specId': w.get('specId'),
                'opponent': opp_sid,
                'tier': pw.get('tier', 'C'),
                'sectorRank': pw.get('sectorRank', 0),
                'opFame': cd.get('fame', 0),
                'opScore': pw.get('score', 0),
                'opPI': pw.get('powerIndex', 0.0),
                'is3way': is3way,
            })
    contested_ranked.sort(key=lambda x: (-(x['opPI'] or 0), x['seq']))
    r['contestedRanked'] = contested_ranked
    distinct = len({c['seq'] for c in contested_ranked})
    if r.get('s2864'): r['s2864']['contestedDeclarations'] = distinct

    # ── NC capture flow (which enemy NCs we can attack at NC battle) ──
    # 1-hop NCs = enemy NCs 4-adjacent to one of our owned cells.
    # The "viaWastelands" path is also relevant: enemy NCs 4-adjacent to
    # wastelands WE declared this round (we win → 1-hop next).
    nc_capture_flow = []
    declaration_nc_unlocks = defaultdict(list)
    nc_by_rc = {(c['r'], c['c']): c for c in cells if c.get('type') == 2}
    for rc, nc in nc_by_rc.items():
        sid = nc.get('sid') or 0
        if sid == 0 or sid == OWN_SID: continue
        via_owned = []; via_wls = []
        for nb in adj4(rc, nrows, ncols, grid):
            n2 = grid[nb]
            if n2.get('type') == 2 and n2.get('sid') == OWN_SID:
                via_owned.append(n2.get('name') or '')
            elif n2.get('type') == 3:
                s = wseq(n2)
                if s in declared_seqs:
                    via_wls.append(s)
                    declaration_nc_unlocks[s].append(nc.get('name') or '')
            elif n2.get('type') == 3 and n2.get('ownerSid') == OWN_SID:
                # If we already own an adjacent wasteland from R12
                via_owned.append(f'W-{wseq(n2)}' if wseq(n2) else 'wasteland')
        if not via_owned and not via_wls: continue
        nc_capture_flow.append({
            'nc': nc.get('name') or '',
            'r': rc[0], 'c': rc[1],
            'sid': sid,
            'level': str(nc.get('level') or 1),
            'viaWastelands': sorted(set(via_wls)),
            'viaOwnedNCs': list(dict.fromkeys(via_owned)),
        })
    nc_capture_flow.sort(key=lambda x: (-int(x['level'] or 1), 0 if x['viaOwnedNCs'] else 1))
    r['ncCaptureFlow'] = nc_capture_flow
    r['declarationNcUnlocks'] = {str(k): list(dict.fromkeys(v)) for k, v in declaration_nc_unlocks.items()}

    # ── eligibleTargets / candidatesByCat / strategicRecommendations ──
    # Honor live buffOverview caps from the extraction.
    eligible_by_spec = defaultdict(list)
    for c in cells:
        if c.get('type') != 3 or c.get('ownerSid', 0) != 0: continue
        sp = c.get('specId')
        if sp is None: continue
        eligible_by_spec[sp].append({
            'seq': wseq(c), 'id': c.get('id'),
            'r': c['r'], 'c': c['c'], 'specId': sp,
            'landType': c.get('landType'), 'landCat': c.get('landCat'),
        })
    eligible_targets = {str(sp): v for sp, v in eligible_by_spec.items()}
    candidates_by_cat = defaultdict(int)
    for sp, v in eligible_by_spec.items():
        candidates_by_cat[SPEC_CAT.get(sp, 'special')] += len(v)
    candidates_by_cat = dict(candidates_by_cat)

    effect_to_spec = {}
    for sp, contrib in LV3_CONTRIB.items():
        for eff in contrib: effect_to_spec.setdefault(eff, sp)

    strategic = []
    for b in r.get('buffOverview', []):
        eff = b['effectType']
        sp = effect_to_spec.get(eff)
        if sp is None: continue
        per_l3 = LV3_CONTRIB[sp].get(eff, 0)
        if per_l3 <= 0: continue
        live_max = b.get('rawMax', 0)
        live_cur = b.get('rawCurrent', 0)
        gap = max(0, live_max - live_cur)
        ws_to_max = -(-gap // per_l3) if (per_l3 > 0 and gap > 0) else 0
        strategic.append({
            'effectType': eff, 'description': b.get('description', ''),
            'category': SPEC_CAT.get(sp, 'special'),
            'feedingSpec': sp,
            'feedingSpecName': SPEC_NAMES.get(sp, f'Spec {sp}'),
            'rawCurrent': live_cur, 'rawMax': live_max,
            'rawGap': gap,
            'gapPct': (100.0 * gap / live_max) if live_max > 0 else 0.0,
            'perLv3Contribution': per_l3,
            'wastelandsToMax': ws_to_max,
            'eligibleTargetCount': len(eligible_by_spec.get(sp, [])),
        })
    cat_rank = {'combat':0,'utility':1,'economy':2,'special':3}
    strategic.sort(key=lambda s: (cat_rank.get(s['category'], 9), -s['rawGap']))

    # ── projectedBuffsFromDeclarations ──────────────────────────
    proj = defaultdict(int)
    for w in r.get('warTargets', []):
        conf = LV3_CONTRIB.get(w['specId'], {})
        for eff, val in conf.items():
            proj[eff] += val
    r['projectedBuffsFromDeclarations'] = {str(k): v for k, v in proj.items()}

    # ── r12.5StrategyTargets (alliance picks) ───────────────────
    # NC pillage targets: enemy L3 NCs we can attack at NC battle.
    # Carry forward HARD_NC_TARGETS from R12 if the alliance has them
    # locked in; otherwise auto-derive from ncCaptureFlow (L3 only).
    nc_hard_targets = []
    seen = set()
    # Auto-include any L3 enemy NC in ncCaptureFlow with viaWastelands
    # (a win this round opens the path).
    for nc in nc_capture_flow:
        if int(nc['level']) >= 3:
            m = re.search(r'#(\d+)', nc['nc'] or '')
            ncNum = int(m.group(1)) if m else None
            if not ncNum or ncNum in seen: continue
            seen.add(ncNum)
            pathway = nc['viaWastelands'][:4]
            rationale = f"L3 NC at r{nc['r']}c{nc['c']} owned by S{nc['sid']}."
            if pathway:
                rationale += f" Pathway via W-{' / W-'.join(map(str, pathway))} (win this round → 1-hop at NC battle)."
            if nc['viaOwnedNCs']:
                rationale += f" Adjacent to our {', '.join(nc['viaOwnedNCs'])}."
            nc_hard_targets.append({
                'nc': nc['nc'], 'ncNum': ncNum,
                'r': nc['r'], 'c': nc['c'],
                'level': int(nc['level']),
                'sid': nc['sid'], 'priority': 'lock',
                'pathwayWastelands': pathway,
                'rationale': rationale,
            })

    # ── focusOverrides for R12.5 ────────────────────────────────
    # Tex's R12.5 priority directive:
    #   P1 — secure our L3 NCs (highest priority, defense ring picks)
    #   P2 — secure our L2 NCs (defense ring picks)
    #   P3 — combat buffs everywhere we declared on one
    # Each pinned pick gets a one-line rationale so the alliance knows
    # why it matters.
    own_l3 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) == 3]
    own_l2 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) == 2]
    declared_by_seq = {w['seq']: w for w in r.get('warTargets', [])}
    def _collect_nc_defense(ncs, label):
        rows = []  # (seq, nc_name)
        for nc in ncs:
            for nb in adj4((nc['r'], nc['c']), nrows, ncols, grid):
                cell = grid.get(nb)
                if not cell or cell.get('type') != 3: continue
                sq = wseq(cell)
                if sq and sq in declared_by_seq:
                    rows.append((sq, nc.get('name'), label))
        return rows
    l3_def_rows = _collect_nc_defense(own_l3, 'L3 NC defense')
    l2_def_rows = _collect_nc_defense(own_l2, 'L2 NC defense')
    seen_seq = set()
    pin_order = []  # list of (seq, note)
    for sq, nc_name, _ in l3_def_rows:
        if sq in seen_seq: continue
        seen_seq.add(sq)
        w = declared_by_seq[sq]
        cont = (' contested vs S' + ','.join(map(str, w['contestedBy']))) if w.get('isContested') else ''
        pin_order.append((sq, f'Defends our {nc_name} — neutral wasteland adjacent to it; win to deny enemy chain.{cont}'))
    for sq, nc_name, _ in l2_def_rows:
        if sq in seen_seq: continue
        seen_seq.add(sq)
        w = declared_by_seq[sq]
        cont = (' contested vs S' + ','.join(map(str, w['contestedBy']))) if w.get('isContested') else ''
        pin_order.append((sq, f'Defends our {nc_name} — neutral wasteland adjacent to it.{cont}'))
    # Combat buffs (sort by spec priority then by seq for stability)
    COMBAT_PRI = {4001: 0, 4006: 1, 4007: 2, 4008: 3, 4010: 4}
    COMBAT_LABEL = {4001: 'ATK', 4006: 'HP', 4007: 'DMG Inc', 4008: 'DMG Red', 4010: 'DEF'}
    combat_remaining = []
    for sq, w in declared_by_seq.items():
        if sq in seen_seq: continue
        if w.get('specId') in COMBAT_PRI:
            combat_remaining.append(w)
    combat_remaining.sort(key=lambda w: (COMBAT_PRI[w['specId']], w['seq']))
    for w in combat_remaining:
        seen_seq.add(w['seq'])
        cont = (' contested vs S' + ','.join(map(str, w['contestedBy']))) if w.get('isContested') else ''
        pin_order.append((w['seq'], f'Combat buff ({COMBAT_LABEL[w["specId"]]}) — fills the sector cap.{cont}'))

    focus_overrides = {
        'alliancePriority': [sq for sq, _ in pin_order],
        'pinTop': [],
        'demote': [],
        'seqNotes': {str(sq): note for sq, note in pin_order},
    }

    # Strategy targets — combatBuffSetupSeqs derived from our declarations
    combat_buff_setup = sorted({w['seq'] for w in r.get('warTargets', [])
                                  if w.get('specId') in (4001,4006,4007,4008,4010)})

    r['r12.5StrategyTargets'] = {
        'note': (
            'R12.5 is the LAST wasteland declaration cycle this week. After '
            'these fights resolve, neutral city battles happen. Focus: '
            'block enemies from reaching our L3 NCs (NC Threats section). '
            'Our 60 declarations cover combat fill + pathways into enemy '
            'L3 NCs #3003 (S386) and #3008 (S386). 41 contested fights — '
            'S386 is the main resister, contesting most of our #3008 push.'
        ),
        'combatBuffSetupSeqs': combat_buff_setup,
        'ncTargets': nc_hard_targets,
        'curated': [],
        'auto1Hop': [],
        'auto2Hop': [],
    }

    # Top-level ncTargets (drives Pillage section)
    r['ncTargets'] = [
        {'nc': t['nc'], 'ncNum': t['ncNum'], 'level': t['level'],
         'sid': t['sid'], 'pathwayWastelands': t['pathwayWastelands'],
         'rationale': t['rationale']}
        for t in nc_hard_targets
    ]
    r['ncTargetsRule'] = (
        'Last wasteland round of the week — declarations now set up '
        'Saturday\'s NC battle. One unowned NC per level per week (game rule).'
    )

    # Other planning fields
    r['focusOverrides'] = focus_overrides
    r['eligibleTargets'] = eligible_targets
    r['candidatesByCat'] = candidates_by_cat
    r['strategicRecommendations'] = strategic
    r['specToEffectTypeMap'] = SPEC_TO_EFFECT
    r['ncThreatAnalysis'] = nc_threat
    # No next-round combat unlocks (this IS the last round)
    r['nextRoundCombatUnlocks'] = []
    r['isLastWastelandCycle'] = True

    # Set currentRound so the page loads R12.5 by default
    data['currentRound'] = ROUND_KEY

    DATA.write_text(json.dumps(data, ensure_ascii=False))
    print(f'R12.5 planning written')
    print(f'  ncThreatAnalysis: {len(nc_threat)} NCs')
    direct_total = sum(n['directThreatCount'] for n in nc_threat)
    setup_total = sum(n['setupThreatCount'] for n in nc_threat)
    print(f'    direct threats: {direct_total}, setup threats: {setup_total}')
    print(f'  contestedRanked: {len(contested_ranked)} entries')
    print(f'  ncCaptureFlow: {len(nc_capture_flow)} reachable enemy NCs')
    print(f'  hard NC pillage targets: {len(nc_hard_targets)}')
    print(f'  candidatesByCat: {candidates_by_cat}')

if __name__ == '__main__':
    main()
