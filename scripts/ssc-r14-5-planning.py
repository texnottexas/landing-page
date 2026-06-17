#!/usr/bin/env python3
"""R14.5 enrichment — FINAL wasteland battle of Round 14 (Sector 110).

The first R14 wasteland cycle resolved (we now own 27 wastelands, score 8100,
rank 20). This is the LAST wasteland declaration cycle before the neutral-city
battles, so per Tex's directive the report is deliberately lean:

  * NO buff-cap optimization (no strategicRecommendations / eligibleTargets /
    candidatesByCat / projectedBuffs) — there is no next round to fill caps for.
  * Threats and target NCs are 0-1 hop ONLY:
      - 0-hop (direct): an enemy already owns a cell 4-adjacent to our NC →
        they can declare on it at the NC battle. Unblockable via a wasteland win.
      - 1-hop (setup): an enemy can WIN a neutral wasteland 4-adjacent to our NC
        THIS round → then reach it. Block by winning that wasteland ourselves.
    No deeper chains (no future wasteland round to chain through).
  * sectorPower / sectorServerCards / rankingCoverage are inherited from R14
    (same 36 sector servers + round-13 merit pump; ~2 days old, fine for labels).

Outputs: contestedRanked, enriched warTargets, ncThreatAnalysis (0-1 hop),
ncCaptureFlow (0-1 hop), ncTargets, focusOverrides. isLastWastelandCycle=true.
"""
import json
import re
from pathlib import Path
from collections import defaultdict

DATA = Path('/Users/shivabezwada/tw-projects/landing-page/data/ssc-map.json')
OWN_SID = 2864
ROUND_KEY = '14.5'
INHERIT_KEY = '14'   # sectorPower / sectorServerCards source

SPEC_NAMES = {4001:"ATK Buff",4002:"Truck Transport",4003:"Truck Heist",4004:"Mining Hub",4006:"HP Buff",4007:"DMG Increase",4008:"DMG Reduction",4010:"DEF Buff",4015:"Daily Tasks",4016:"Seal Stone Train",4017:"Realm",4018:"Realm Thief",4080:"Treasury Reward"}
SPEC_CAT = {4001:"combat",4006:"combat",4007:"combat",4008:"combat",4010:"combat",4002:"economy",4003:"economy",4004:"economy",4015:"economy",4016:"utility",4017:"utility",4018:"utility",4080:"special"}

def wseq(cell):
    m = re.search(r'#(\d+)', cell.get('name') or '')
    return int(m.group(1)) if m else None

def nclevel(cell):
    m = re.search(r'Lv\.\s*(\d+)', cell.get('name') or '')
    return int(m.group(1)) if m else None

def adj4(rc, grid):
    out = []
    for dr, dc in ((-1,0),(1,0),(0,-1),(0,1)):
        nb = (rc[0]+dr, rc[1]+dc)
        if nb in grid:
            out.append(nb)
    return out

def main():
    data = json.loads(DATA.read_text())
    r = data['rounds'][ROUND_KEY]
    cells = r['cells']
    grid = {(c['r'], c['c']): c for c in cells}

    # ── Backfill NC level + declared/owned wasteland specId onto cells ──
    for c in cells:
        if c.get('type') == 2:
            lv = nclevel(c)
            if lv is not None: c['level'] = lv
    spec_by_seq = {}
    for w in r.get('warTargets', []): spec_by_seq[w['seq']] = w['specId']
    for seq, ow in r.get('ownedWastelands', {}).items():
        spec_by_seq.setdefault(int(seq), ow.get('specId'))
    for c in cells:
        if c.get('type') == 3:
            s = wseq(c)
            if s in spec_by_seq and spec_by_seq[s] is not None:
                c['specId'] = spec_by_seq[s]

    # ── Inherit sector power / cards from R14 ──
    r14 = data['rounds'].get(INHERIT_KEY, {})
    r['sectorPower'] = r14.get('sectorPower', [])
    r['sectorServerCards'] = r14.get('sectorServerCards', [])
    if 'rankingCoverage' in r14:
        rc = dict(r14['rankingCoverage'])
        rc['inheritedFrom'] = 'R%s (servers + merit pump unchanged this cycle)' % INHERIT_KEY
        r['rankingCoverage'] = rc
    power_by_sid = {p['sid']: p for p in r['sectorPower']}

    # ── Enrich warTargets (contestedBy / isContested / geometry) ──
    cell_by_seq = {wseq(c): c for c in cells if c.get('type') == 3 and wseq(c)}
    for w in r.get('warTargets', []):
        fs = w.get('fightSids') or []
        contested_by = [s for s in fs if s != OWN_SID]
        w['contestedBy'] = contested_by
        w['isContested'] = len(contested_by) > 0
        cell = cell_by_seq.get(w['seq'])
        if cell:
            w['wastelandId'] = cell.get('id'); w['r'] = cell['r']; w['c'] = cell['c']
            w['landType'] = cell.get('landType'); w['landCat'] = cell.get('landCat')

    # ── Enrich defenseTargets (our owned wastelands under attack) ──
    # attackerSids already present from the base build. Add geometry + which
    # of our NCs each defense protects (an adjacent owned NC we'd expose if lost).
    own_nc_cells = [c for c in cells if c.get('type') == 2 and c.get('sid') == OWN_SID]
    def protects_ncs(seq):
        cell = cell_by_seq.get(seq)
        if not cell: return []
        out = []
        for nb in adj4((cell['r'], cell['c']), grid):
            n = grid[nb]
            if n.get('type') == 2 and n.get('sid') == OWN_SID:
                out.append({'name': n.get('name'), 'level': n.get('level'), 'r': n['r'], 'c': n['c']})
        return out
    for d in r.get('defenseTargets', []):
        cell = cell_by_seq.get(d['seq'])
        if cell:
            d['wastelandId'] = cell.get('id'); d['r'] = cell['r']; d['c'] = cell['c']
            d['landType'] = cell.get('landType'); d['landCat'] = cell.get('landCat')
        d.setdefault('attackerSids', [s for s in d.get('fightSids', []) if s != OWN_SID])
        prot = protects_ncs(d['seq'])
        d['protectsNcs'] = prot
        d['protectsNcMaxLevel'] = max([p['level'] or 0 for p in prot], default=0)

    # ── contestedRanked ──
    contested_ranked = []
    for w in r.get('warTargets', []):
        others = w.get('contestedBy') or []
        if not others: continue
        is3way = len(w.get('fightSids', [])) >= 3
        for opp in others:
            pw = power_by_sid.get(opp, {})
            contested_ranked.append({
                'seq': w['seq'], 'level': w.get('level'), 'specId': w.get('specId'),
                'opponent': opp, 'tier': pw.get('tier', 'C'), 'sectorRank': pw.get('sectorRank', 0),
                'opFame': pw.get('score2', 0), 'opScore': pw.get('score', 0),
                'opPI': pw.get('powerIndex', 0.0), 'is3way': is3way})
    contested_ranked.sort(key=lambda x: (-(x['opPI'] or 0), x['seq']))
    r['contestedRanked'] = contested_ranked
    if r.get('s2864'):
        r['s2864']['contestedDeclarations'] = len({c['seq'] for c in contested_ranked})

    # ── NC threat analysis: 0-1 hop only (direct + one-round setup) ──
    declared_seqs = {w['seq'] for w in r.get('warTargets', [])}
    own_l23 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) >= 2]
    nc_threat = []
    for nc in own_l23:
        nc_rc = (nc['r'], nc['c'])
        direct = []           # 0-hop: enemy adjacent now
        setup_blockers = []   # 1-hop: enemy wins an adjacent neutral wasteland this round
        for nb in adj4(nc_rc, grid):
            ncell = grid[nb]; t = ncell.get('type')
            if t in (1, 3):
                sid = ncell.get('ownerSid') or ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({'sid': sid, 'sourceCell': {'r': ncell['r'], 'c': ncell['c'], 'type': t,
                        'name': ncell.get('name'), 'specId': ncell.get('specId'), 'landType': ncell.get('landType')}})
                elif t == 3 and sid == 0:
                    w_seq = wseq(ncell); we_declared = w_seq in declared_seqs
                    threat_sids = set()
                    for nb2 in adj4((ncell['r'], ncell['c']), grid):
                        c2 = grid[nb2]; s2 = c2.get('ownerSid') or c2.get('sid') or 0
                        if s2 and s2 != OWN_SID: threat_sids.add(s2)
                    setup_blockers.append({'seq': w_seq, 'r': ncell['r'], 'c': ncell['c'],
                        'specId': ncell.get('specId'), 'landType': ncell.get('landType'),
                        'landCat': ncell.get('landCat'), 'weDeclared': we_declared,
                        'threateningSids': sorted(threat_sids)})
            elif t == 2:
                sid = ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({'sid': sid, 'sourceCell': {'r': ncell['r'], 'c': ncell['c'], 'type': 2,
                        'name': ncell.get('name'), 'level': ncell.get('level')}})
        tier = 'NONE'
        if direct: tier = 'HIGH'
        elif any(b['threateningSids'] and not b['weDeclared'] for b in setup_blockers): tier = 'MEDIUM'
        elif any(b['threateningSids'] for b in setup_blockers): tier = 'LOW'
        uncovered = [b for b in setup_blockers if b['threateningSids'] and not b['weDeclared']]
        # legacy schema for the hex-hub renderer (dist 1 = direct/0-hop, dist 2 = 1-hop setup)
        threats_legacy = []
        for d in direct:
            threats_legacy.append({'sid': d['sid'], 'dist': 1, 'hopLabel': '0-hop DIRECT (adjacent now)', 'intermediates': []})
        for b in setup_blockers:
            if not b['threateningSids']: continue
            interm = [{'r': b['r'], 'c': b['c'], 'seq': b['seq'], 'type': 3, 'specId': b['specId'],
                       'landType': b['landType'], 'landCat': b['landCat']}]
            for sid in b['threateningSids']:
                threats_legacy.append({'sid': sid, 'dist': 2,
                    'hopLabel': '1-hop (must win W-%s this round)' % b['seq'],
                    'intermediates': interm, 'weDeclared': b['weDeclared']})
        threats_legacy.sort(key=lambda t: (t['dist'], t['sid']))
        adj_wls = []; adj_ncs = []
        for nb in adj4(nc_rc, grid):
            ncell = grid[nb]
            if ncell.get('type') == 3:
                adj_wls.append({'seq': wseq(ncell), 'r': ncell['r'], 'c': ncell['c'], 'specId': ncell.get('specId'),
                    'landType': ncell.get('landType'), 'landCat': ncell.get('landCat'),
                    'ownerSid': ncell.get('ownerSid', 0), 'neutral': ncell.get('ownerSid', 0) == 0})
            elif ncell.get('type') == 2:
                adj_ncs.append({'name': ncell.get('name'), 'level': ncell.get('level'),
                    'ownerSid': ncell.get('ownerSid', 0) or ncell.get('sid', 0), 'r': ncell['r'], 'c': ncell['c']})
        blocker_legacy = [{'r': b['r'], 'c': b['c'], 'seq': b['seq'], 'specId': b['specId'], 'landType': b['landType'],
            'landCat': b['landCat'], 'weDeclared': b['weDeclared']} for b in setup_blockers if b['threateningSids']]
        nc_threat.append({'name': nc.get('name'), 'level': nc.get('level'), 'r': nc['r'], 'c': nc['c'],
            'threatTier': tier, 'directThreats': direct, 'setupBlockers': setup_blockers,
            'uncoveredBlockerCount': len(uncovered), 'directThreatCount': len(direct),
            'setupThreatCount': sum(1 for b in setup_blockers if b['threateningSids']),
            'threatCount': len(threats_legacy), 'twoHopCount': sum(1 for t in threats_legacy if t['dist'] == 2),
            'threeHopCount': 0, 'threats': threats_legacy, 'adjacentWastelands': adj_wls,
            'adjacentNCs': adj_ncs, 'blockerWastelands': blocker_legacy})
    tier_rank = {'HIGH':0,'MEDIUM':1,'LOW':2,'NONE':3}
    nc_threat.sort(key=lambda x: (-(x['level'] or 0), tier_rank[x['threatTier']], -x['uncoveredBlockerCount']))
    r['ncThreatAnalysis'] = nc_threat

    # ── NC capture flow (0-1 hop): enemy NCs reachable at the NC battle ──
    nc_capture_flow = []
    declaration_nc_unlocks = defaultdict(list)
    nc_by_rc = {(c['r'], c['c']): c for c in cells if c.get('type') == 2}
    for rc_, nc in nc_by_rc.items():
        sid = nc.get('sid') or 0
        if sid == 0 or sid == OWN_SID: continue
        via_owned = []; via_wls = []
        for nb in adj4(rc_, grid):
            n2 = grid[nb]
            if n2.get('type') == 2 and n2.get('sid') == OWN_SID:
                via_owned.append(n2.get('name') or '')                       # 0-hop (our NC adjacent)
            elif n2.get('type') == 3:
                s = wseq(n2)
                if n2.get('ownerSid') == OWN_SID:
                    via_owned.append('W-%s' % s if s else 'wasteland')        # 0-hop (we already own adjacent wl)
                elif s in declared_seqs:
                    via_wls.append(s); declaration_nc_unlocks[s].append(nc.get('name') or '')  # 1-hop (win this round)
        if not via_owned and not via_wls: continue
        nc_capture_flow.append({'nc': nc.get('name') or '', 'r': rc_[0], 'c': rc_[1], 'sid': sid,
            'level': str(nc.get('level') or 1), 'viaWastelands': sorted(set(via_wls)),
            'viaOwnedNCs': list(dict.fromkeys(via_owned))})
    nc_capture_flow.sort(key=lambda x: (-int(x['level'] or 1), 0 if x['viaOwnedNCs'] else 1))
    r['ncCaptureFlow'] = nc_capture_flow
    r['declarationNcUnlocks'] = {str(k): list(dict.fromkeys(v)) for k, v in declaration_nc_unlocks.items()}

    # ── ncTargets (L3 enemy NCs reachable 0-1 hop) ──
    nc_targets = []; seen = set()
    for nc in nc_capture_flow:
        if int(nc['level']) < 3: continue
        m = re.search(r'#(\d+)', nc['nc'] or ''); num = int(m.group(1)) if m else None
        if not num or num in seen: continue
        seen.add(num)
        pathway = nc['viaWastelands'][:4]
        rationale = 'L3 NC at r%sc%s owned by S%s.' % (nc['r'], nc['c'], nc['sid'])
        if nc['viaOwnedNCs']:
            rationale += ' Already adjacent via our %s (0-hop at NC battle).' % ', '.join(nc['viaOwnedNCs'])
        if pathway:
            rationale += ' Or win W-%s this round to reach it (1-hop).' % ' / W-'.join(map(str, pathway))
        nc_targets.append({'nc': nc['nc'], 'ncNum': num, 'level': int(nc['level']), 'sid': nc['sid'],
            'pathwayWastelands': pathway, 'rationale': rationale})
    r['ncTargets'] = nc_targets
    r['ncTargetsRule'] = ('Final wasteland battle of the week — declarations now set up the '
                          'neutral-city battle. Only 0-1 hop NC targets shown.')

    # ── focusOverrides: NC defense (0-1 hop) first, then combat-buff attacks ──
    COMBAT_PRI = {4001: 0, 4006: 1, 4007: 2, 4008: 3, 4010: 4}
    COMBAT_LABEL = {4001: 'ATK', 4006: 'HP', 4007: 'DMG Inc', 4008: 'DMG Red', 4010: 'DEF'}
    declared_by_seq = {w['seq']: w for w in r.get('warTargets', [])}
    own_l3 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) == 3]
    own_l2 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) == 2]
    seen_seq = set(); pin_order = []
    def push_nc_defense(ncs, label):
        for nc in ncs:
            for nb in adj4((nc['r'], nc['c']), grid):
                cell = grid.get(nb)
                if not cell or cell.get('type') != 3: continue
                sq = wseq(cell); w = declared_by_seq.get(sq)
                if not w or sq in seen_seq or not w.get('isContested'): continue
                seen_seq.add(sq)
                cont = ' contested vs S' + ','.join(map(str, w['contestedBy']))
                pin_order.append((sq, '%s: blocks an enemy 1-hop into our %s;%s.' % (label, nc.get('name'), cont)))
    push_nc_defense(own_l3, 'L3 NC defense')
    push_nc_defense(own_l2, 'L2 NC defense')
    combat_remaining = [w for sq, w in declared_by_seq.items() if sq not in seen_seq and w.get('specId') in COMBAT_PRI]
    combat_remaining.sort(key=lambda w: (COMBAT_PRI[w['specId']], w['seq']))
    for w in combat_remaining:
        seen_seq.add(w['seq'])
        cont = (' contested vs S' + ','.join(map(str, w['contestedBy']))) if w.get('isContested') else ''
        pin_order.append((w['seq'], 'Combat buff (%s) — final-battle pickup.%s' % (COMBAT_LABEL[w['specId']], cont)))
    # Defense priority: owned wastelands under attack, NC-protecting first,
    # then by strongest attacker fame.
    def def_key(d):
        atk_fame = max([power_by_sid.get(s, {}).get('score2', 0) for s in d.get('attackerSids', [])], default=0)
        return (-(d.get('protectsNcMaxLevel') or 0), -atk_fame)
    def_sorted = sorted(r.get('defenseTargets', []), key=def_key)
    r['focusOverrides'] = {'alliancePriority': [sq for sq, _ in pin_order], 'pinTop': [], 'demote': [],
        'alliancePriorityDefense': [d['seq'] for d in def_sorted],
        'seqNotes': {str(sq): note for sq, note in pin_order}}

    # ── Lean mode: NO buff-cap optimization sections ──
    r['strategicRecommendations'] = []
    r['candidatesByCat'] = {}
    r['eligibleTargets'] = {}
    r['projectedBuffsFromDeclarations'] = {}
    r['nextRoundCombatUnlocks'] = []
    r['isLastWastelandCycle'] = True
    r['battlesComplete'] = False
    data['currentRound'] = ROUND_KEY

    DATA.write_text(json.dumps(data, ensure_ascii=False))

    print('R14.5 enrichment written (sector %s) — FINAL wasteland battle, 0-1 hop, no buff caps' % r.get('sector'))
    print('  sectorPower inherited from R%s: %d servers' % (INHERIT_KEY, len(r['sectorPower'])))
    print('  warTargets: %d (%d contested)' % (len(r.get('warTargets', [])), sum(1 for w in r['warTargets'] if w['isContested'])))
    print('  contestedRanked: %d entries' % len(contested_ranked))
    for c in contested_ranked:
        print('    seq%s L%s %s vs S%s [%s rank#%s PI=%s]' % (c['seq'], c['level'], SPEC_NAMES.get(c['specId'],'?'), c['opponent'], c['tier'], c['sectorRank'], c['opPI']))
    hi = [n for n in nc_threat if n['threatTier'] == 'HIGH']
    print('  ncThreatAnalysis: %d owned L2/L3 NCs (HIGH=%d MED=%d LOW=%d)' % (len(nc_threat),
        sum(1 for n in nc_threat if n['threatTier']=='HIGH'), sum(1 for n in nc_threat if n['threatTier']=='MEDIUM'),
        sum(1 for n in nc_threat if n['threatTier']=='LOW')))
    for n in hi:
        sids = sorted({t['sid'] for t in n['directThreats']})
        print('    HIGH %s (L%s) direct from S%s' % (n['name'], n['level'], sids))
    print('  ncCaptureFlow: %d reachable enemy NCs (0-1 hop); ncTargets(L3): %d' % (len(nc_capture_flow), len(nc_targets)))
    print('  focusOverrides pins: %d' % len(pin_order))

if __name__ == '__main__':
    main()
