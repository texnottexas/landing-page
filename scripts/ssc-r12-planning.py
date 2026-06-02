#!/usr/bin/env python3
"""
R12 sector planning enrichment.

Adds (or refreshes) on rounds["12"]:
  * buffOverview              — caps + current=0 (declaration phase has 0 owned wastelands)
  * specToEffectTypeMap       — spec id -> primary effect type
  * strategicRecommendations  — gap-to-cap analysis per effect
  * ncThreatAnalysis          — per L2/L3 NC: which servers can reach us via BFS
                                (1-hop direct, 2-hop = 1 wasteland capture,
                                 3-hop = 2 wasteland captures across R12+R13),
                                plus blocker wastelands and threat tier.

NC threat model:
  - 2 wasteland rounds left (R12, R13), then NC battles (R14).
  - A server with min path distance D (through neutral wastelands)
    needs D-1 wasteland captures to land 1-hop on our NC.
  - We cut paths through hostile-owned cells (BFS only walks neutrals).
"""
import json
import re
import sys
from collections import deque, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "ssc-map.json"

# Constant tables (mirror battle-plan.html SPEC_LEVEL_CONTRIB)
SPEC_NAMES = {
    4001: "ATK Buff", 4002: "Truck Transport", 4003: "Truck Heist", 4004: "Mining Hub",
    4006: "HP Buff", 4007: "DMG Increase", 4008: "DMG Reduction", 4010: "DEF Buff",
    4015: "Daily Tasks", 4016: "Seal Stone Train", 4017: "Realm", 4018: "Realm Thief",
    4080: "Treasury Reward",
}
SPEC_CAT = {
    4001: "combat", 4006: "combat", 4007: "combat", 4008: "combat", 4010: "combat",
    4002: "economy", 4003: "economy", 4004: "economy", 4015: "economy",
    4016: "utility", 4017: "utility", 4018: "utility",
    4080: "special",
}
SPEC_TO_EFFECT = {
    "4001": 11001, "4006": 11002, "4007": 11003, "4008": 11004, "4010": 11006,
    "4002": 11011, "4003": 11012, "4015": 11017, "4080": 11080,
    "4004": 11026, "4016": 11020, "4017": 11023, "4018": 11015,
}
# Effect cap baseline (carry forward from R10/R10.5 — sector caps don't change
# round to round). paraType: 1=count, 2=% (×100).
BUFF_CAPS = [
    {"effectType": 11001, "description": "Increased ATK in the Realm",                                  "rawMax": 270000, "paraType": 2},
    {"effectType": 11002, "description": "Increased HP in the Realm",                                   "rawMax": 270000, "paraType": 2},
    {"effectType": 11003, "description": "Increased DMG Increase in the Realm",                          "rawMax":  15000, "paraType": 2},
    {"effectType": 11004, "description": "Increased DMG Reduction in the Realm",                         "rawMax":  15000, "paraType": 2},
    {"effectType": 11006, "description": "Increased DEF in the Realm",                                   "rawMax":   5000, "paraType": 2},
    {"effectType": 11011, "description": "Extra Wasteland Seal Stones from successful Truck transport",  "rawMax":     15, "paraType": 1},
    {"effectType": 11012, "description": "Extra Wasteland Seal Stones from intercepting Trucks",         "rawMax":     20, "paraType": 1},
    {"effectType": 11013, "description": "Increased Mining Hub Warehouse Level",                        "rawMax":      3, "paraType": 1},
    {"effectType": 11014, "description": "Increased Mining Hub Mining Level",                            "rawMax":      3, "paraType": 1},
    {"effectType": 11015, "description": "Reduced Treasury Pass drop rate when defeated in the Realm",   "rawMax":   5000, "paraType": 2},
    {"effectType": 11016, "description": "Increased Treasury Pass gain in the Realm",                    "rawMax":   6000, "paraType": 2},
    {"effectType": 11017, "description": "Extra Wasteland Seal Stones from daily tasks",                 "rawMax":     20, "paraType": 1},
    {"effectType": 11020, "description": "Increased Seal Stone Train passengers in the Realm",          "rawMax":      6, "paraType": 1},
    {"effectType": 11021, "description": "Reduced Seal Stone Train refresh cost",                       "rawMax":      6, "paraType": 1},
    {"effectType": 11022, "description": "Increased Seal Stone Train passenger rarity cap",             "rawMax":      3, "paraType": 1},
    {"effectType": 11023, "description": "Increased march speed in the Realm",                          "rawMax":  10000, "paraType": 2},
    {"effectType": 11024, "description": "Increased Enigma Beast carrying capacity in the Realm",       "rawMax":      3, "paraType": 1},
    {"effectType": 11026, "description": "Increased Mining Speed at Mining Hub",                        "rawMax":   1500, "paraType": 2},
    {"effectType": 11080, "description": "Extra Treasury rewards from Treasury Pass",                   "rawMax":      0, "paraType": 1},
]

# Per-Lv-3 wasteland contribution by spec (mirror SPEC_LEVEL_CONTRIB at Lv.3).
# Used to compute wastelandsToMax for each effect at the best-case scenario
# (Lv.3 wastelands, which is what we hunt for declarations).
LV3_CONTRIB = {
    4001: {11001: 27000},                     # ATK +270%/L3
    4006: {11002: 27000},                     # HP
    4007: {11003:  4500},                     # DMG Inc +45%/L3
    4008: {11004:  4500},                     # DMG Red
    4010: {11006:  1500},                     # DEF +15%/L3
    4002: {11011:     3},
    4003: {11012:     3},
    4015: {11017:     6},
    4080: {11080:     1},
    4004: {11026:   500, 11013: 1, 11014: 1},
    4016: {11020:     1, 11021: 2, 11022: 1},
    4017: {11023:  3000, 11024: 1},
    4018: {11015:  1000, 11016: 3000},
}

OWN_SID = 2864

def wasteland_seq(cell):
    """Extract the in-game wasteland number (the digits after '#' in cell.name)
       so labels read 'W-421' instead of the sector-encoded cell.id (40900xxx).
       Returns None for non-wasteland cells / unrecognised names."""
    name = cell.get("name") or ""
    m = re.search(r"#(\d+)", name)
    return int(m.group(1)) if m else None

def four_neighbors(r, c, nrows, ncols, grid):
    out = []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < nrows and 0 <= nc < ncols and (nr, nc) in grid:
            out.append((nr, nc))
    return out

def bfs_paths(start_cells, target_rc, grid, nrows, ncols, max_dist=3):
    """Multi-source BFS through neutral cells (ownerSid == 0).
       Returns (min_dist, list_of_intermediate_min_path_cells)."""
    if target_rc in start_cells:
        return 0, []
    dist = {sc: 0 for sc in start_cells}
    parents = defaultdict(set)
    q = deque(start_cells)
    while q:
        cur = q.popleft()
        if dist[cur] >= max_dist:
            continue
        for nb in four_neighbors(*cur, nrows, ncols, grid):
            cell = grid[nb]
            is_target = (nb == target_rc)
            is_neutral = (cell.get("ownerSid", 0) == 0)
            if not (is_target or is_neutral):
                continue
            new_d = dist[cur] + 1
            if nb not in dist:
                dist[nb] = new_d
                parents[nb].add(cur)
                if not is_target:
                    q.append(nb)
            elif dist[nb] == new_d and not is_target:
                parents[nb].add(cur)
    if target_rc not in dist:
        return None, []
    d = dist[target_rc]
    if d <= 1:
        return d, []
    interm = set()
    stack = [target_rc]
    seen = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for p in parents.get(cur, []):
            if p in start_cells:
                continue
            interm.add(p)
            stack.append(p)
    return d, sorted(interm)

def main():
    data = json.loads(DATA.read_text())
    r12 = data["rounds"]["12"]
    cells = r12["cells"]
    grid = {(c["r"], c["c"]): c for c in cells}
    nrows = max(c["r"] for c in cells) + 1
    ncols = max(c["c"] for c in cells) + 1

    # ── NC threat analysis ──────────────────────────────────────
    own_ncs = [
        c for c in cells if c.get("sid") == OWN_SID and c.get("type") == 2
        and (c.get("level") or 0) >= 2
    ]
    # Adjacent wastelands per our NC (for blocker recipe)
    server_cells = defaultdict(list)
    for c in cells:
        sid = c.get("sid", 0)
        if sid and sid != OWN_SID:
            server_cells[sid].append((c["r"], c["c"]))

    nc_threat = []
    for nc in own_ncs:
        nc_rc = (nc["r"], nc["c"])
        # Adjacent wastelands (4-dir) that are still neutral
        adj_wls = []
        adj_ncs = []
        for nb in four_neighbors(*nc_rc, nrows, ncols, grid):
            cell = grid[nb]
            if cell.get("type") == 3:
                adj_wls.append({
                    "seq": wasteland_seq(cell),
                    "id": cell.get("id"),
                    "r": cell["r"], "c": cell["c"],
                    "specId": cell.get("specId"),
                    "landType": cell.get("landType"),
                    "landCat": cell.get("landCat"),
                    "ownerSid": cell.get("ownerSid", 0),
                    "neutral": cell.get("ownerSid", 0) == 0,
                })
            elif cell.get("type") == 2:
                adj_ncs.append({
                    "name": cell.get("name"),
                    "level": cell.get("level"),
                    "ownerSid": cell.get("ownerSid", 0),
                    "r": cell["r"], "c": cell["c"],
                })

        threats = []
        for sid, scells in server_cells.items():
            d, interm = bfs_paths(set(scells), nc_rc, grid, nrows, ncols, max_dist=3)
            if d is None or d > 3:
                continue
            # Build intermediate descriptors (wasteland metadata + (r,c))
            interm_desc = []
            for ic in interm:
                cell = grid[ic]
                interm_desc.append({
                    "r": cell["r"], "c": cell["c"],
                    "seq": wasteland_seq(cell),
                    "type": cell.get("type"),
                    "specId": cell.get("specId"),
                    "landType": cell.get("landType"),
                    "landCat": cell.get("landCat"),
                    "name": cell.get("name"),
                })
            threats.append({
                "sid": sid,
                "dist": d,
                "hopLabel": (
                    "1-hop DIRECT" if d == 1
                    else ("2-hop (needs 1 capture)" if d == 2
                          else "3-hop (needs 2 captures)")
                ),
                "intermediates": interm_desc,
            })
        threats.sort(key=lambda t: (t["dist"], t["sid"]))

        # Blocker recipe: capturing ANY neutral wasteland adjacent to our NC
        # severs every 2-hop path through that cell, and capturing ALL of them
        # (the 4-cell ring) blocks every 2-hop and 3-hop attacker.
        blockers = [w for w in adj_wls if w["neutral"]]

        # Threat tier
        has_direct = any(t["dist"] == 1 for t in threats)
        has_2hop = any(t["dist"] == 2 for t in threats)
        if has_direct:
            tier = "HIGH"
        elif has_2hop:
            tier = "MEDIUM"
        elif threats:
            tier = "LOW"
        else:
            tier = "NONE"

        nc_threat.append({
            "name": nc.get("name"),
            "level": nc.get("level"),
            "r": nc["r"],
            "c": nc["c"],
            "threatTier": tier,
            "threatCount": len(threats),
            "directThreatCount": sum(1 for t in threats if t["dist"] == 1),
            "twoHopCount": sum(1 for t in threats if t["dist"] == 2),
            "threeHopCount": sum(1 for t in threats if t["dist"] == 3),
            "adjacentWastelands": adj_wls,
            "adjacentNCs": adj_ncs,
            "blockerWastelands": [{"r": b["r"], "c": b["c"], "seq": b["seq"], "id": b["id"],
                                    "specId": b["specId"], "landType": b["landType"],
                                    "landCat": b["landCat"]} for b in blockers],
            "threats": threats,
        })

    # Sort: L3 first, then L2, then by threat severity
    tier_rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "NONE": 3}
    nc_threat.sort(key=lambda x: (-x["level"], tier_rank[x["threatTier"]], -x["threatCount"]))

    # ── Buff planning sections ──────────────────────────────────
    # Prefer live buffOverview (caps differ per sector — sector 90 has
    # ATK/HP/DMG/DEF caps different from older sectors). Fall back to
    # BUFF_CAPS defaults only if no live data was extracted yet.
    existing_buff = r12.get("buffOverview") or []
    if existing_buff and all("rawMax" in b for b in existing_buff):
        buff_overview = existing_buff
    else:
        buff_overview = []
        for cap in BUFF_CAPS:
            buff_overview.append({
                **cap,
                "current": _fmt_val(0, cap["paraType"]),
                "max": _fmt_val(cap["rawMax"], cap["paraType"]),
                "rawCurrent": 0,
                "wastelandCount": 0,
                "wastelands": [],
            })

    # eligibleTargets, candidatesByCat — count cells by spec category
    eligible_by_spec = defaultdict(list)
    for c in cells:
        if c.get("type") != 3:
            continue
        if c.get("ownerSid", 0) != 0:
            continue
        sp = c.get("specId")
        if sp is None:
            continue
        eligible_by_spec[sp].append({
            "seq": wasteland_seq(c), "id": c.get("id"),
            "r": c["r"], "c": c["c"], "specId": sp,
            "landType": c.get("landType"), "landCat": c.get("landCat"),
        })
    # eligibleTargets keyed by spec for backward-compat lookup
    eligible_targets = {str(sp): v for sp, v in eligible_by_spec.items()}
    candidates_by_cat = defaultdict(int)
    for sp, v in eligible_by_spec.items():
        candidates_by_cat[SPEC_CAT.get(sp, "special")] += len(v)
    candidates_by_cat = dict(candidates_by_cat)

    # strategicRecommendations: for each effect type, how many Lv.3 wastelands
    # of the feeding spec to max it (best-case projection).
    strategic = []
    # Reverse map: effect → feeding spec (first one that contributes)
    effect_to_spec = {}
    for sp, contrib in LV3_CONTRIB.items():
        for eff in contrib:
            effect_to_spec.setdefault(eff, sp)

    # Use the live rawMax from buff_overview (now authoritative) so recipe
    # counts ("X x Lv.3 SPEC → max") reflect sector-specific caps.
    for b in buff_overview:
        eff = b["effectType"]
        sp = effect_to_spec.get(eff)
        if sp is None:
            continue
        per_l3 = LV3_CONTRIB[sp].get(eff, 0)
        if per_l3 <= 0:
            continue
        live_max = b.get("rawMax", 0)
        live_cur = b.get("rawCurrent", 0)
        gap = max(0, live_max - live_cur)
        ws_to_max = -(-gap // per_l3) if (per_l3 > 0 and gap > 0) else 0
        strategic.append({
            "effectType": eff,
            "description": b.get("description", ""),
            "category": SPEC_CAT.get(sp, "special"),
            "feedingSpec": sp,
            "feedingSpecName": SPEC_NAMES.get(sp, f"Spec {sp}"),
            "rawCurrent": live_cur,
            "rawMax": live_max,
            "rawGap": gap,
            "gapPct": (100.0 * gap / live_max) if live_max > 0 else 0.0,
            "perLv3Contribution": per_l3,
            "wastelandsToMax": ws_to_max,
            "eligibleTargetCount": len(eligible_by_spec.get(sp, [])),
        })
    # Sort: combat first, then by largest gap
    cat_rank = {"combat": 0, "utility": 1, "economy": 2, "special": 3}
    strategic.sort(key=lambda s: (cat_rank.get(s["category"], 9), -s["rawGap"]))

    # ── R12 wasteland declaration plan ──────────────────────────
    # The historical "R11 Setup" section (curated + auto1Hop + ncTargets) drove
    # the "what to declare this round" view in older rounds. Without an
    # equivalent for R12, the round renders without a setup plan. We auto-seed:
    #   * curated:   neutral wastelands adjacent to our L2/L3 NCs (defense-
    #                priority blockers — see ncThreatAnalysis)
    #   * auto1Hop:  combat wastelands within 1 hop of our footprint, sorted by
    #                spec priority (ATK > HP > DMG Inc > DMG Red > DEF)
    # For each pick we also list the 1-hop combat wastelands it would OPEN
    # for R13 once we own it.
    def neutral_4adj(rr, cc):
        out = []
        for nb in four_neighbors(rr, cc, nrows, ncols, grid):
            cell = grid[nb]
            if cell.get("ownerSid", 0) == 0 and cell.get("type") == 3:
                out.append(cell)
        return out

    def synth_war(cell, hops_combat):
        return {
            "seq": wasteland_seq(cell),
            "id": cell.get("id"),
            "r": cell["r"], "c": cell["c"],
            "level": 3,            # actual level not known pre-declaration
            "specId": cell.get("specId"),
            "landType": cell.get("landType"),
            "landCat": cell.get("landCat"),
            "isContested": False,
            "contestedBy": [],
            "oneHop": [
                {
                    "seq": wasteland_seq(h),
                    "id": h.get("id"),
                    "specId": h.get("specId"),
                    "specName": SPEC_NAMES.get(h.get("specId"), str(h.get("specId"))),
                    "landCat": h.get("landCat"),
                }
                for h in hops_combat
            ],
        }

    seen_seqs = set()
    curated = []
    for nc in nc_threat:
        for b in nc["blockerWastelands"]:
            seq = b.get("seq")
            if not seq or seq in seen_seqs:
                continue
            seen_seqs.add(seq)
            cell = grid[(b["r"], b["c"])]
            adj_combat = [c for c in neutral_4adj(b["r"], b["c"])
                           if c.get("landCat") == "combat"]
            curated.append(synth_war(cell, adj_combat))

    # auto1Hop = combat wastelands 1 hop from any S2864-owned cell, excluding
    # cells already in curated. Sorted by combat-spec priority then by score.
    own_set = set((c["r"], c["c"]) for c in cells if c.get("sid") == OWN_SID)
    reachable = set()
    for orc in own_set:
        for nb in four_neighbors(orc[0], orc[1], nrows, ncols, grid):
            cc = grid[nb]
            if cc.get("type") == 3 and cc.get("ownerSid", 0) == 0:
                reachable.add(nb)
    SPEC_PRIORITY = {4001: 0, 4006: 1, 4007: 2, 4008: 3, 4010: 4}
    auto1 = []
    candidates = []
    for rc in reachable:
        cell = grid[rc]
        seq = wasteland_seq(cell)
        if not seq or seq in seen_seqs:
            continue
        if cell.get("landCat") != "combat":
            continue
        candidates.append(cell)
    candidates.sort(key=lambda c: (SPEC_PRIORITY.get(c.get("specId"), 99), c["r"], c["c"]))
    for cell in candidates:
        seen_seqs.add(wasteland_seq(cell))
        adj_combat = [c for c in neutral_4adj(cell["r"], cell["c"])
                       if c.get("landCat") == "combat"]
        auto1.append(synth_war(cell, adj_combat))

    nc_targets_for_plan = []
    for nc in nc_threat:
        if nc["threatTier"] in ("HIGH", "MEDIUM"):
            nameMatch = re.search(r"#(\d+)", nc["name"] or "")
            nc_targets_for_plan.append({
                "nc": nc["name"],
                "r": nc["r"], "c": nc["c"],
                "level": nc["level"],
                "sid": 2864,
                "priority": "lock",
                "rationale": (
                    f"Our own Lv.{nc['level']} NC — {nc['threatTier'].lower()} threat. "
                    f"{nc['directThreatCount']} direct, {nc['twoHopCount']} 2-hop, "
                    f"{nc['threeHopCount']} 3-hop attackers within reach. "
                    f"Claim adjacent wastelands to deny staging."
                ),
            })

    r12_strategy = {
        "note": (
            f"Round 12 declaration phase — {len(curated)} blocker pick(s) "
            f"(defense) + {len(auto1)} combat opener(s) within 1 hop. "
            "Curated list = neutral wastelands adjacent to our L2/L3 NCs; "
            "auto1Hop = combat wastelands reachable from our footprint, "
            "prioritised ATK > HP > DMG Inc > DMG Red > DEF."
        ),
        "combatBuffSetupSeqs": [w["seq"] for w in curated + auto1],
        "ncTargets": nc_targets_for_plan,
        "curated": curated,
        "auto1Hop": auto1,
        "auto2Hop": [],
    }

    # ── NC capture flow ─────────────────────────────────────────
    # For each enemy-owned NC (type=2 cell with sid != 2864), figure out HOW
    # we can attack it at the upcoming NC battle:
    #   * viaOwnedNCs: our existing NCs that already sit 4-adjacent to this
    #     enemy NC (attackable NOW — no R12 wasteland win required).
    #   * viaWastelands: declared R12 wastelands 4-adjacent to it (capturing
    #     the wasteland this round unlocks the NC for the NC battle).
    # Anything reachable via neither path is omitted (out of 2-hop reach).
    declared_seqs = {w["seq"] for w in (r12.get("warTargets") or [])}
    seq_by_rc = {}
    nc_by_rc = {}
    for c in cells:
        if c.get("type") == 3:
            sq = wasteland_seq(c)
            if sq is not None:
                seq_by_rc[(c["r"], c["c"])] = sq
        elif c.get("type") == 2:
            nc_by_rc[(c["r"], c["c"])] = c

    nc_capture_flow = []
    declaration_nc_unlocks = defaultdict(list)
    for (rc, cell) in nc_by_rc.items():
        sid = cell.get("sid") or 0
        if sid == 0 or sid == OWN_SID:
            continue
        via_owned_ncs = []
        via_wastelands = []
        for nb in four_neighbors(rc[0], rc[1], nrows, ncols, grid):
            ncell = grid[nb]
            # Friendly NC adjacency → attackable now
            if ncell.get("type") == 2 and ncell.get("sid") == OWN_SID:
                via_owned_ncs.append(ncell.get("name") or "")
            # Declared wasteland adjacency → unlocks after R12 win
            elif ncell.get("type") == 3:
                sq = seq_by_rc.get(nb)
                if sq in declared_seqs:
                    via_wastelands.append(sq)
                    declaration_nc_unlocks[sq].append(cell.get("name") or "")
        if not via_owned_ncs and not via_wastelands:
            continue
        nc_capture_flow.append({
            "nc": cell.get("name") or "",
            "r": rc[0], "c": rc[1],
            "sid": sid,
            "level": str(cell.get("level") or 1),
            "viaWastelands": sorted(set(via_wastelands)),
            "viaOwnedNCs": list(dict.fromkeys(via_owned_ncs)),
        })
    # Sort: higher level first, then "attackable now" first
    nc_capture_flow.sort(
        key=lambda x: (-int(x["level"] or 1), 0 if x["viaOwnedNCs"] else 1)
    )
    declaration_nc_unlocks = {
        str(k): list(dict.fromkeys(v))
        for k, v in declaration_nc_unlocks.items()
    }

    # ── Persist ──────────────────────────────────────────────────
    r12["buffOverview"] = buff_overview
    r12["specToEffectTypeMap"] = SPEC_TO_EFFECT
    r12["eligibleTargets"] = eligible_targets
    r12["candidatesByCat"] = candidates_by_cat
    r12["strategicRecommendations"] = strategic
    r12["projectedBuffsFromDeclarations"] = {}  # empty until warTargets populate
    r12["ncThreatAnalysis"] = nc_threat
    r12["r12StrategyTargets"] = r12_strategy
    r12["isLastWastelandCycle"] = False  # R13 follows before NC battle
    r12["ncCaptureFlow"] = nc_capture_flow
    r12["declarationNcUnlocks"] = declaration_nc_unlocks

    # Match the existing on-disk format (single-line compact JSON) so git diffs
    # only show the actual delta rather than full reformatting churn.
    DATA.write_text(json.dumps(data, ensure_ascii=False))
    print(f"OK — updated rounds['12']: ncThreatAnalysis={len(nc_threat)}, "
          f"buffOverview={len(buff_overview)}, strategicRecs={len(strategic)}, "
          f"candidatesByCat={candidates_by_cat}, "
          f"ncCaptureFlow={len(nc_capture_flow)}, "
          f"declarationNcUnlocks={len(declaration_nc_unlocks)}")

def _fmt_val(v, paraType):
    if paraType == 2:
        return f"{v/100:g}%"
    return str(v)

if __name__ == "__main__":
    main()
