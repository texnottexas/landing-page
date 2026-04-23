# Elemental Enhancements — Round 6 (Cycle 2) Deployment Plan

_Internal coordination doc for Server 2864 leadership · 90-minute window_

> **Context:** second Wasteland Publicity → Contest cycle of Round 6. Sector 32. This plan supersedes any earlier target list — please reconcile your marches to the priorities below before Contest opens.

---

## Snapshot

| Metric | Value |
|---|---|
| Server rank | **#46** (3,900 pts) |
| Holdings | 13 Lv.3 wastelands · 9 Neutral Cities · Warzone core |
| Roster | ~250 deployed · ~500 marches |
| Expected active in the 90-min window | **~150 players** |
| Daily attack budget (active × 10-18) | **~1,500 – 2,700 attacks** total |
| Declarations on the board | 45 offensive · 6 incoming defensive |
| Ally this round | **S1397** (comparable size, tactical coordination only — no standing comms channel) |
| Primary rival | **S3396** (active warzone) |
| Secondary contestants | S2463, S3940, S2953, S3649, S1120, S1677, S208 |

---

## Read this first: garrison ≠ attack

Two completely decoupled commitments per player:

- **Garrison** — where your 2 marches sit for the round. Adds hearts to that wasteland's defensive pool. Stuck there.
- **Attacks** — your personal 10-18 attack budget for the day. Spent on **any** wasteland, regardless of where you're garrisoned.

That decoupling is the whole plan. A player can garrison in an uncontested PvE wasteland (padding our hearts so we win that target passively) **while spending every one of their attacks on a PvP front**. Garrison and attacks get optimized independently.

```mermaid
flowchart LR
    P[Player] --> G[Garrison choice<br/>1 wasteland<br/>contributes hearts]
    P --> A[Attack budget<br/>10-18 strikes<br/>spent anywhere]
    G -.no link.-> A

    classDef p fill:#79c0ff,color:#0d1117
    classDef gar fill:#3fb950,color:#fff
    classDef atk fill:#f85149,color:#fff

    class P p
    class G gar
    class A atk
```

**Priority order:**
1. **Win PvP fights first** — these are the hard fights that need real attack investment and concentrated garrison.
2. **Flood PvE garrisons second** — soaks up any remaining players cheaply, since PvE doesn't counter-attack.
3. **Attack PvE only when necessary** — just enough to push our heart count past theirs, then pivot immediately.

---

## Why concentration beats spreading

Each active player has a **personal daily attack budget** — ~10 attacks if the enemy plays optimally (empty small ships), up to ~18 with compound bonuses (only when the enemy leaves smalls manned). Across 150 active that's a ceiling of ~2,700 attacks **for the entire day, across every front combined**.

45 declarations ÷ 150 active = 3 players/target average — loses every fight. Concentrate on 8-12 targets instead, and we take them all.

```mermaid
flowchart LR
    AP[150 active players] --> BUD[Daily attack pool<br/>1,500–2,700 total]
    BUD --> PVPBOX[PvP focus-fire<br/>~1,000 attacks<br/>for 2 captures]
    BUD --> PVEBOX[PvE top-up attacks<br/>~300-500 attacks<br/>supports 6-8 captures<br/>if garrison is flooded]
    GAR[250 deployed players<br/>2,500 hearts to distribute] --> PVPGAR[PvP garrison<br/>~80 players<br/>~800 hearts]
    GAR --> PVEGAR[PvE garrison flood<br/>~130 players<br/>~1,300 hearts spread across 8]

    PVPBOX --> WINS[Captures: 2 PvP]
    PVEGAR --> WINS2[Captures: 6-8 PvE via heart-count tiebreaker]

    classDef pool fill:#79c0ff,color:#0d1117
    classDef atk fill:#f85149,color:#fff
    classDef gar fill:#3fb950,color:#fff
    classDef win fill:#d29922,color:#0d1117

    class AP,BUD,GAR pool
    class PVPBOX,PVEBOX atk
    class PVPGAR,PVEGAR gar
    class WINS,WINS2 win
```

---

## Buff-gap priorities (what new captures unlock)

Combat buffs stack globally up to effect caps. These are the biggest gaps we can close this cycle:

| Effect | Current | Cap | Gap | Notes |
|---|---:|---:|---:|---|
| 🔴 **DMG Reduction** | 45% | 300% | **85%** | Each Lv.3 wasteland = +45%. 3 eligible targets. |
| 🔴 **DMG Increase** | 45% | 300% | **85%** | Each Lv.3 wasteland = +45%. 4 eligible. |
| 🔴 **HP Buff** | 270% | 1800% | **85%** | Each Lv.3 = +270%. 5 eligible. |
| 🟡 Realm Thief (pass drop) | 10% | 50% | 80% | Utility, lower priority |
| 🟠 **DEF Buff** | 30% | 100% | 70% | Each Lv.3 = +15%. 6 eligible. |
| 🟠 **ATK Buff** | 540% | 1800% | 70% | Each Lv.3 = +270%. 6 eligible. |
| 🟢 Train Passenger | 1 | 3 | 67% | Utility, skip |
| 🟢 Realm March Speed | 40% | 100% | 60% | Utility, skip |

Combat Lv.3 captures compound — buffs apply to every battle we fight for the rest of the event. Order: HP → DMG Inc → DMG Red → DEF → ATK.

---

## Deployment tiers

### Tier A — PvP focus-fire (2 targets, top priority)

"Win these or we wasted the day." Winnable 1v1s against secondary-tier rivals. These are the hard-attrition fights where garrison **and** attack both matter.

| Target | Spec | Opponent | Garrison | Attack focus | Posture |
|:---:|---|---|---:|---:|---|
| **W-192** | HP Buff Lv.3 | S1120 (1v1) | 40 players | ~400 attacks concentrated here | Mothership only · **smalls empty** |
| **W-5** | DMG Increase Lv.3 | S1677 (1v1) | 40 players | ~400 attacks concentrated here | Mothership only · **smalls empty** |

**Rules for Tier A:**
- **Fill Mothership, nothing in Sweeper or Patrol.** Denies the opponent compound bonuses — caps them at 10 flat per player.
- Garrisoned players should spend their attacks on their own target (focused fire, no split).
- Any surplus attacks from elsewhere pile onto whichever Tier A target has better kill progress near T-30.

### Tier B — Coordination play (conditional)

| Target | Spec | Opponent | Plan |
|:---:|---|---|---|
| **W-208** | DMG Increase Lv.3 | S3396 | Message S1397 to pile on a S3396 declaration. If they commit, we reinforce with **25 garrison + ~250 attacks**. If not, leave the declaration passive — no attacks there. |

### Tier C — PvE garrison flood (6-8 passive captures)

**The strategy here is garrison-first, attack-minimal.** Since PvE opponents don't attack us, every march we commit to a PvE wasteland is pure heart padding. Flood garrison wide, and attacks to each target drop dramatically — or hit zero.

**The math (per Lv.3 PvE wasteland, 220 total hearts):**

| Our garrison | Our hearts | Attacks needed to cross threshold |
|---:|---:|---|
| 10 players (20 marches) | 100 | **Kill 121 of their hearts** (PvE smalls first) |
| 15 players | 150 | **Kill 71** |
| 20 players | 200 | **Kill 21** |
| 22 players | **220** | **Kill 1** (or 0 — passive tiebreaker wins it) |
| 25+ players | 250+ | **Zero attacks** — passive win at timer |

**Spread ~130 garrison across 6-8 PvE targets (16-20 per target)**, then top up with minimal attacks. PvE smalls are always manned so compound bonuses apply — you need ~20-40 compound attacks per target to cross the threshold, freeing nearly all attack budget for Tier A/B.

**Target list (all uncontested Lv.3 combat):**

| Target | Spec | Garrison | Top-up attacks |
|:---:|---|---:|---:|
| **W-320** | HP Buff Lv.3 | 18 | ~40 |
| **W-269** | DEF Buff Lv.3 | 18 | ~40 |
| **W-250** | DMG Reduction Lv.3 | 18 | ~40 |
| **W-47** | ATK Buff Lv.3 | 18 | ~40 |
| **W-27** | ATK Buff Lv.3 | 18 | ~40 |
| **W-77** | Truck Transport Lv.3 | 18 | ~40 |

**Mid-battle rule — PIVOT FAST:** the moment our heart count exceeds the PvE Mothership's remaining hearts on a target, **every attacker immediately stops** hitting it and rerolls onto the next PvE target or a Tier A front. Staying past the pivot point is wasted budget.

### Tier D — Defense (garrison only, passive)

Defenders don't attack unless counter-raiding. Just need hearts on the wall.

| Target | Spec | Incoming | Garrison | Intent |
|:---:|---|---|---:|---|
| **W-92** | HP Buff Lv.3 | S3940 (1 attacker) | **12** | Real hold — Mothership packed, smalls empty |
| **W-93** | ATK Buff Lv.3 | S3940 + S2463 | 4 | Token — expected loss, don't overspend |
| **W-76** | Truck Transport | S2953 | 2 | Stall only |
| **W-58** | Realm | S2953 | 2 | Stall only |
| **W-356** | Realm | S3649 | 2 | Stall only |
| **W-357** | Truck Heist | S921 | 2 | Stall only |

### Tier E — Flex reserve

- **NC reinforcement** (when NC Declaration opens): 10 players ready to redeploy to #3004 / #3005 if contested.
- **Ally-response flex**: 10 players held for Tier B activation or late pile-on.

---

## Budget check

### Garrison (250 deployed)

| Tier | Players |
|---|---:|
| A — PvP focus | 80 |
| B — Ally assist (conditional) | 0 – 25 |
| C — PvE flood | 108 |
| D — Defense | 24 |
| E — Flex / NC | 20 |
| **Total committed** | **~232 – 257** |

Fits 250 deployed with ~20-player buffer.

### Attacks (150 active → 1,500 – 2,700 budget)

| Spend | Attacks |
|---|---:|
| A — PvP focus-fire (2 × ~400) | 800 |
| B — Ally assist (conditional) | 0 – 250 |
| C — PvE threshold top-ups (6 × ~40) | 240 |
| D — Defense counter-raid spare | 0 – 100 |
| Reserve / flex | 160 – 500+ |
| **Total projected** | **~1,200 – 1,890** |

Under-commits the upper range by design — gives buffer for Tier A attrition escalation or late Tier C pivot recoveries.

---

## Do Not Attack — without leadership confirmation

Declarations can't be withdrawn mid-round — these wastelands stay on our declaration list but **should not be attacked** unless a leader explicitly calls someone in. Garrisoning in them is fine (free hearts cost us nothing); spending attacks there is pure budget waste.

| Target | Spec | Why skip |
|:---:|---|---|
| **W-91** | ATK Lv.3 | 3-way vs S3396 + S3940. Budget hole. |
| **W-225** | DMG Red Lv.3 | 3-way vs S3396 + S2463. Budget hole. |
| **W-111** | DEF Lv.3 | S2463 entrenched owner. Hard to flip. |
| **W-215** | DMG Inc Lv.3 | S208 owner. Lower ROI. |
| **W-229** | DEF Lv.2 | Lower level. Skip for Lv.3 pickups. |
| All 17 contested non-combat | — | Below priority threshold. |
| 14 of 15 uncontested non-combat | — | Keep only W-77 (Truck Transport). |

---

## Ally message draft (S1397)

> "R6 Publicity 2 coordination from S2864: we're pushing W-192 (HP vs S1120), W-5 (DMG Inc vs S1677), plus 6 uncontested Lv.3 combat pickups (W-320, W-269, W-250, W-47, W-27, W-77). We're letting W-91, W-225, W-111, W-215 (the S3396/S2463 fronts) go — not spending attacks there. Can you pile on at least one S3396 wasteland? If you hit W-208, we'll reinforce with 25 players. Please confirm your top 3 so we de-conflict."

---

## Contingency triggers

| If… | Then… |
|---|---|
| Activity under 130 by T-30 min | Drop Tier B. Hold Tier A at 40 each. Trim Tier C to 5 targets, bump garrison per target to 22. |
| A Tier C target gets contested late | Stop attacking it — PvE economics don't hold vs a real defender. Redirect attacks to Tier E / another Tier C. |
| S1397 confirms S3396 focus-fire | Activate Tier B (+25 players from flex, +250 attacks). |
| We're ahead on both Tier A kills by T-30 | Commit flex attacks to the weaker one to guarantee both. |
| Lv.3 NC attack incoming | Pull 10 flex players to reinforce, MS-only posture. |

---

## Execution checklist

- [ ] **T-60:** Confirm active list — ping marchall heads for activity commitments.
- [ ] **T-45:** Broadcast the Do-Not-Attack list to all players — no attacks on W-91, W-225, W-111, W-215, W-229, or non-combat wastelands without a leader call.
- [ ] **T-30:** Final garrison in — Tier A at 40 each, Tier C at 18 each, Tier D at spec, Tier E in reserve.
- [ ] **T-15:** Confirm S1397 Tier B commit (yes/no) → activate W-208 or leave it as a passive declaration.
- [ ] **T-0:** Contest opens. **Focus-fire protocol:**
  - [ ] Tier A: all designated attackers focus the **same enemy Mothership in rotation** — no splitting.
  - [ ] Tier C: attackers hit PvE smalls first (cheap 1-heart kills trigger compound bonuses), then Mothership. **PIVOT** the moment our heart pool exceeds theirs — don't linger.
  - [ ] Defenders (Tier D): zero attack output unless a counter-raid window opens. Hold hearts.
  - [ ] Flex (Tier E): watch the Tier A kill-rate. Redirect attacks at T-60-minute mark if either fight is lagging.
  - [ ] Player discipline: no Rockfield, strongest march only, wait 10 sec for chat calls before spending an attack if it's close, ask a leader when unsure.

---

_Plan compiled 2026-04-22. Reviewed by Alfred and multi-subagent persona advisory passes before publication. Reconcile questions with coordination team before Contest opens._
