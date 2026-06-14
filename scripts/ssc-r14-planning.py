#!/usr/bin/env python3
"""R14 enrichment — Sector 110, fresh wasteland declaration round.

Builds the full battle-plan.html threat-intelligence payload for Round 14
from two real inputs:

  1. The basic SSC map extraction already in ssc-map.json rounds['14']
     (cells grid, 46 warTargets with fightSids, 12 owned NCs, buffOverview).
  2. /tmp/sector110_ranks.json — the LIVE Local Sector Rankings list
     (EniConquerorRankListComponent.rankList) for all 36 sector-110 servers:
     {rank (seal-stone), score (seal stones), sid, score2 (fame), serverFlag}.

Outputs:
  * sectorPower / sectorServerCards  — fame-driven server cards.
        sectorRank = fame rank (1..36), tier = fame-rank band
        (S=1, A=2-5, B=6-15, C=16+), powerIndex = fame normalised to 0-90.
        NOTE: powerIndex here is a FAME PROXY, not the merit-based PI used in
        R12/R12.5 (which needs the 56K-entry individual-merit pump). Per-server
        top-player merit cards (topPlayer/meritTop10/totalMerit) are NOT included
        — run the merit pump to add those. The page renders those columns as "—".
  * contestedRanked        — drives the contested-fights view (3 contested 3-way
        declarations this round: seq257 vs S3800, seq381 vs S1547, seq33 vs S3540).
  * enriched warTargets    — adds contestedBy / isContested / wastelandId / r,c /
        landType / landCat from the matching cell + fightSids.
  * ncThreatAnalysis       — per-owned-NC (L2/L3) direct + setup threat tiers.
  * ncCaptureFlow / ncTargets / declarationNcUnlocks.
  * candidatesByCat / strategicRecommendations (category granularity — neutral-
        wasteland specId is not in this extraction) + projectedBuffsFromDeclarations.
  * focusOverrides         — combat-buff + NC-defense pin order.
"""
import json
import re
from pathlib import Path
from collections import defaultdict

DATA = Path('/Users/shivabezwada/tw-projects/landing-page/data/ssc-map.json')
RANKS = Path('/tmp/sector110_ranks.json')
OWN_SID = 2864
ROUND_KEY = '14'
# Captured from CQ25MainProgressComp during the R14 extraction (7-day window).
ROUND_START = 1781452800
ROUND_END = 1782057600

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

def tier_for_rank(sr):
    if sr == 1: return 'S'
    if sr <= 5: return 'A'
    if sr <= 15: return 'B'
    return 'C'

def main():
    data = json.loads(DATA.read_text())
    r = data['rounds'][ROUND_KEY]
    cells = r['cells']
    grid = {(c['r'], c['c']): c for c in cells}

    # ── Backfill: NC level (from name) + declared/owned wasteland specId ──
    for c in cells:
        if c.get('type') == 2:
            lv = nclevel(c)
            if lv is not None:
                c['level'] = lv
    spec_by_seq = {}
    for w in r.get('warTargets', []):
        spec_by_seq[w['seq']] = w['specId']
    for seq, ow in r.get('ownedWastelands', {}).items():
        spec_by_seq.setdefault(int(seq), ow.get('specId'))
    for c in cells:
        if c.get('type') == 3:
            s = wseq(c)
            if s in spec_by_seq and spec_by_seq[s] is not None:
                c['specId'] = spec_by_seq[s]

    # ── sectorPower / sectorServerCards from live sector rankings ─────
    ranks = json.loads(RANKS.read_text())
    by_fame = sorted(ranks, key=lambda e: -(e.get('score2') or 0))
    max_fame = max((e.get('score2') or 0) for e in ranks) or 1
    sector_power = []
    sector_cards = []
    for i, e in enumerate(by_fame):
        sr = i + 1
        fame = e.get('score2') or 0
        pi = round(90.0 * fame / max_fame, 1)
        tier = tier_for_rank(sr)
        sid = e['sid']
        sector_power.append({
            'sid': sid,
            'rank': e.get('rank', 0),          # live seal-stone sector rank
            'score': e.get('score', 0),        # seal stones captured this round
            'score2': fame,                    # fame (threat metric)
            'serverFlag': e.get('serverFlag', 0),
            'sectorRank': sr,                  # fame position in sector
            'powerIndex': pi,                  # FAME PROXY (see module docstring)
            'tier': tier,
            'piComponents': {'fameNorm': round(fame / max_fame, 4)},
            'piMethod': 'fame-proxy',
        })
        sector_cards.append({
            'sid': sid,
            'sectorRank': sr,
            'overallRank': e.get('rank', 0),
            'warzoneScore': e.get('score', 0),
            'fame': fame,
            'serverFlag': e.get('serverFlag', 0),
            'powerIndex': pi,
            'tier': tier,
            'isUs': sid == OWN_SID,
        })
    r['sectorPower'] = sector_power
    r['sectorServerCards'] = sector_cards
    r['rankingCoverage'] = {
        'sectorServerCount': len(ranks),
        'serversInRanking': len(ranks),
        'piMethod': 'fame-proxy',
        'note': ('Power Index is a fame proxy this round (powerIndex = fame '
                 'normalised to 0-90). Per-server merit cards (top players, '
                 'total merit) are not loaded for R14.'),
    }
    power_by_sid = {p['sid']: p for p in sector_power}

    # ── Enrich warTargets (contestedBy / isContested / cell geometry) ─
    cell_by_seq = {}
    for c in cells:
        if c.get('type') == 3:
            s = wseq(c)
            if s: cell_by_seq[s] = c
    for w in r.get('warTargets', []):
        fs = w.get('fightSids') or []
        contested_by = [s for s in fs if s != OWN_SID]
        w['contestedBy'] = contested_by
        w['isContested'] = len(contested_by) > 0
        cell = cell_by_seq.get(w['seq'])
        if cell:
            w['wastelandId'] = cell.get('id')
            w['r'] = cell['r']
            w['c'] = cell['c']
            w['landType'] = cell.get('landType')
            w['landCat'] = cell.get('landCat')

    # ── contestedRanked ──────────────────────────────────────────────
    contested_ranked = []
    for w in r.get('warTargets', []):
        others = w.get('contestedBy') or []
        if not others: continue
        is3way = len(w.get('fightSids', [])) >= 3
        for opp in others:
            pw = power_by_sid.get(opp, {})
            contested_ranked.append({
                'seq': w['seq'], 'level': w.get('level'), 'specId': w.get('specId'),
                'opponent': opp,
                'tier': pw.get('tier', 'C'),
                'sectorRank': pw.get('sectorRank', 0),
                'opFame': pw.get('score2', 0),
                'opScore': pw.get('score', 0),
                'opPI': pw.get('powerIndex', 0.0),
                'is3way': is3way,
            })
    contested_ranked.sort(key=lambda x: (-(x['opPI'] or 0), x['seq']))
    r['contestedRanked'] = contested_ranked
    if r.get('s2864'):
        r['s2864']['contestedDeclarations'] = len({c['seq'] for c in contested_ranked})

    # ── NC threat analysis (owned L2/L3 NCs) ─────────────────────────
    declared_seqs = {w['seq'] for w in r.get('warTargets', [])}
    own_l23 = [c for c in cells if c.get('sid') == OWN_SID and c.get('type') == 2 and (c.get('level') or 0) >= 2]
    nc_threat = []
    for nc in own_l23:
        nc_rc = (nc['r'], nc['c'])
        direct = []
        setup_blockers = []
        for nb in adj4(nc_rc, grid):
            ncell = grid[nb]
            t = ncell.get('type')
            if t in (1, 3):
                sid = ncell.get('ownerSid') or ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({'sid': sid, 'sourceCell': {
                        'r': ncell['r'], 'c': ncell['c'], 'type': t,
                        'name': ncell.get('name'), 'specId': ncell.get('specId'),
                        'landType': ncell.get('landType')}})
                elif t == 3 and sid == 0:
                    w_seq = wseq(ncell)
                    we_declared = w_seq in declared_seqs
                    threat_sids = set()
                    for nb2 in adj4((ncell['r'], ncell['c']), grid):
                        c2 = grid[nb2]
                        s2 = c2.get('ownerSid') or c2.get('sid') or 0
                        if s2 and s2 != OWN_SID:
                            threat_sids.add(s2)
                    setup_blockers.append({
                        'seq': w_seq, 'r': ncell['r'], 'c': ncell['c'],
                        'specId': ncell.get('specId'), 'landType': ncell.get('landType'),
                        'landCat': ncell.get('landCat'), 'weDeclared': we_declared,
                        'threateningSids': sorted(threat_sids)})
            elif t == 2:
                sid = ncell.get('sid') or 0
                if sid and sid != OWN_SID:
                    direct.append({'sid': sid, 'sourceCell': {
                        'r': ncell['r'], 'c': ncell['c'], 'type': 2,
                        'name': ncell.get('name'), 'level': ncell.get('level')}})
        tier = 'NONE'
        if direct: tier = 'HIGH'
        elif any(b['threateningSids'] and not b['weDeclared'] for b in setup_blockers): tier = 'MEDIUM'
        elif any(b['threateningSids'] for b in setup_blockers): tier = 'LOW'
        uncovered = [b for b in setup_blockers if b['threateningSids'] and not b['weDeclared']]
        # legacy schema for the hex-hub renderer
        threats_legacy = []
        for d in direct:
            threats_legacy.append({'sid': d['sid'], 'dist': 1, 'hopLabel': '1-hop DIRECT', 'intermediates': []})
        for b in setup_blockers:
            if not b['threateningSids']: continue
            interm = [{'r': b['r'], 'c': b['c'], 'seq': b['seq'], 'type': 3,
                       'specId': b['specId'], 'landType': b['landType'], 'landCat': b['landCat']}]
            for sid in b['threateningSids']:
                threats_legacy.append({'sid': sid, 'dist': 2,
                    'hopLabel': '2-hop (needs to win W-{0} this round)'.format(b['seq']),
                    'intermediates': interm, 'weDeclared': b['weDeclared']})
        threats_legacy.sort(key=lambda t: (t['dist'], t['sid']))
        adj_wls = []; adj_ncs = []
        for nb in adj4(nc_rc, grid):
            ncell = grid[nb]
            if ncell.get('type') == 3:
                adj_wls.append({'seq': wseq(ncell), 'r': ncell['r'], 'c': ncell['c'],
                    'specId': ncell.get('specId'), 'landType': ncell.get('landType'),
                    'landCat': ncell.get('landCat'), 'ownerSid': ncell.get('ownerSid', 0),
                    'neutral': ncell.get('ownerSid', 0) == 0})
            elif ncell.get('type') == 2:
                adj_ncs.append({'name': ncell.get('name'), 'level': ncell.get('level'),
                    'ownerSid': ncell.get('ownerSid', 0) or ncell.get('sid', 0),
                    'r': ncell['r'], 'c': ncell['c']})
        blocker_legacy = [{'r': b['r'], 'c': b['c'], 'seq': b['seq'], 'specId': b['specId'],
            'landType': b['landType'], 'landCat': b['landCat'], 'weDeclared': b['weDeclared']}
            for b in setup_blockers if b['threateningSids']]
        nc_threat.append({
            'name': nc.get('name'), 'level': nc.get('level'), 'r': nc['r'], 'c': nc['c'],
            'threatTier': tier, 'directThreats': direct, 'setupBlockers': setup_blockers,
            'uncoveredBlockerCount': len(uncovered), 'directThreatCount': len(direct),
            'setupThreatCount': sum(1 for b in setup_blockers if b['threateningSids']),
            'threatCount': len(threats_legacy),
            'twoHopCount': sum(1 for t in threats_legacy if t['dist'] == 2),
            'threeHopCount': 0, 'threats': threats_legacy,
            'adjacentWastelands': adj_wls, 'adjacentNCs': adj_ncs,
            'blockerWastelands': blocker_legacy})
    tier_rank = {'HIGH':0,'MEDIUM':1,'LOW':2,'NONE':3}
    nc_threat.sort(key=lambda x: (-(x['level'] or 0), tier_rank[x['threatTier']], -x['uncoveredBlockerCount']))
    r['ncThreatAnalysis'] = nc_threat

    # ── NC capture flow + ncTargets ──────────────────────────────────
    nc_capture_flow = []
    declaration_nc_unlocks = defaultdict(list)
    nc_by_rc = {(c['r'], c['c']): c for c in cells if c.get('type') == 2}
    for rc, nc in nc_by_rc.items():
        sid = nc.get('sid') or 0
        if sid == 0 or sid == OWN_SID: continue
        via_owned = []; via_wls = []
        for nb in adj4(rc, grid):
            n2 = grid[nb]
            if n2.get('type') == 2 and n2.get('sid') == OWN_SID:
                via_owned.append(n2.get('name') or '')
            elif n2.get('type') == 3:
                s = wseq(n2)
                if s in declared_seqs:
                    via_wls.append(s); declaration_nc_unlocks[s].append(nc.get('name') or '')
                elif n2.get('ownerSid') == OWN_SID:
                    via_owned.append('W-%s' % s if s else 'wasteland')
        if not via_owned and not via_wls: continue
        nc_capture_flow.append({'nc': nc.get('name') or '', 'r': rc[0], 'c': rc[1],
            'sid': sid, 'level': str(nc.get('level') or 1),
            'viaWastelands': sorted(set(via_wls)), 'viaOwnedNCs': list(dict.fromkeys(via_owned))})
    nc_capture_flow.sort(key=lambda x: (-int(x['level'] or 1), 0 if x['viaOwnedNCs'] else 1))
    r['ncCaptureFlow'] = nc_capture_flow
    r['declarationNcUnlocks'] = {str(k): list(dict.fromkeys(v)) for k, v in declaration_nc_unlocks.items()}

    nc_targets = []
    seen = set()
    for nc in nc_capture_flow:
        if int(nc['level']) < 3: continue
        m = re.search(r'#(\d+)', nc['nc'] or '')
        num = int(m.group(1)) if m else None
        if not num or num in seen: continue
        seen.add(num)
        pathway = nc['viaWastelands'][:4]
        rationale = 'L3 NC at r%sc%s owned by S%s.' % (nc['r'], nc['c'], nc['sid'])
        if pathway:
            rationale += ' Pathway via W-%s (win this round to open a 1-hop at the NC battle).' % ' / W-'.join(map(str, pathway))
        if nc['viaOwnedNCs']:
            rationale += ' Adjacent to our %s.' % ', '.join(nc['viaOwnedNCs'])
        nc_targets.append({'nc': nc['nc'], 'ncNum': num, 'level': int(nc['level']),
            'sid': nc['sid'], 'pathwayWastelands': pathway, 'rationale': rationale})
    r['ncTargets'] = nc_targets
    r['ncTargetsRule'] = ('Declarations this round set up the neutral-city battle. '
                          'One unowned NC per level per week (game rule).')

    # ── eligible targets / candidates by category (category granularity) ──
    eligible_by_cat = defaultdict(list)
    for c in cells:
        if c.get('type') != 3 or c.get('ownerSid', 0) != 0: continue
        cat = c.get('landCat')
        if not cat: continue
        eligible_by_cat[cat].append({'seq': wseq(c), 'id': c.get('id'),
            'r': c['r'], 'c': c['c'], 'landType': c.get('landType'), 'landCat': cat})
    r['candidatesByCat'] = {k: len(v) for k, v in eligible_by_cat.items()}
    r['eligibleTargetsByCat'] = {k: v for k, v in eligible_by_cat.items()}

    # ── strategicRecommendations from live buff caps ─────────────────
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
        live_max = b.get('rawMax', 0); live_cur = b.get('rawCurrent', 0)
        gap = max(0, live_max - live_cur)
        ws_to_max = -(-gap // per_l3) if (per_l3 > 0 and gap > 0) else 0
        cat = SPEC_CAT.get(sp, 'special')
        strategic.append({'effectType': eff, 'description': b.get('description', ''),
            'category': cat, 'feedingSpec': sp, 'feedingSpecName': SPEC_NAMES.get(sp, 'Spec %s' % sp),
            'rawCurrent': live_cur, 'rawMax': live_max, 'rawGap': gap,
            'gapPct': (100.0 * gap / live_max) if live_max > 0 else 0.0,
            'perLv3Contribution': per_l3, 'wastelandsToMax': ws_to_max,
            'eligibleTargetCount': len(eligible_by_cat.get(cat, []))})
    cat_rank = {'combat':0,'utility':1,'economy':2,'special':3}
    strategic.sort(key=lambda s: (cat_rank.get(s['category'], 9), -s['rawGap']))
    r['strategicRecommendations'] = strategic
    r['specToEffectTypeMap'] = SPEC_TO_EFFECT

    # projected buffs from our declarations (assumes L3 wins)
    proj = defaultdict(int)
    for w in r.get('warTargets', []):
        for eff, val in LV3_CONTRIB.get(w['specId'], {}).items():
            proj[eff] += val
    r['projectedBuffsFromDeclarations'] = {str(k): v for k, v in proj.items()}

    # ── focusOverrides: NC defense first, then combat-buff fill ───────
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
                sq = wseq(cell)
                w = declared_by_seq.get(sq)
                if not w or sq in seen_seq or not w.get('isContested'): continue
                seen_seq.add(sq)
                cont = ' contested vs S' + ','.join(map(str, w['contestedBy']))
                pin_order.append((sq, '%s: defends our %s — enemy can chain through this wasteland;%s.' % (label, nc.get('name'), cont)))
    push_nc_defense(own_l3, 'L3 NC defense')
    push_nc_defense(own_l2, 'L2 NC defense')
    combat_remaining = [w for sq, w in declared_by_seq.items() if sq not in seen_seq and w.get('specId') in COMBAT_PRI]
    combat_remaining.sort(key=lambda w: (COMBAT_PRI[w['specId']], w['seq']))
    for w in combat_remaining:
        seen_seq.add(w['seq'])
        cont = (' contested vs S' + ','.join(map(str, w['contestedBy']))) if w.get('isContested') else ''
        pin_order.append((w['seq'], 'Combat buff (%s) — fills the sector cap.%s' % (COMBAT_LABEL[w['specId']], cont)))
    r['focusOverrides'] = {'alliancePriority': [sq for sq, _ in pin_order], 'pinTop': [], 'demote': [],
        'seqNotes': {str(sq): note for sq, note in pin_order}}

    # ── round meta ───────────────────────────────────────────────────
    r['roundStart'] = ROUND_START
    r['roundEnd'] = ROUND_END
    r['isLastWastelandCycle'] = False
    r['battlesComplete'] = False
    data['currentRound'] = 14

    DATA.write_text(json.dumps(data, ensure_ascii=False))

    import datetime
    print('R14 enrichment written (sector %s)' % r.get('sector'))
    print('  sectorPower/cards: %d servers (fame-proxy PI)' % len(sector_power))
    top5 = [(p['sid'], p['score2'], p['tier']) for p in sector_power[:5]]
    print('  top fame: ' + ', '.join('S%s(%s,%s)' % t for t in top5))
    print('  contestedRanked: %d entries (%d distinct seqs)' % (len(contested_ranked), len({c['seq'] for c in contested_ranked})))
    for c in contested_ranked:
        print('    seq%s L%s %s vs S%s [%s rank#%s fame=%s PI=%s]' % (c['seq'], c['level'], SPEC_NAMES.get(c['specId'],'?'), c['opponent'], c['tier'], c['sectorRank'], c['opFame'], c['opPI']))
    print('  ncThreatAnalysis: %d NCs (HIGH=%d MED=%d LOW=%d)' % (len(nc_threat),
        sum(1 for n in nc_threat if n['threatTier']=='HIGH'),
        sum(1 for n in nc_threat if n['threatTier']=='MEDIUM'),
        sum(1 for n in nc_threat if n['threatTier']=='LOW')))
    print('  ncCaptureFlow: %d reachable enemy NCs; ncTargets(L3): %d' % (len(nc_capture_flow), len(nc_targets)))
    print('  candidatesByCat: %s' % r['candidatesByCat'])
    print('  focusOverrides pins: %d' % len(pin_order))
    print('  roundStart=%s (%s UTC)  roundEnd=%s' % (ROUND_START,
        datetime.datetime.utcfromtimestamp(ROUND_START).strftime('%Y-%m-%d %H:%M'), ROUND_END))

if __name__ == '__main__':
    main()
