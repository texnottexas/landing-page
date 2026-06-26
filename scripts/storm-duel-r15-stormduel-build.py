#!/usr/bin/env python3
"""
Build data/storm-duel.json for the Storm Duel BATTLE-PLAN page (storm-duel.html), R15 / cid 4.

Almost all per-server data is reused from the Selection page's data/storm-duel-round15.json
(merit aggregates, wasteland combat buffs via the specId histogram, live Kartz Trial, warzone
score). The only freshly-extracted R15 inputs are:
  - the finalized squads (teams) + 300 Review-Troops marches  -> storm-duel-r15-marches.json (PRIVATE, uid)
  - the warzone fame ranking                                  -> storm-duel-r15-fame.json

Improvement over R13: Kartz Trial is LIVE this round (R13 showed an R11 reference), so each
warzone gets real kartz_individual / kartz_alliances and metadata carries NO kartz_reference.

Output rewrites data/storm-duel.json (UID-stripped). Re-run:
  python3 scripts/storm-duel-r15-stormduel-build.py
"""
import json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
ROUND15 = os.path.join(DATA, "storm-duel-round15.json")
MARCHES = os.path.join(DATA, "storm-duel-r15-marches.json")   # PRIVATE, gitignored (carries uid)
FAME    = os.path.join(DATA, "storm-duel-r15-fame.json")
MERIT   = os.path.join(DATA, "ssc-merit-leaderboard.json")    # public {sid,name,score}
TARGET  = os.path.join(DATA, "storm-duel.json")

ALLY_CORE, OPP_CORE = 2864, 3436
# core first, then by warzone score desc
ALLY_SIDS = [2864, 1508, 1281, 2781, 2735]
OPP_SIDS  = [3436, 3088, 1607, 1692, 3766]

CAT = {
    4001: "combat", 4006: "combat", 4007: "combat", 4008: "combat", 4010: "combat",
    4002: "economy", 4003: "economy", 4004: "economy", 4015: "economy",
    4016: "utility", 4017: "utility", 4018: "utility",
    4080: "special",
}
BUFF_NAME = {4001: "All Units ATK", 4006: "All Units HP", 4007: "All Units DMG+",
             4008: "All Units DMG-", 4010: "All Units DEF"}
L3_VALUE  = {4001: 270, 4006: 270, 4007: 45, 4008: 45, 4010: 15}
L3_CAPS   = {"All Units ATK": 1800, "All Units HP": 1800, "All Units DMG+": 300,
             "All Units DMG-": 300, "All Units DEF": 100}
SUM_KEY   = {"All Units ATK": "ATK_pct", "All Units HP": "HP_pct", "All Units DMG+": "DMG_plus_pct",
             "All Units DMG-": "DMG_minus_pct", "All Units DEF": "DEF_pct"}
UNIT_KEY  = {1: "Army", 2: "Navy", 3: "AirForce"}

r15 = json.load(open(ROUND15, encoding="utf-8"))
SRV = {r15["us"]["sid"]: r15["us"], r15["opp"]["sid"]: r15["opp"]}
for c in r15["candidates"]:
    SRV[c["sid"]] = c
KARTZ = r15["kartz"]["perServer"]
FAMED = json.load(open(FAME, encoding="utf-8"))["fame"]

# merit leaderboard: above-50k count per sid + (sid,name)->(rank,score) index
lb = json.load(open(MERIT, encoding="utf-8"))["entries"]
above50 = collections.Counter()
by_sid = collections.defaultdict(list)
for e in lb:
    if (e.get("score") or 0) >= 50000:
        above50[e["sid"]] += 1
    by_sid[e["sid"]].append(((e.get("name") or ""), e["score"]))
MERIT_IDX = {}
for sid, rows in by_sid.items():
    rows.sort(key=lambda r: r[1], reverse=True)
    m = {}
    for rank, (name, score) in enumerate(rows, start=1):
        m.setdefault(name.strip().lower(), (rank, score))
    MERIT_IDX[sid] = m

marches = json.load(open(MARCHES, encoding="utf-8"))["marches"]
GROUPED = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
for m in marches:
    GROUPED[m["side"]][UNIT_KEY[m["armyType"]]][m["sid"]].append(m)


def combat_buffs_L3(s):
    spec = {int(k): v for k, v in (s.get("spec") or {}).items()}
    byCat = {"combat": 0, "economy": 0, "utility": 0, "special": 0}
    for sp, n in spec.items():
        c = CAT.get(sp)
        if c:
            byCat[c] += n
    L3 = {}
    for spid, name in BUFF_NAME.items():
        L3[name] = min(spec.get(spid, 0) * L3_VALUE[spid], L3_CAPS[name])
    return {
        "wastelandTotal": sum(spec.values()),
        "combatWLs": byCat["combat"],
        "byCat": byCat,
        "bySprite": {},
        "L3_pct": L3,
        "L3_pct_caps": dict(L3_CAPS),
        "group": s.get("group"),
    }


def individual_merit(sid, s):
    top = []
    for t in (s.get("meritTop10") or []):
        top.append({"rank": t.get("rank"), "username": t.get("name"), "merit": t.get("score"),
                    "sid": sid, "avatar_url": t.get("avatar"), "flag": t.get("flag"), "playerInfo": None})
    return {
        "count": s.get("meritPlayerCount", 0),
        "best_rank": top[0]["rank"] if top else None,
        "merit_total": s.get("totalWarzoneMerit", 0),
        "top": top,
        "above_50k": above50.get(sid, 0),
    }


def kartz_individual(sid):
    k = KARTZ.get(str(sid), {}) or {}
    top = [{"rank": t["rank"], "username": t.get("name"), "avatar_url": t.get("avatar"),
            "flag": t.get("flag")} for t in (k.get("topIndividuals") or [])]
    return {"count": k.get("indivInTop500", 0), "best_rank": top[0]["rank"] if top else None, "top": top}


def kartz_alliances(sid):
    k = KARTZ.get(str(sid), {}) or {}
    al = [{"rank": a["rank"], "tag": a.get("tag"), "name": a.get("name"), "score": a.get("score")}
          for a in (k.get("topAlliances") or [])]
    return {"count": k.get("allianceCount", 0), "best_rank": al[0]["rank"] if al else None, "alliances": al}


def fame_obj(sid):
    f = FAMED.get(str(sid))
    if not f:
        return {"rank": None, "round_score": 0, "event_fame": 0, "serverFlag": None}
    return {"rank": f["rank"], "round_score": f["round_score"], "event_fame": f["event_fame"], "serverFlag": f["serverFlag"]}


def to_march(rec, rank):
    # The 3x3 grid lives at pos 1-3 / 11-13 / 21-23 (9 stacks). A "shark formation"
    # adds an extra reinforcement slot at pos -1 (~17-40 units) that inflates the
    # displayed army count but is NOT part of the real march size — exclude it.
    raw = rec.get("units") or []
    reinforcement = sum((u.get("num") or 0) for u in raw if (u.get("pos", 0) or 0) < 0)
    agg = collections.OrderedDict()
    for u in raw:
        if (u.get("pos", 0) or 0) < 0:
            continue
        agg[u["armyId"]] = agg.get(u["armyId"], 0) + (u.get("num") or 0)
    units = [{"armyId": aid, "num": num, "skinId": 0} for aid, num in agg.items()]
    march_size = sum(u["num"] for u in units)
    lead_army = max(units, key=lambda u: u["num"])["armyId"] if units else 0
    heroes = []
    for h in (rec.get("heroes") or []):
        hh = {"heroId": h["heroId"], "level": h.get("level"), "star": h.get("star")}
        if h.get("awakenLevel"):
            hh["awakenLevel"] = h["awakenLevel"]
            hh["fullAwaken"] = h.get("fullAwaken", False)
        heroes.append(hh)
    merit = merit_rank = None
    hit = MERIT_IDX.get(rec["sid"], {}).get((rec.get("name") or "").strip().lower())
    if hit:
        merit_rank, merit = hit[0], hit[1]
    return {
        "username": rec.get("name"), "sid": rec["sid"], "power": rec.get("power"), "rank": rank,
        "avatar_url": rec.get("avatar"), "flag": rec.get("flag"),
        "heroes": heroes, "march_size": march_size, "armyId": lead_army, "units": units,
        "reinforcement": reinforcement,  # shark-formation extra (excluded from march_size)
        "merit": merit, "merit_rank": merit_rank,
    }


def build_warzone(sid, side, is_core):
    s = SRV[sid]
    leader = s.get("leaderName") or s.get("name")
    flag = s.get("leaderFlag") if s.get("leaderFlag") is not None else s.get("flag")
    avatar = s.get("leaderAvatar")
    formations = {}
    for unit in ("Army", "Navy", "AirForce"):
        recs = sorted(GROUPED[side][unit].get(sid, []), key=lambda r: (r.get("power") or 0), reverse=True)
        formations[unit] = [to_march(r, i + 1) for i, r in enumerate(recs)]
    return {
        "sid": sid, "team": [], "is_leader": is_core,
        "squad": {
            "sid": sid, "leader": leader, "score": s.get("warzoneScore"),
            "ticket": 0 if is_core else s.get("cost", 0),
            "country_id": flag, "leader_avatar": avatar, "leader_in_game_avatar": None, "flag": flag,
        },
        "combat_buffs_L3": combat_buffs_L3(s),
        "individual_merit": individual_merit(sid, s),
        "fame": fame_obj(sid),
        "kartz_individual": kartz_individual(sid),
        "kartz_alliances": kartz_alliances(sid),
        "formations": formations,
        "storm_score": s.get("warzoneScore"),
        "ticket": 0 if is_core else s.get("cost", 0),
        "meritTop5Avg": s.get("meritTop5Avg"),
        "powerIndex": None, "powerRank": None, "valuePerTicket": None,
    }


def build_side(sids):
    warzones = [build_warzone(sid, "ally" if sids is ALLY_SIDS else "opp", sid == sids[0]) for sid in sids]
    # totals
    t = {
        "round_score_sum": sum(z["fame"]["round_score"] or 0 for z in warzones),
        "event_fame_sum": sum(z["fame"]["event_fame"] or 0 for z in warzones),
        "wastelands_sum": sum(z["combat_buffs_L3"]["wastelandTotal"] for z in warzones),
        "combat_wls_sum": sum(z["combat_buffs_L3"]["combatWLs"] for z in warzones),
        "combat_buffs_sum": {v: sum(z["combat_buffs_L3"]["L3_pct"][k] for z in warzones) for k, v in SUM_KEY.items()},
        "merit_top10_sum": sum(sum((e["merit"] or 0) for e in z["individual_merit"]["top"]) for z in warzones),
        "march_power_sum": {u: sum(m["power"] or 0 for z in warzones for m in z["formations"][u]) for u in ("Army", "Navy", "AirForce")},
        "total_ticket": sum(z["squad"]["ticket"] or 0 for z in warzones),
        "total_marches": sum(len(z["formations"][u]) for z in warzones for u in ("Army", "Navy", "AirForce")),
        "total_power": sum((m["power"] or 0) for z in warzones for u in ("Army", "Navy", "AirForce") for m in z["formations"][u]),
        "above_50k_sum": sum(z["individual_merit"]["above_50k"] for z in warzones),
        "merit_ranked_sum": sum(z["individual_merit"]["count"] for z in warzones),
    }
    return {"totals": t, "warzones": warzones}


def main():
    meta_r15 = r15["meta"]
    ts = meta_r15["timestamps"]
    out = {
        "metadata": {
            "extracted_at": meta_r15.get("extractedAt"),
            "cid": 4, "round": 15,
            "phase": "forces assemble (picks locked, marches assembled, pre-fight)",
            "fight_status": meta_r15.get("status", 30),
            "ally_core_sid": ALLY_CORE, "opp_core_sid": OPP_CORE,
            "ally_sids": ALLY_SIDS, "opp_sids": OPP_SIDS,
            "schedule": {
                "status": meta_r15.get("status", 30),
                "allBeginTime": ts.get("allBeginTime"),
                "randomBeginTime": ts.get("randomBeginTime"),
                "randomEndTime": ts.get("randomEndTime"),
                "selectAreaTime": ts.get("selectAreaTime"),
                "waitFightBeginTime": ts.get("waitFightBeginTime"),
                "fightBeginTime": ts.get("fightBeginTime"),
                "fightEndTime": ts.get("fightEndTime"),
                "viewTime": ts.get("viewTime"),
            },
            "s2864_home_sector_group": 110,
            "note": "S2864 is the core on the DEFENSE side (cMid=2864). S3436 (PP) is the opposing attack core. "
                    "Opponent drafted S3088 (our top-rated candidate); we took 1508/1281/2781/2735.",
            "buff_constants": {
                "All Units ATK_L3": "270%", "All Units HP_L3": "270%", "All Units DMG+_L3": "45%",
                "All Units DMG-_L3": "45%", "All Units DEF_L3": "15%",
            },
            "buff_caps": {"All Units ATK": 1800, "All Units HP": 1800, "All Units DMG+": 300,
                          "All Units DMG-": 300, "All Units DEF": 100},
            "selection": {
                "budget": meta_r15.get("budget", 1000),
                "tierCosts": meta_r15.get("tierCosts"),
                "roundPicks": meta_r15.get("roundPicks"),
            },
            "data_status": {
                "marches": "live", "formations": "live",
                "kartz": "live", "fame": "live",
                "merit_current_round": "live",
                "merit_ssc_reference_round": "SSC R14",
            },
            "groupId": 110,
            "merit_depth": len(lb),
        },
        "ally": build_side(ALLY_SIDS),
        "opp": build_side(OPP_SIDS),
    }

    # privacy sweep: no uid anywhere in public output
    def strip_uids(o):
        if isinstance(o, dict):
            o.pop("uid", None)
            for v in o.values():
                strip_uids(v)
        elif isinstance(o, list):
            for v in o:
                strip_uids(v)
    strip_uids(out)
    assert "uid" not in json.dumps(out), "UID leaked into public storm-duel.json"

    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {TARGET} ({os.path.getsize(TARGET)} bytes)")
    for side, sids in (("ALLY", ALLY_SIDS), ("OPP", OPP_SIDS)):
        s = out["ally"] if side == "ALLY" else out["opp"]
        print(f"\n{side}: marches={s['totals']['total_marches']} power={s['totals']['total_power']:,} "
              f"ticket={s['totals']['total_ticket']} above50k={s['totals']['above_50k_sum']}")
        for z in s["warzones"]:
            f = z["fame"]; cb = z["combat_buffs_L3"]
            nm = sum(len(z["formations"][u]) for u in ("Army", "Navy", "AirForce"))
            print(f"  S{z['sid']:<5} {z['squad']['leader'][:12]:12} wz={z['squad']['score']} "
                  f"fame#{f['rank']} ev={f['event_fame']:,} combatWL={cb['combatWLs']} "
                  f"kartzIndiv={z['kartz_individual']['count']} kartzAlli={z['kartz_alliances']['count']} marches={nm}")


if __name__ == "__main__":
    main()
