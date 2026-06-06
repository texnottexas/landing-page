#!/usr/bin/env python3
"""Build storm-battle-plan.json — R12 Neutral City battle allocation for S2864.

Targets (verified live from CQ25Controller declareData, 2026-06-06):
  - Storm's Eye (L4 throne, id 40899899) : 3-way, S2864 vs S386 + S2036 -> the prize
  - #3008 (L3, owner 386)                : S2864 capture (sole attacker)  -> offense
  - #3001 (L3, owner 2864)               : defend vs S2036                -> defense

Rule (auto-assign; Tex tweaks after):
  - Pool = roster players with lastShowTime within the last 2 days (active-48h).
  - Each L3 gets ONE top anchor (a "big") + a mid-size support team.
  - Storm's Eye (priority) keeps the whale core + everyone else; at burn stage
    ALL players converge on Storm's Eye.

Output: landing-page/data/storm-battle-plan.json
Re-run after a fresh roster refresh (player-data.json drives it).
"""
import json, time, os

ROOT = '/Users/shivabezwada/tw-projects/landing-page'
PD   = os.path.join(ROOT, 'player-data.json')
OUT  = os.path.join(ROOT, 'data', 'storm-battle-plan.json')

# ---- tunables ----
ACTIVE_WINDOW_DAYS = 2      # only allocate players seen within this many days
MID_TEAM_SIZE      = 12     # support players per L3 (in addition to the 1 big)
BATTLE_START_TS    = 1780754400   # live fightBeginTime = 2026-06-06 10:00 AM EDT

TARGETS = [
    {"id":"stormseye","label":"Storm's Eye","ncId":"Storm's Eye","level":4,
     "kind":"prize","opponents":[386,2036],
     "headline":"The prize. We fight S386 and S2036 here at once.",
     "note":"Majority of the roster. At the burn stage, EVERYONE converges here."},
    {"id":"nc3008","label":"Neutral City #3008","ncId":"#3008","level":3,
     "kind":"capture","opponents":[386],
     "headline":"Capture from S386 (we are the only attacker).",
     "note":"One big + a mid-size team. Rotate to Storm's Eye for the burn stage."},
    {"id":"nc3001","label":"Neutral City #3001","ncId":"#3001","level":3,
     "kind":"defend","opponents":[2036],
     "headline":"Defend ours from S2036.",
     "note":"One big + a mid-size team. Rotate to Storm's Eye for the burn stage."},
]

def main():
    pd = json.load(open(PD))
    now = int(time.time())
    cutoff = now - ACTIVE_WINDOW_DAYS * 86400

    real = [p for p in pd if p.get('alliance') != 'DEV*']
    active = [p for p in real if (p.get('lastShowTime') or 0) >= cutoff]
    active.sort(key=lambda p: -(p.get('power') or 0))

    assign = {}   # siteKey -> (target_id, role)

    # 1) bigs: top-2 active anchor the two L3s
    if len(active) >= 1: assign[active[0]['siteKey']] = ('nc3008', 'big')   # capture, our 2nd-hardest fight
    if len(active) >= 2: assign[active[1]['siteKey']] = ('nc3001', 'big')   # defend

    # 2) mid teams: pull from the MIDDLE of the power distribution so Storm's Eye
    #    keeps its whale core. Split alternately to balance the two L3s.
    rest = [p for p in active if p['siteKey'] not in assign]
    if rest:
        center = len(rest) // 2
        half = MID_TEAM_SIZE
        lo = max(0, center - half)
        mid_slice = rest[lo: lo + MID_TEAM_SIZE * 2]
        for i, p in enumerate(mid_slice):
            assign[p['siteKey']] = ('nc3008' if i % 2 == 0 else 'nc3001', 'mid')

    # 3) everyone else (active only) -> Storm's Eye core
    players = []
    for p in active:
        tgt, role = assign.get(p['siteKey'], ('stormseye', 'core'))
        players.append({
            'siteKey': p['siteKey'], 'name': p['name'], 'alliance': p['alliance'],
            'power': p.get('power'), 'profession': p.get('profession'),
            'avatarurl': p.get('avatarurl'), 'nationalflag': p.get('nationalflag'),
            'lastShowTime': p.get('lastShowTime'),
            'target': tgt, 'role': role,
        })

    out = {
        'meta': {
            'round': 12, 'event': 'Neutral City Battle', 'ownSid': 2864,
            'battleStartTs': BATTLE_START_TS,
            'activeWindowDays': ACTIVE_WINDOW_DAYS,
            'midTeamSize': MID_TEAM_SIZE,
            'generatedAt': now,
            'pool': len(active), 'rosterTotal': len(real),
            'inactiveExcluded': len(real) - len(active),
        },
        'targets': TARGETS,
        'players': players,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)

    from collections import Counter
    by = Counter(p['target'] for p in players)
    print(f"Wrote {OUT}")
    print(f"  active-{ACTIVE_WINDOW_DAYS}d pool: {len(active)} / {len(real)} (excluded {len(real)-len(active)})")
    for t in TARGETS:
        bigs = [p['name'] for p in players if p['target']==t['id'] and p['role']=='big']
        print(f"  {t['label']:<22} {by.get(t['id'],0):>3}  big={bigs}")

if __name__ == '__main__':
    main()
