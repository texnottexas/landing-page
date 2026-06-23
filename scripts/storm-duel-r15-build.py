#!/usr/bin/env python3
"""
Build data/storm-duel-round15.json for the Storm Duel Selection page (R15, cid 4).

Inputs:
  - Live game extraction (cores + 16 candidates + 20-sector wasteland sweep) embedded
    below, captured 2026-06-22 ~17:10 UTC during the random/selection window. Sectors for
    this round are groups 102-121 (our home sector = 110). Per-warzone wasteland holdings
    captured as a specId histogram and classified by conqueror_2025_landtype.
  - data/ssc-merit-leaderboard.json — game-wide SSC personal merit (R14, {sid,score,name}).

Output:
  - data/storm-duel-round15.json — per-warzone merit aggregates + Power Index v3, baked.

Power Index v3 (merit leads, combat-buffs are a strong secondary factor):
  score = (0.32*meritNorm + 0.22*top5Norm + 0.13*wzNorm + 0.08*depthNorm + 0.25*combatNorm)
          * 100 * costMul
  *Norm = candidate value / pool max ; costMul = 1 + (300 - ticket)/300 * 0.15

Notes:
  - We (S2864) are the DEFENSE core and won the dice 55-16, so we pick first.
  - In-game the S2864 warzone leader is temporarily "Jerky" during selections; per Tex the
    page displays him as "Tex" (DISPLAY_OVERRIDE).

Re-run after any refresh:  python3 scripts/storm-duel-r15-build.py
"""
import json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
MERIT_PATH = os.path.join(DATA, "ssc-merit-leaderboard.json")
# Private raw dump (carries uid + avatar + nationalflag). Used ONLY to attach public
# avatars/flags to the merit Top-10 rows — UIDs are never written to the public output.
RAW_MERIT_PATH = os.path.join(HERE, "..", "..", "s2864-playerdata", "ssc-merit-leaderboard-r14-raw.json")
# Private Kartz Trial (Endless PVE) dump — carries uid on individuals. Used ONLY to build
# the public per-server top-5 individuals / top-2 alliances; UIDs never reach public output.
KARTZ_RAW_PATH = os.path.join(HERE, "..", "..", "s2864-playerdata", "kartz-trial-r15-raw.json")
OUT_PATH = os.path.join(DATA, "storm-duel-round15.json")

EXTRACTED_AT = 1782234600  # 2026-06-22 ~17:10 UTC (approx snapshot time)

# conqueror_2025_landtype: specId -> category
CAT = {
    4001: "combat", 4006: "combat", 4007: "combat", 4008: "combat", 4010: "combat",
    4002: "econ", 4003: "econ", 4004: "econ", 4015: "econ",
    4016: "util", 4017: "util", 4018: "util",
    4080: "special",
}

META = {
    "extractedAt": EXTRACTED_AT,
    "cid": 4,
    "round": 15,
    "status": 30,
    "phase": "selection (random pool drawn, ally picks open Jun 25)",
    "budget": 1000,
    "ourCoreSid": 2864,
    "oppCoreSid": 3436,
    "ourSide": "defense",
    "dice": {"us": 55, "opp": 16, "winnerSid": 2864, "wePickFirst": True},
    "roundPicks": [1, 2, 2, 2, 1],
    "diceWinnerRounds": [0, 2, 4],
    "diceWinnerSide": "ally",
    "tierCosts": [320, 300, 200, 100],
    "sectorGroups": list(range(102, 122)),
    "timestamps": {
        "allBeginTime": 1781452800,
        "randomBeginTime": 1782144000,    # Jun 22 16:00 UTC (pool draw open)
        "randomEndTime": 1782208800,      # Jun 23 10:00 UTC (pool draw closes)
        "viewTime": 1782316800,
        "selectAreaTime": 1782403200,     # Jun 25 16:00 UTC (ally selection opens)
        "waitFightBeginTime": 1782489600, # Jun 26 16:00 UTC
        "fightBeginTime": 1782568800,     # Jun 27 14:00 UTC
        "fightEndTime": 1782572400,       # Jun 27 15:00 UTC
    },
    "combatSpecIds": [4001, 4006, 4007, 4008, 4010],
    "buffLabels": {
        "4001": "All Units ATK", "4006": "All Units HP", "4007": "All Units DMG+",
        "4008": "All Units DMG-", "4010": "All Units DEF",
    },
    "powerIndexFormula": {
        "description": "Composite 0-100 score blending player strength (merit) with the "
                       "warzone's home-sector combat wasteland buffs and current Kartz Trial "
                       "form. Cheaper tickets get a small discount so affordable allies are not "
                       "penalised.",
        "weights": {"merit": 0.296, "top5avg": 0.22, "warzoneScore": 0.13,
                    "rankedDepth": 0.064, "combat": 0.25, "kartz": 0.04},
        "costMulFormula": "1 + (300 - ticket)/300 * 0.15",
        "normalization": "max-in-candidate-pool",
        "version": 4,
        "combatNote": "Combat buffs are an honest COUNT of combat wastelands (specId in "
                      "[ATK,HP,DMG+,DMG-,DEF]) the warzone holds in its home sector. The game "
                      "does not expose wasteland upgrade level in bulk, so counts are not "
                      "tier-weighted.",
        "kartzNote": "R15 addition: a light Kartz Trial form factor (top-end signal = 0.6 best "
                     "alliance score + 0.4 best player standing in the global top 500, "
                     "normalised to the pool). Weighted 0.04 - just enough to break near-ties "
                     "toward warzones showing strong current Kartz form, not to dominate.",
    },
}

CDN = "https://knight-cdn.akamaized.net/headimg/"
TEX_AVATAR = CDN + "2df7bb0a6e87f111c639de52ca69f570_1743783669.jpg?v=1743783670942"

# Per-warzone home sector group + wasteland specId histogram (from the 102-121 sweep).
SWEEP = {
    2864: {"group": 110, "spec": {4001:4,4003:2,4006:6,4007:8,4008:4,4010:7,4016:1,4017:1,4018:1,4080:1}},
    3436: {"group": 113, "spec": {4001:2,4002:3,4003:3,4004:1,4006:4,4007:3,4008:2,4010:3,4015:4,4016:2,4017:3,4018:3}},
    3088: {"group": 105, "spec": {4001:2,4002:1,4004:1,4006:5,4008:9,4010:6,4015:2,4016:3,4018:1}},
    216:  {"group": 117, "spec": {4001:3,4003:4,4006:4,4007:4,4008:1,4010:6,4015:2,4016:5,4017:1,4018:6}},
    1281: {"group": 117, "spec": {4001:3,4002:6,4004:1,4006:2,4007:6,4008:2,4010:3,4015:3,4016:4,4018:1}},
    1607: {"group": 110, "spec": {4001:2,4002:3,4003:4,4004:1,4006:2,4007:3,4008:3,4010:3,4015:2,4016:6,4017:3,4018:3}},
    2781: {"group": 119, "spec": {4001:1,4006:3,4007:1,4010:3,4016:2,4018:2}},
    1257: {"group": 118, "spec": {4002:1,4003:2,4004:1,4006:1,4007:1,4008:1,4015:1,4016:1,4018:3,4080:2}},
    1508: {"group": 120, "spec": {4001:6,4002:2,4003:1,4004:3,4006:2,4007:3,4008:7,4010:4,4015:1,4016:3,4017:3,4018:3}},
    1692: {"group": 120, "spec": {4001:1,4002:1,4004:1,4006:2,4008:2,4010:1,4016:1,4017:1,4018:1,4080:2}},
    2116: {"group": 111, "spec": {4001:1,4002:2,4003:3,4004:2,4006:2,4008:1,4010:1,4015:1,4016:1,4017:1}},
    2735: {"group": 111, "spec": {4001:1,4002:1,4003:3,4004:2,4006:2,4007:1,4008:1,4015:1,4016:2,4017:2,4018:1}},
    3766: {"group": 121, "spec": {4001:1,4002:3,4003:2,4006:1,4007:2,4008:1,4015:1,4016:4,4017:2}},
    654:  {"group": 119, "spec": {4001:1,4002:4,4004:1,4006:1,4008:2,4010:1,4015:1,4016:1}},
    973:  {"group": 116, "spec": {4002:1,4004:1,4006:2,4016:1,4017:2,4018:1}},
    3343: {"group": 119, "spec": {4002:3,4003:1,4004:2,4015:1,4016:2,4017:1,4018:2}},
    3646: {"group": 120, "spec": {4002:1,4004:1,4006:3,4007:3,4008:2,4010:1,4017:1}},
    3852: {"group": 112, "spec": {4003:2,4004:1,4006:2,4010:1,4018:2}},
}

# Selection state (cores + 16 candidates) from viewTeam, captured 2026-06-22.
CORES = {
    "us":  {"sid": 2864, "name": "Tex",  "flag": 233, "leaderAvatar": TEX_AVATAR, "warzoneScore": 1875},
    "opp": {"sid": 3436, "name": "PP",   "flag": 122, "leaderAvatar": CDN + "785e8fe38359402c27943cd8baa607ff_1744125282.jpg?v=1744125284079", "warzoneScore": 854},
}

CANDIDATES = [
    {"sid": 3088, "leaderName": "구니🎀",     "leaderFlag": 122, "leaderAvatar": CDN + "6f2e3ebf1d8d9fc49c86641a33450308_1775388856.png?v=1775388857551", "cost": 320, "warzoneScore": 1043},
    {"sid": 216,  "leaderName": "れいrei",    "leaderFlag": 43,  "leaderAvatar": CDN + "410af3d2ebc518f24dedb5e39311507d_1745188681.jpg?v=1745188681618", "cost": 300, "warzoneScore": 782},
    {"sid": 1281, "leaderName": "🦅吉田くん",  "leaderFlag": 114, "leaderAvatar": CDN + "86f577e4b77b024d259e402a2ba15de6_1744570257.jpg?v=1744570258884", "cost": 300, "warzoneScore": 658},
    {"sid": 1607, "leaderName": "DANTE",     "leaderFlag": 110, "leaderAvatar": CDN + "243a87448d0de59272a16f97d2ce0ef6_1766450069.png?v=1766450072380", "cost": 300, "warzoneScore": 823},
    {"sid": 2781, "leaderName": "Hallmake",  "leaderFlag": 233, "leaderAvatar": CDN + "14b113cf6e0fd4ec01634e423ea6ae5c_1751925135.jpg?v=1751925138146", "cost": 300, "warzoneScore": 464},
    {"sid": 1257, "leaderName": "Cardinal",  "leaderFlag": 233, "leaderAvatar": CDN + "299e2f914d2d4534bd6aad4ff38c3534_1762613281.png?v=1762613283474", "cost": 200, "warzoneScore": 153},
    {"sid": 1508, "leaderName": "McFarm😑",   "leaderFlag": 233, "leaderAvatar": CDN + "572af47bb6e28662f7e14a2c92420693_1752976737.jpg?v=1752976739697", "cost": 200, "warzoneScore": 818},
    {"sid": 1692, "leaderName": "深雪",       "leaderFlag": 114, "leaderAvatar": CDN + "169e2ccc4804f48c3d29574cf1a56079_1765123651.png?v=1765123651808", "cost": 200, "warzoneScore": 525},
    {"sid": 2116, "leaderName": "Wrangler",  "leaderFlag": 233, "leaderAvatar": CDN + "6c8909f9e4a1fd7399c0f9e249a5f974_1745415952.jpg?v=1745415954839", "cost": 200, "warzoneScore": 149},
    {"sid": 2735, "leaderName": "SoulleSs",  "leaderFlag": 225, "leaderAvatar": CDN + "416895145308.jpg?v=1704226304467", "cost": 200, "warzoneScore": 275},
    {"sid": 3766, "leaderName": "Lee³⁷⁶⁶",    "leaderFlag": 77,  "leaderAvatar": CDN + "e9a99ab30f0b13c25c625a9f4210c3dd_1774954159.png?v=1774954161598", "cost": 200, "warzoneScore": 521},
    {"sid": 654,  "leaderName": "hinagiku",  "leaderFlag": 48,  "leaderAvatar": CDN + "47bc7f4b78c8f5edc38298e9d1c0c274.jpg?v=1696886579363", "cost": 100, "warzoneScore": 168},
    {"sid": 973,  "leaderName": "Mimi☕️",    "leaderFlag": 118, "leaderAvatar": CDN + "7b7ac4dc5c815ffb2f4df8192a3cf94d_1745336015.jpg?v=1745336017869", "cost": 100, "warzoneScore": 141},
    {"sid": 3343, "leaderName": "Audi",      "leaderFlag": 57,  "leaderAvatar": CDN + "44930e2808a73eed941e3b127a8a834c_1746433889.jpg?v=1746433892106", "cost": 100, "warzoneScore": 133},
    {"sid": 3646, "leaderName": "TERU",      "leaderFlag": 114, "leaderAvatar": CDN + "c381a89922529a7c8a18d104a6128968_1781086817.png?v=1781086817863", "cost": 100, "warzoneScore": 157},
    {"sid": 3852, "leaderName": "Garuda",    "leaderFlag": 105, "leaderAvatar": CDN + "2bde33b122523a8a53162c4f852891c6_1744205807.jpg?v=1744205810214", "cost": 100, "warzoneScore": 145},
]


def attach_wl(d):
    """Attach group + wasteland category counts + spec breakdown from the sweep."""
    sw = SWEEP.get(d["sid"], {"group": 0, "spec": {}})
    spec = sw["spec"]
    cats = {"combat": 0, "econ": 0, "util": 0, "special": 0}
    for sp, n in spec.items():
        cats[CAT.get(sp, "special")] += n
    d["group"] = sw["group"]
    d["combat"] = cats["combat"]
    d["econ"] = cats["econ"]
    d["util"] = cats["util"]
    d["special"] = cats["special"]
    d["totalWL"] = sum(spec.values())
    d["spec"] = {str(k): v for k, v in sorted(spec.items())}
    return d


def load_avatar_lookup():
    """(sid, name, score) -> {avatar, flag} from the private raw dump. Avatars/flags are
    public game data; uid is intentionally NOT carried through. Best-effort — returns {}
    if the raw dump isn't present."""
    if not os.path.exists(RAW_MERIT_PATH):
        print("  (raw merit dump not found — Top-10 avatars will fall back to initials)")
        return {}
    with open(RAW_MERIT_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    entries = raw["entries"] if isinstance(raw, dict) and "entries" in raw else raw
    look = {}
    for e in entries:
        look[(e["sid"], e.get("name") or "", e["score"])] = {
            "avatar": e.get("avatar"), "flag": e.get("nationalflag"),
        }
    return look


def load_merit_by_sid():
    with open(MERIT_PATH, encoding="utf-8") as f:
        lb = json.load(f)
    entries = lb["entries"]
    ranked = sorted(enumerate(entries), key=lambda kv: kv[1]["score"], reverse=True)
    by_sid = collections.defaultdict(list)
    for gr, (_, e) in enumerate(ranked, start=1):
        by_sid[e["sid"]].append((gr, e.get("name") or "", e["score"]))
    return lb.get("metadata", {}), by_sid


def merit_aggregate(sid, by_sid, av_lookup):
    players = by_sid.get(sid, [])
    scores = [p[2] for p in players]
    top5 = scores[:5]
    top10 = []
    for (r, n, s) in players[:10]:
        row = {"rank": r, "name": n, "score": s}
        a = av_lookup.get((sid, n, s))
        if a:
            if a.get("avatar"):
                row["avatar"] = a["avatar"]
            if a.get("flag") is not None:
                row["flag"] = a["flag"]
        top10.append(row)
    return {
        "totalWarzoneMerit": sum(scores),
        "meritPlayerCount": len(players),
        "meritTop5Avg": round(sum(top5) / len(top5)) if top5 else 0,
        "meritTop1": scores[0] if scores else 0,
        "meritTop10": top10,
    }


def load_kartz(sel_sids):
    """Build the public Kartz Trial per-server block (top-5 individuals, top-2 alliances)
    for the servers in our storm-duel selection. Strips uid; keeps public avatar/flag."""
    if not os.path.exists(KARTZ_RAW_PATH):
        print("WARN: kartz raw not found (%s) -- skipping kartz block" % KARTZ_RAW_PATH)
        return None
    with open(KARTZ_RAW_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    ind = raw.get("individual", [])
    alli = raw.get("alliance", [])

    def pind(r):
        return {"rank": r["rank"], "name": r.get("username", ""), "flag": r.get("nationalflag", 0),
                "avatar": r.get("avatar") or "", "damage": r.get("damageShow")}

    def palli(r):
        return {"rank": r["rank"], "tag": r.get("aTag", ""), "name": r.get("aName", ""), "score": r.get("score", 0)}

    per = {}
    for s in sel_sids:
        si = sorted([r for r in ind if r.get("sid") == s], key=lambda z: z["rank"])
        sa = sorted([r for r in alli if r.get("sid") == s], key=lambda z: z["rank"])
        per[str(s)] = {
            "topIndividuals": [pind(r) for r in si[:5]],
            "indivInTop500": len(si),
            "topAlliances": [palli(r) for r in sa[:2]],
            "allianceCount": len(sa),
        }
    block = {
        "asOf": raw.get("asOf"),
        "individualCap": raw.get("individualCap", 500),
        "allianceTotal": raw.get("allianceTotal", len(alli)),
        "perServer": per,
    }
    assert "uid" not in json.dumps(block), "UID leaked into public kartz block"
    return block


def main():
    merit_meta, by_sid = load_merit_by_sid()
    av_lookup = load_avatar_lookup()
    META["meritExtractedAt"] = merit_meta.get("extracted_at")
    META["meritUnit"] = "SSC personal merit (game-wide, R%s dump)" % merit_meta.get("round")

    out_us = attach_wl(dict(CORES["us"])); out_us.update(merit_aggregate(out_us["sid"], by_sid, av_lookup))
    out_opp = attach_wl(dict(CORES["opp"])); out_opp.update(merit_aggregate(out_opp["sid"], by_sid, av_lookup))

    cands = []
    for c in CANDIDATES:
        d = attach_wl(dict(c))
        d.update(merit_aggregate(c["sid"], by_sid, av_lookup))
        cands.append(d)

    # Kartz Trial per-server data point (selection servers only): top-5 players + top-2 alliances.
    # Loaded before the Power Index so its top-end form can feed a light R15-only PI factor.
    sel_sids = [out_us["sid"], out_opp["sid"]] + [c["sid"] for c in CANDIDATES]
    kartz = load_kartz(sel_sids)

    # Per-candidate Kartz form metric: 0.6 * best alliance score + 0.4 * best player standing
    # (501 - global rank, 0 if none in the top 500). Top-end signal, not breadth.
    def kartz_raw(sid):
        if not kartz:
            return 0.0
        e = kartz["perServer"].get(str(sid), {})
        ti = e.get("topIndividuals") or []
        ta = e.get("topAlliances") or []
        best_alli = ta[0]["score"] if ta else 0
        best_indiv = (501 - ti[0]["rank"]) if ti else 0
        return best_alli, best_indiv

    if kartz:
        mxa = max((kartz_raw(c["sid"])[0] for c in cands), default=0) or 1
        mxi = max((kartz_raw(c["sid"])[1] for c in cands), default=0) or 1
        for c in cands:
            a, i = kartz_raw(c["sid"])
            c["_kartzRaw"] = 0.6 * (a / mxa) + 0.4 * (i / mxi)
        mx_kartz_raw = max((c["_kartzRaw"] for c in cands), default=0) or 1
        for c in cands:
            c["kartzNorm"] = round(c["_kartzRaw"] / mx_kartz_raw, 4)
            del c["_kartzRaw"]
    else:
        for c in cands:
            c["kartzNorm"] = 0.0

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
                W["combat"] * c["combatNorm"] + W.get("kartz", 0) * c["kartzNorm"])
        c["powerIndex"] = round(base * 100 * c["costMul"], 1)
        c["valuePerTicket"] = round(c["totalWarzoneMerit"] / c["cost"])

    for rank, c in enumerate(sorted(cands, key=lambda x: x["powerIndex"], reverse=True), start=1):
        c["powerRank"] = rank

    out = {"meta": META, "us": out_us, "opp": out_opp, "candidates": cands}
    if kartz:
        out["kartz"] = kartz

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {OUT_PATH}  ({os.path.getsize(OUT_PATH)} bytes)")
    print(f"Merit dump: round {merit_meta.get('round')} / {merit_meta.get('total_entries')} entries")
    print(f"\n{'sid':>5} {'leader':12} {'cost':>4} {'wz':>4} {'comb':>4} {'merit(M)':>8} {'top5(M)':>7} {'depth':>5} {'PI':>5} {'rk':>3}")
    for c in sorted(cands, key=lambda x: x["powerIndex"], reverse=True):
        print(f"{c['sid']:>5} {c['leaderName'][:12]:12} {c['cost']:>4} {c['warzoneScore']:>4} "
              f"{c['combat']:>4} {c['totalWarzoneMerit']/1e6:>8.1f} {c['meritTop5Avg']/1e6:>7.2f} "
              f"{c['meritPlayerCount']:>5} {c['powerIndex']:>5} {c['powerRank']:>3}")
    print(f"\nCores:  us S2864 merit {out_us['totalWarzoneMerit']/1e6:.0f}M combat {out_us['combat']}"
          f"  |  opp S3436 merit {out_opp['totalWarzoneMerit']/1e6:.0f}M combat {out_opp['combat']}")


if __name__ == "__main__":
    main()
