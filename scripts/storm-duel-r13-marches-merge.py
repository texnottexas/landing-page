#!/usr/bin/env python3
"""
Merge the R13 Review-Troops march extraction into data/storm-duel.json so the
storm-duel.html Marches tab can render it.

Inputs (all in data/):
  - storm-duel-r13-marches.json  (300 marches from ActivityReviewTroops; see
    scripts note / memory reference_storm_duel "Review Troops" recipe)
  - ssc-merit-leaderboard.json   (per-player SSC merit; best-effort join by sid+name)
  - storm-duel.json              (target; warzones already scaffolded, formations empty)

Output: rewrites data/storm-duel.json with:
  - {side}.warzones[].formations.{Army,Navy,AirForce} populated (shape matches the
    prior deployment: username,uid,sid,power,rank,avatar_url,flag,heroes[],march_size,
    armyId,units[],merit,merit_rank)
  - {side}.totals.march_power_sum/{total_marches,total_power} recomputed
  - metadata.data_status.marches/formations flipped to "live"

Re-run after a fresh extraction: python3 scripts/storm-duel-r13-marches-merge.py
"""
import json, os, collections

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MARCHES = os.path.join(DATA, "storm-duel-r13-marches.json")
MERIT = os.path.join(DATA, "ssc-merit-leaderboard.json")
TARGET = os.path.join(DATA, "storm-duel.json")
UNIT_KEY = {1: "Army", 2: "Navy", 3: "AirForce"}
SIDE_KEY = {"ally": "ally", "enemy": "opp"}


def build_merit_index():
    """sid -> { lower(name) -> (rank_within_sid, score) }, rank 1-based by score desc."""
    lb = json.load(open(MERIT, encoding="utf-8"))
    by_sid = collections.defaultdict(list)
    for e in lb["entries"]:
        by_sid[e["sid"]].append((e.get("name") or "", e["score"]))
    idx = {}
    for sid, rows in by_sid.items():
        rows.sort(key=lambda r: r[1], reverse=True)
        m = {}
        for rank, (name, score) in enumerate(rows, start=1):
            m.setdefault(name.strip().lower(), (rank, score))  # first (best) wins on dup names
        idx[sid] = m
    return idx


def to_march(rec, rank, merit_idx):
    # aggregate per-position units by armyId
    agg = collections.OrderedDict()
    for u in (rec.get("units") or []):
        aid = u["armyId"]
        agg[aid] = agg.get(aid, 0) + (u.get("num") or 0)
    units = [{"armyId": aid, "num": num, "skinId": 0} for aid, num in agg.items()]
    march_size = sum(u["num"] for u in units)
    lead_army = max(units, key=lambda u: u["num"])["armyId"] if units else 0
    heroes = []
    for h in (rec.get("heroes") or []):
        hh = {"heroId": h["heroId"], "level": h.get("level"), "star": h.get("star")}
        if h.get("awakenLevel"):
            hh["awakenLevel"] = h["awakenLevel"]; hh["fullAwaken"] = h.get("fullAwaken", False)
        heroes.append(hh)
    merit = merit_rank = None
    hit = merit_idx.get(rec["sid"], {}).get((rec.get("name") or "").strip().lower())
    if hit:
        merit_rank, merit = hit[0], hit[1]
    return {
        "username": rec.get("name"), "uid": rec.get("uid"), "sid": rec["sid"],
        "power": rec.get("power"), "rank": rank,
        "avatar_url": rec.get("avatar"), "flag": rec.get("flag"),
        "heroes": heroes, "march_size": march_size, "armyId": lead_army, "units": units,
        "merit": merit, "merit_rank": merit_rank,
    }


def main():
    marches = json.load(open(MARCHES, encoding="utf-8"))["marches"]
    merit_idx = build_merit_index()
    tgt = json.load(open(TARGET, encoding="utf-8"))

    # group extraction: side -> unit -> sid -> [recs] (power desc)
    grouped = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
    for m in marches:
        grouped[m["side"]][UNIT_KEY[m["armyType"]]][m["sid"]].append(m)

    filled_join = 0
    for ext_side, tgt_side in SIDE_KEY.items():
        side_obj = tgt[tgt_side]
        psum = {"Army": 0, "Navy": 0, "AirForce": 0}
        nmarch = 0; tpow = 0
        for z in side_obj["warzones"]:
            sid = z["sid"]
            z.setdefault("formations", {})
            for unit in ("Army", "Navy", "AirForce"):
                recs = grouped[ext_side][unit].get(sid, [])
                recs.sort(key=lambda r: (r.get("power") or 0), reverse=True)
                out = [to_march(r, i + 1, merit_idx) for i, r in enumerate(recs)]
                z["formations"][unit] = out
                for o in out:
                    psum[unit] += o["power"] or 0
                    nmarch += 1; tpow += o["power"] or 0
                    if o["merit"]:
                        filled_join += 1
        side_obj["totals"]["march_power_sum"] = psum
        side_obj["totals"]["total_marches"] = nmarch
        side_obj["totals"]["total_power"] = tpow

    ds = tgt["metadata"].setdefault("data_status", {})
    ds["marches"] = "live"
    ds["formations"] = "live"
    tgt["metadata"]["marches_extracted_at"] = json.load(open(MARCHES, encoding="utf-8"))["meta"].get("round") and tgt["metadata"].get("extracted_at")

    json.dump(tgt, open(TARGET, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # summary
    print(f"Wrote {TARGET} ({os.path.getsize(TARGET)} bytes)")
    for side in ("ally", "opp"):
        t = tgt[side]["totals"]
        print(f"  {side}: marches={t['total_marches']} power_sum={t['march_power_sum']}")
        for z in tgt[side]["warzones"]:
            f = z["formations"]
            print(f"    S{z['sid']:<5} Army {len(f['Army']):>2} Navy {len(f['Navy']):>2} Air {len(f['AirForce']):>2}")
    print(f"  merit joined on {filled_join} marches")
    print(f"  data_status.marches={ds['marches']} formations={ds['formations']}")


if __name__ == "__main__":
    main()
