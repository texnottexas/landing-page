#!/usr/bin/env python3
"""
Build data/storm-duel-round13.json for the Storm Duel Selection page (R13, cid 4).

Inputs:
  - Live game extraction (cores + 16 candidates) — embedded below, captured 2026-06-09
    ~04:40 UTC during the random/selection window. Includes ticket cost, warzone score,
    home sector group, and per-server wasteland holdings classified by conqueror_2025_landtype.
  - data/ssc-merit-leaderboard.json — game-wide SSC personal merit (R12, {sid,score,name}).

Output:
  - data/storm-duel-round13.json — per-warzone merit aggregates + Power Index v3, baked.

Power Index v3 (merit leads, combat-buffs are a strong secondary factor):
  score = (0.32*meritNorm + 0.22*top5Norm + 0.13*wzNorm + 0.08*depthNorm + 0.25*combatNorm)
          * 100 * costMul
  *Norm = candidate value / pool max ; costMul = 1 + (300 - ticket)/300 * 0.15

Re-run after any roster/extraction refresh:  python3 scripts/storm-duel-r13-build.py
"""
import json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MERIT_PATH = os.path.join(DATA, "ssc-merit-leaderboard.json")
OUT_PATH = os.path.join(DATA, "storm-duel-round13.json")

EXTRACTED_AT = 1749444000  # 2026-06-09 06:00 UTC (approx snapshot time)

META = {
    "extractedAt": EXTRACTED_AT,
    "cid": 4,
    "round": 13,
    "status": 30,
    "phase": "selection (random pool drawn, ally picks open Jun 11)",
    "budget": 1000,
    "ourCoreSid": 2864,
    "oppCoreSid": 4197,
    "ourSide": "defense",
    "dice": {"us": 56, "opp": 8, "winnerSid": 2864, "wePickFirst": True},
    # standard Storm Duel draft structure; dice winner (us) picks rounds 1,3,5
    "roundPicks": [1, 2, 2, 2, 1],
    "diceWinnerRounds": [0, 2, 4],   # 0-indexed -> rounds 1,3,5 (the dice winner = us)
    "diceWinnerSide": "ally",         # we won the roll, so "ally" (us) is the winner side
    "tierCosts": [300, 200, 100],
    "timestamps": {
        "allBeginTime": 1780243200,       # May 31 16:00 UTC
        "randomBeginTime": 1780934400,    # Jun  8 16:00 UTC
        "randomEndTime": 1780999200,      # Jun  9 10:00 UTC (pool draw closes)
        "selectAreaTime": 1781193600,     # Jun 11 12:00 UTC (ally selection opens)
        "waitFightBeginTime": 1781280000, # Jun 12 16:00 UTC
        "fightBeginTime": 1781359200,     # Jun 13 14:00 UTC
        "fightEndTime": 1781362800,       # Jun 13 15:00 UTC
    },
    "combatSpecIds": [4001, 4006, 4007, 4008, 4010],
    "buffLabels": {
        "4001": "All Units ATK", "4006": "All Units HP", "4007": "All Units DMG+",
        "4008": "All Units DMG-", "4010": "All Units DEF",
    },
    "powerIndexFormula": {
        "description": "Composite 0-100 score blending player strength (merit) with the "
                       "warzone's home-sector combat wasteland buffs. Cheaper tickets get a "
                       "small discount so affordable allies are not penalised.",
        "weights": {"merit": 0.32, "top5avg": 0.22, "warzoneScore": 0.13,
                    "rankedDepth": 0.08, "combat": 0.25},
        "costMulFormula": "1 + (300 - ticket)/300 * 0.15",
        "normalization": "max-in-candidate-pool",
        "version": 3,
        "combatNote": "Combat buffs are an honest COUNT of combat wastelands (specId in "
                      "[ATK,HP,DMG+,DMG-,DEF]) the warzone holds in its home sector. The game "
                      "does not expose wasteland upgrade level in bulk, so counts are not "
                      "tier-weighted.",
    },
}

CORES = {
    "us":  {"sid": 2864, "name": "Tex", "flag": 233, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/2df7bb0a6e87f111c639de52ca69f570_1743783669.jpg?v=1743783670942", "warzoneScore": 1458, "group": 90, "combat": 21, "econ": 6, "util": 5, "special": 0, "totalWL": 32, "spec": {"4002": 3, "4003": 1, "4004": 1, "4006": 6, "4007": 6, "4008": 3, "4010": 6, "4015": 1, "4017": 1, "4018": 4}},
    "opp": {"sid": 4197, "name": "mohd", "flag": 187, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/7581553298257.jpg?v=1692871707031", "warzoneScore": 1826, "group": 82, "combat": 37, "econ": 21, "util": 16, "special": 1, "totalWL": 75, "spec": {"4001": 7, "4002": 3, "4003": 9, "4004": 1, "4006": 7, "4007": 10, "4008": 6, "4010": 7, "4015": 8, "4016": 4, "4017": 7, "4018": 5, "4080": 1}},
}

CANDIDATES = [
    {"sid": 1805, "leaderName": "MAC", "leaderFlag": 77, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/0d77c58b689934246c04c4ee626d5256_1760953877.png?v=1760953879648", "cost": 300, "warzoneScore": 589, "group": 85, "combat": 9, "econ": 7, "util": 5, "special": 0, "totalWL": 21, "spec": {"4001": 1, "4002": 3, "4003": 2, "4004": 2, "4006": 3, "4007": 2, "4008": 1, "4010": 2, "4016": 3, "4017": 1, "4018": 1}},
    {"sid": 1816, "leaderName": "Kuro", "leaderFlag": 114, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/547980314392.jpg?v=1699994376829", "cost": 300, "warzoneScore": 890, "group": 94, "combat": 23, "econ": 6, "util": 8, "special": 0, "totalWL": 37, "spec": {"4001": 5, "4003": 2, "4004": 1, "4006": 4, "4007": 3, "4008": 7, "4010": 4, "4015": 3, "4016": 7, "4018": 1}},
    {"sid": 2973, "leaderName": "QQQ", "leaderFlag": 38, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/888715512338.jpg?v=1715746832281", "cost": 300, "warzoneScore": 301, "group": 92, "combat": 3, "econ": 6, "util": 8, "special": 0, "totalWL": 17, "spec": {"4001": 2, "4002": 2, "4003": 1, "4004": 1, "4007": 1, "4015": 2, "4016": 5, "4017": 2, "4018": 1}},
    {"sid": 3088, "leaderName": "구니🎀", "leaderFlag": 122, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/6f2e3ebf1d8d9fc49c86641a33450308_1775388856.png?v=1775388857551", "cost": 300, "warzoneScore": 879, "group": 97, "combat": 20, "econ": 4, "util": 4, "special": 0, "totalWL": 28, "spec": {"4001": 2, "4004": 3, "4006": 4, "4007": 7, "4008": 2, "4010": 5, "4015": 1, "4016": 1, "4017": 1, "4018": 2}},
    {"sid": 3407, "leaderName": "냉면만듀_Jus", "leaderFlag": 198, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/a2b82e047cc6b451b7c27f40cc8624b9_1755386929.jpg?v=1755386932074", "cost": 300, "warzoneScore": 746, "group": 100, "combat": 20, "econ": 14, "util": 7, "special": 0, "totalWL": 41, "spec": {"4001": 5, "4002": 4, "4003": 2, "4004": 6, "4006": 4, "4007": 2, "4008": 4, "4010": 5, "4015": 2, "4016": 1, "4017": 3, "4018": 3}},
    {"sid": 3885, "leaderName": "Bobobooo", "leaderFlag": 20, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/872995a6a72f7ff79fd22ae033000a66_1755945101.jpg?v=1755945103103", "cost": 220, "warzoneScore": 308, "group": 89, "combat": 5, "econ": 2, "util": 1, "special": 0, "totalWL": 8, "spec": {"4003": 1, "4006": 1, "4007": 1, "4008": 2, "4010": 1, "4015": 1, "4017": 1}},
    {"sid": 485, "leaderName": "フィノ", "leaderFlag": 114, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/a819d7c5280906482521316cd4e68514_1745334777.jpg?v=1745334778718", "cost": 200, "warzoneScore": 286, "group": 82, "combat": 4, "econ": 8, "util": 3, "special": 0, "totalWL": 15, "spec": {"4002": 1, "4003": 2, "4004": 3, "4006": 1, "4007": 2, "4010": 1, "4015": 2, "4016": 2, "4018": 1}},
    {"sid": 864, "leaderName": "小包子⁸⁶⁴", "leaderFlag": 228, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/0748a244fde5523a7c3b26168f3252a4_1742550646.jpg?v=1742550647190", "cost": 200, "warzoneScore": 177, "group": 85, "combat": 8, "econ": 1, "util": 6, "special": 0, "totalWL": 15, "spec": {"4001": 1, "4002": 1, "4006": 4, "4007": 2, "4010": 1, "4016": 1, "4017": 1, "4018": 4}},
    {"sid": 1692, "leaderName": "深雪", "leaderFlag": 114, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/169e2ccc4804f48c3d29574cf1a56079_1765123651.png?v=1765123651808", "cost": 200, "warzoneScore": 470, "group": 83, "combat": 9, "econ": 4, "util": 3, "special": 1, "totalWL": 17, "spec": {"4003": 1, "4004": 2, "4006": 2, "4007": 4, "4008": 2, "4010": 1, "4015": 1, "4016": 1, "4017": 2, "4080": 1}},
    {"sid": 3532, "leaderName": "duck", "leaderFlag": 48, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/74edcf2d664db24913d5ebc0dad1fa65_1757598375.jpg?v=1757598376573", "cost": 200, "warzoneScore": 353, "group": 89, "combat": 6, "econ": 1, "util": 5, "special": 0, "totalWL": 12, "spec": {"4001": 1, "4002": 1, "4006": 3, "4007": 1, "4010": 1, "4016": 3, "4018": 2}},
    {"sid": 3649, "leaderName": "ᗪᗩᖇKOᑎÉ", "leaderFlag": -1, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/21a8fd7e093af1cc7b7e2dd5a071bb11_1775424723.png?v=1775424725739", "cost": 200, "warzoneScore": 165, "group": 86, "combat": 12, "econ": 16, "util": 8, "special": 1, "totalWL": 37, "spec": {"4001": 7, "4002": 6, "4003": 5, "4004": 1, "4007": 1, "4008": 1, "4010": 3, "4015": 4, "4016": 1, "4017": 1, "4018": 6, "4080": 1}},
    {"sid": 271, "leaderName": "snidd", "leaderFlag": 114, "leaderAvatar": None, "cost": 100, "warzoneScore": 191, "group": 86, "combat": 5, "econ": 1, "util": 3, "special": 0, "totalWL": 9, "spec": {"4001": 1, "4004": 1, "4006": 2, "4007": 1, "4008": 1, "4016": 2, "4017": 1}},
    {"sid": 2373, "leaderName": "Starlord", "leaderFlag": 233, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/851395299653.jpg?v=1723914452134", "cost": 100, "warzoneScore": 126, "group": 89, "combat": 9, "econ": 7, "util": 3, "special": 0, "totalWL": 19, "spec": {"4001": 3, "4002": 4, "4003": 2, "4004": 1, "4006": 2, "4007": 2, "4008": 1, "4010": 1, "4016": 3}},
    {"sid": 3309, "leaderName": "Napin🍯", "leaderFlag": 114, "leaderAvatar": None, "cost": 100, "warzoneScore": 172, "group": 82, "combat": 7, "econ": 10, "util": 0, "special": 0, "totalWL": 17, "spec": {"4001": 1, "4002": 6, "4007": 1, "4008": 3, "4010": 2, "4015": 4}},
    {"sid": 4108, "leaderName": "r🌘cman", "leaderFlag": 57, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/1c5384142fdfa82cd4c2a9cb9c319519_1761605466.png?v=1761605467757", "cost": 100, "warzoneScore": 109, "group": 87, "combat": 6, "econ": 1, "util": 1, "special": 0, "totalWL": 8, "spec": {"4001": 1, "4002": 1, "4006": 1, "4007": 1, "4008": 1, "4010": 2, "4016": 1}},
    {"sid": 4198, "leaderName": "W4R", "leaderFlag": 225, "leaderAvatar": "https://knight-cdn.akamaized.net/headimg/0b4917a213f6025d756afee49520bb81_1778768704.png?v=1778768706314", "cost": 100, "warzoneScore": 245, "group": 92, "combat": 11, "econ": 4, "util": 8, "special": 0, "totalWL": 23, "spec": {"4001": 4, "4002": 2, "4003": 1, "4004": 1, "4006": 1, "4007": 2, "4008": 2, "4010": 2, "4016": 4, "4017": 2, "4018": 2}},
]


def load_merit_by_sid():
    """Returns (by_sid: sid -> list[(global_rank, name, score)] sorted by score desc)."""
    with open(MERIT_PATH, encoding="utf-8") as f:
        lb = json.load(f)
    entries = lb["entries"]
    # global rank = position in score-desc ordering across the whole game
    ranked = sorted(enumerate(entries), key=lambda kv: kv[1]["score"], reverse=True)
    by_sid = collections.defaultdict(list)
    for gr, (_, e) in enumerate(ranked, start=1):
        by_sid[e["sid"]].append((gr, e.get("name") or "", e["score"]))
    return lb.get("metadata", {}), by_sid


def merit_aggregate(sid, by_sid):
    players = by_sid.get(sid, [])  # already score-desc (rank asc)
    scores = [p[2] for p in players]
    total = sum(scores)
    count = len(players)
    top5 = scores[:5]
    top5avg = round(sum(top5) / len(top5)) if top5 else 0
    top10 = [{"rank": r, "name": n, "score": s} for (r, n, s) in players[:10]]
    return {
        "totalWarzoneMerit": total,
        "meritPlayerCount": count,
        "meritTop5Avg": top5avg,
        "meritTop1": scores[0] if scores else 0,
        "meritTop10": top10,
    }


def main():
    merit_meta, by_sid = load_merit_by_sid()
    META["meritExtractedAt"] = merit_meta.get("extracted_at")
    META["meritUnit"] = "SSC personal merit (game-wide, R12 dump)"

    # cores
    out_us = dict(CORES["us"]); out_us.update(merit_aggregate(CORES["us"]["sid"], by_sid))
    out_opp = dict(CORES["opp"]); out_opp.update(merit_aggregate(CORES["opp"]["sid"], by_sid))

    # candidates: attach merit
    cands = []
    for c in CANDIDATES:
        d = dict(c)
        d.update(merit_aggregate(c["sid"], by_sid))
        cands.append(d)

    # pool maxima for normalization
    mx_merit = max(c["totalWarzoneMerit"] for c in cands) or 1
    mx_top5 = max(c["meritTop5Avg"] for c in cands) or 1
    mx_wz = max(c["warzoneScore"] for c in cands) or 1
    mx_depth = max(c["meritPlayerCount"] for c in cands) or 1
    mx_combat = max(c["combat"] for c in cands) or 1
    W = META["powerIndexFormula"]["weights"]

    for c in cands:
        c["meritNorm"] = round(c["totalWarzoneMerit"] / mx_merit, 4)
        c["top5Norm"] = round(c["meritTop5Avg"] / mx_top5, 4)
        c["wzNorm"] = round(c["warzoneScore"] / mx_wz, 4)
        c["depthNorm"] = round(c["meritPlayerCount"] / mx_depth, 4)
        c["combatNorm"] = round(c["combat"] / mx_combat, 4)
        c["costMul"] = round(1 + (300 - c["cost"]) / 300 * 0.15, 4)
        base = (W["merit"] * c["meritNorm"] + W["top5avg"] * c["top5Norm"] +
                W["warzoneScore"] * c["wzNorm"] + W["rankedDepth"] * c["depthNorm"] +
                W["combat"] * c["combatNorm"])
        c["powerIndex"] = round(base * 100 * c["costMul"], 1)
        c["valuePerTicket"] = round(c["totalWarzoneMerit"] / c["cost"])

    # power rank
    for rank, c in enumerate(sorted(cands, key=lambda x: x["powerIndex"], reverse=True), start=1):
        c["powerRank"] = rank

    out = {"meta": META, "us": out_us, "opp": out_opp, "candidates": cands}
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    # console summary
    print(f"Wrote {OUT_PATH}  ({os.path.getsize(OUT_PATH)} bytes)")
    print(f"Merit dump: round {merit_meta.get('round')} / {merit_meta.get('total_entries')} entries")
    print(f"\n{'sid':>5} {'leader':12} {'cost':>4} {'wz':>4} {'comb':>4} {'merit(M)':>8} {'top5(M)':>7} {'depth':>5} {'PI':>5} {'rank':>4}")
    for c in sorted(cands, key=lambda x: x["powerIndex"], reverse=True):
        print(f"{c['sid']:>5} {c['leaderName'][:12]:12} {c['cost']:>4} {c['warzoneScore']:>4} "
              f"{c['combat']:>4} {c['totalWarzoneMerit']/1e6:>8.1f} {c['meritTop5Avg']/1e6:>7.2f} "
              f"{c['meritPlayerCount']:>5} {c['powerIndex']:>5} {c['powerRank']:>4}")
    print(f"\nCores:  us S2864 merit {out_us['totalWarzoneMerit']/1e6:.0f}M combat {out_us['combat']}"
          f"  |  opp S4197 merit {out_opp['totalWarzoneMerit']/1e6:.0f}M combat {out_opp['combat']}")


if __name__ == "__main__":
    main()
