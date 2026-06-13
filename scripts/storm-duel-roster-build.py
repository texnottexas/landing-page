#!/usr/bin/env python3
"""
Build data/storm-duel-roster.json — the searchable player->assignment roster for
the R13 Storm Battle Plan page.

Eligibility (per Tex): any player on an ALLIED server with SSC merit >= 50000
(the project's established merit_depth threshold) can be placed.

Assignment model (R13 — S2864 defense core vs S4197 attack core):
  OFFENSE / invade S4197  -> S2864 (majority of bigs) + S3407
  DEFENSE / hold  S2864   -> S271 + S4108 + S3088 (+ ~20% of S2864 rotate home)
  Anchors (always defense): Tex & PeeWee on S2864 hold the home Capital + key ruins.

S2864 is SPLIT: defaulted to offense, flagged split=true so the page can note the
~20% home-defense rotation; the two named anchors are forced to defense.

Source: data/ssc-merit-leaderboard.json (game-wide, already public). Re-run after a
fresh leaderboard pull: python3 scripts/storm-duel-roster-build.py
"""
import json, os, collections

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
LB = os.path.join(DATA, "ssc-merit-leaderboard.json")
OUT = os.path.join(DATA, "storm-duel-roster.json")

THRESHOLD = 50000
TARGET_HOLD = 240                      # bring total home-defense roster to ~240
ALLY_SIDS = [2864, 271, 3407, 4108, 3088]
OFFENSE_SIDS = {2864, 3407}            # invade S4197
ANCHORS = {2864: {"tex", "peewee"}}    # forced DEFENSE (lower-cased name match)


def main():
    lb = json.load(open(LB, encoding="utf-8"))
    players = []
    for e in lb["entries"]:
        sid = e["sid"]
        if sid not in ALLY_SIDS:
            continue
        score = e.get("score") or 0
        if score < THRESHOLD:
            continue
        name = (e.get("name") or "").strip()
        if not name:
            continue
        anchor = name.lower() in ANCHORS.get(sid, set())
        if anchor:
            role = "hold"
        elif sid in OFFENSE_SIDS:
            role = "invade"
        else:
            role = "hold"
        rec = {"name": name, "sid": sid, "merit": score, "role": role}
        if anchor:
            rec["anchor"] = True
        players.append(rec)

    # Home-defense rotation: pull the lowest-merit non-anchor S2864 players from
    # invade -> hold until total defense reaches TARGET_HOLD (~20% of S2864). Keeps
    # the big hitters attacking; the smaller home accounts hold our battlefield.
    cur_hold = sum(1 for p in players if p["role"] == "hold")
    need = max(0, TARGET_HOLD - cur_hold)
    if need:
        cand = sorted(
            (p for p in players if p["sid"] == 2864 and p["role"] == "invade" and not p.get("anchor")),
            key=lambda p: p["merit"])
        for p in cand[:need]:
            p["role"] = "hold"
            p["home_rotation"] = True

    players.sort(key=lambda p: p["merit"], reverse=True)

    counts = collections.Counter(p["role"] for p in players)
    by_sid = collections.Counter(p["sid"] for p in players)

    out = {
        "meta": {
            "round": 13,
            "threshold": THRESHOLD,
            "source": lb.get("metadata", {}).get("round_label") or "SSC R12 leaderboard",
            "ally_sids": ALLY_SIDS,
            "opp_core_sid": 4197,
            "self_core_sid": 2864,
            "offense_sids": sorted(OFFENSE_SIDS),
            "total": len(players),
            "by_role": dict(counts),
            "by_sid": {str(k): v for k, v in sorted(by_sid.items())},
        },
        "players": players,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Wrote {OUT}  ({os.path.getsize(OUT)} bytes)")
    print(f"  total eligible (>= {THRESHOLD}): {len(players)}")
    print(f"  by role: {dict(counts)}")
    for s in ALLY_SIDS:
        print(f"  S{s}: {by_sid.get(s,0)}")
    anchors = [p["name"] for p in players if p.get("anchor")]
    print(f"  anchors (forced defense): {anchors}")


if __name__ == "__main__":
    main()
