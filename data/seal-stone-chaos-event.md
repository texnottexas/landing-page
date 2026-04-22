# Seal Stone Chaos — Event Reference

_Also known as: **Ultimate Dominators (UD)**, **Conqueror 2025**, **SSC**_

Top War's 15-round inter-server warzone event. Warzones fight over a 24×24 sector map of **wastelands** (pooled stat buffs) and **neutral cities** (shops + scoring), with sub-events for **Seal Stone Realm** (Enigma Beasts) and **Master Thief's Heist** (raiding treasury).

Data derived from the game's in-memory tables (`conqueror_2025_*`, 54 tables, 1147 rows) and the live `CQ25MapData` / `WastelandMainInfoView` scene components.

---

## 1. Round structure

Each of the 15 rounds cycles through the same 7-phase structure. A round can contain **multiple Publicity→Contest cycles** for wastelands (first week was 2 cycles in Round 6).

```mermaid
flowchart LR
    A([Round Start]) --> B[Wasteland<br/>Declaration]
    B --> C[Wasteland<br/>Publicity]
    C --> D[Wasteland<br/>Contest]
    D --> E[Wasteland<br/>Results]
    E -.->|may repeat<br/>within round| C
    E --> F[Neutral City<br/>Declaration]
    F --> G[Neutral City<br/>Publicity]
    G --> H[Neutral City<br/>Battle]
    H --> I[Realm<br/>Preparation]
    I --> J[Realm<br/>Team-Up]
    J --> K[Realm<br/>Battle]
    K --> L[Master<br/>Thief]
    L --> M([Round<br/>Settlement])
    M -.->|next round<br/>of 15| A

    classDef wl fill:#f85149,color:#fff,stroke:#2e0a0a
    classDef nc fill:#388bfd,color:#fff,stroke:#0a1a2e
    classDef realm fill:#3fb950,color:#fff,stroke:#0a2e0a
    classDef done fill:#6e7681,color:#fff,stroke:#0a1929

    class B,C,D,E wl
    class F,G,H nc
    class I,J,K,L realm
    class A,M done
```

**Neutral City level unlocks:**

| Round | Unlocks |
|:-----:|---------|
| 1 | Lv.1 NCs |
| 2 | Lv.2 NCs |
| 3 | Lv.3 NCs |
| 4 | Lv.4 NC = **Storm's Eye** |

Sector reassignments can happen between rounds (Server 2864 moved sector 16 → 32 after R4.5). The event state persists but the map resets.

---

## 2. Wasteland specs

Each wasteland has a **spec** (determines what buff it yields), a **level** (1/2/3), and 3 buff slots. Slot 1 fills at L1, slot 2 at L2, slot 3 at L3. Buffs stack across every wasteland your warzone owns, up to per-effect caps.

### Spec table (13 types)

| ID | Name | Category | L1 | L2 | L3 | Cap-per-sector |
|---:|------|:--------:|------|------|------|:--------------:|
| 4001 | ATK Buff | 🔴 combat | +90% | +180% | +270% | unlimited |
| 4006 | HP Buff | 🔴 combat | +90% | +180% | +270% | unlimited |
| 4007 | DMG Increase | 🔴 combat | +15% | +30% | +45% | unlimited |
| 4008 | DMG Reduction | 🔴 combat | -15% | -30% | -45% | unlimited |
| 4010 | DEF Buff | 🔴 combat | +5% | +10% | +15% | unlimited |
| 4002 | Truck Transport | 🟡 economy | Seal +1 | Seal +2 | Seal +3 | 40 |
| 4003 | Truck Heist | 🟡 economy | Seal +1 | Seal +2 | Seal +3 | 40 |
| 4004 | Mining Hub | 🟡 economy | Speed +5% | Warehouse +1 | Gather +1 | 40 |
| 4015 | Daily Tasks | 🟡 economy | Seal +2 | Seal +4 | Seal +6 | 40 |
| 4016 | Seal Stone Train | 🟢 utility | Pax +1 | Refresh -2 | Rarity +1 | 40 |
| 4017 | Realm | 🟢 utility | Speed +10% | Speed +20% | +1 Eni Beast | 40 |
| 4018 | Realm Thief | 🟢 utility | Pass drop -10% | Gain +10% | Gain +20% | 40 |
| 4080 | Treasury Reward | ⭐ special | +1 | +2 | +3 | unlimited |

### Spec → Effect → Cap pipeline

```mermaid
flowchart LR
    subgraph combat [Combat specs - uncapped wastelands]
        s4001[4001 ATK Buff]
        s4006[4006 HP Buff]
        s4007[4007 DMG Inc]
        s4008[4008 DMG Red]
        s4010[4010 DEF Buff]
    end

    subgraph economy [Economy specs - 40 per sector]
        s4002[4002 Truck Transport]
        s4003[4003 Truck Heist]
        s4004[4004 Mining Hub]
        s4015[4015 Daily Tasks]
    end

    subgraph utility [Utility specs - 40 per sector]
        s4016[4016 Seal Stone Train]
        s4017[4017 Realm]
        s4018[4018 Realm Thief]
    end

    s4001 --> e11001[ATK cap 1800%]
    s4006 --> e11002[HP cap 1800%]
    s4007 --> e11003[DMG Inc cap 300%]
    s4008 --> e11004[DMG Red cap 300%]
    s4010 --> e11006[DEF cap 100%]

    s4002 --> e11011[Truck Seal cap +6]
    s4003 --> e11012[Heist Seal cap +6]
    s4004 --> e11026[Mine Speed cap +15%]
    s4004 --> e11013[Mine Wh cap +3]
    s4004 --> e11014[Mine Gather cap +3]
    s4015 --> e11017[Task Seal cap +20]

    s4016 --> e11020[Train Pax cap +3]
    s4016 --> e11021[Refresh cap -4]
    s4016 --> e11022[Rarity cap +1]
    s4017 --> e11023[Realm Speed cap +100%]
    s4017 --> e11024[Realm Beasts cap +3]
    s4018 --> e11015[Pass Drop cap -50%]
    s4018 --> e11016[Pass Gain cap +100%]

    classDef combat fill:#f85149,color:#fff
    classDef econ fill:#d29922,color:#0d1117
    classDef util fill:#3fb950,color:#fff
    classDef cap fill:#1c2128,color:#e6edf3,stroke:#30363d

    class s4001,s4006,s4007,s4008,s4010 combat
    class s4002,s4003,s4004,s4015 econ
    class s4016,s4017,s4018 util
    class e11001,e11002,e11003,e11004,e11006,e11011,e11012,e11013,e11014,e11015,e11016,e11017,e11020,e11021,e11022,e11023,e11024,e11026 cap
```

---

## 3. Ship mechanics (wasteland + NC battles)

Each player commits marches to one wasteland. Each wasteland has 3 ship types with different capacities and hearts.

| Ship | Slots | Hearts | Role |
|------|:-----:|:------:|------|
| **Mothership** | 100 | 5 | Primary carrier — should be filled first |
| **Sweeper** | 50 | 3 | Secondary — unlocks extra attack ticks |
| **Patrol** | 50 | 3 | Secondary — unlocks extra attack ticks |

### Deployment rules

```mermaid
flowchart TD
    P[Player with<br/>2 marches] --> CH{Wasteland<br/>already has<br/>Mothership full?}
    CH -->|No| M[March 1 → Mothership]
    CH -->|Yes| S1[March 1 → Sweeper or Patrol]
    M --> M2[March 2 → Sweeper or Patrol]
    S1 --> S2[March 2 → same small ship]

    M2 --> R[Battle starts]
    S2 --> R

    R --> A{Small ship<br/>alive?}
    A -->|Yes| BONUS[+1 extra attack tick<br/>per round]
    A -->|No| BASE[Base attack rate]

    classDef pl fill:#79c0ff,color:#0d1117
    classDef msh fill:#f85149,color:#fff
    classDef sm fill:#3fb950,color:#fff
    classDef bonus fill:#d29922,color:#0d1117
    classDef base fill:#6e7681,color:#fff

    class P pl
    class M msh
    class S1,S2,M2 sm
    class BONUS bonus
    class BASE base
```

**Rules of thumb:**
- 1 player = 1 wasteland only (can't split)
- Both marches to the same wasteland
- Primary in Mothership, secondary in a small ship
- Don't skip small ships — the extra attack ticks while Sweeper/Patrol are alive are a major throughput boost

---

## 4. Scoring & rewards

Two independent scoring systems drive what you win:

```mermaid
flowchart LR
    subgraph player [Individual player]
        M[Merit points<br/>personal contribution]
    end

    subgraph warzone [Warzone server]
        F[Fame points<br/>server total]
    end

    M --> IND[conqueror_2025_individual<br/>15 rds × 2 tiers<br/>Top 1-5, 6-10]
    M --> TR[Treasury distribution<br/>per-player rewards]
    M --> PAL[Hall of Fame titles<br/>Dominator's Crown etc.]

    F --> RANK[conqueror_2025_rank<br/>15 rds × 11 tiers<br/>1 / 2 / 3 / 4-5 / 6-10 /<br/>11-20 / 21-40 / 41-80 /<br/>81-120 / 121-200 / 201+]
    F --> CRYSTAL[Crystal Buffs<br/>6 faction-wide<br/>at 10k/20k/30k/40k/60k/80k]
    F --> GIFT[Round 15 settlement gifts<br/>Warzone skins for top 3]

    classDef mer fill:#3fb950,color:#fff
    classDef fam fill:#388bfd,color:#fff
    classDef rwd fill:#d29922,color:#0d1117

    class M,IND,TR,PAL mer
    class F,RANK,CRYSTAL,GIFT fam
```

### Occupy rewards (progress bar)

Earn points by holding wastelands during Contest. Tier rewards at:

| Points | Reward |
|-------:|:------:|
| 1,000 | Tier 1 |
| 2,000 | Tier 2 |
| 3,000 | Tier 3 |
| 4,000 | Tier 4 |

---

## 5. Sub-events inside a round

```mermaid
flowchart TB
    subgraph week [Round week]
        W[Wasteland phase<br/>🔴 combat]
        NC[Neutral City phase<br/>🔵 combat + shops]
        R[Realm phase<br/>🟢 PvE adventure]
        MT[Master Thief<br/>🟣 PvP heist]
    end

    W -.buffs contribute to.-> NC
    W -.Realm specs unlock.-> R
    W -.Thief specs unlock.-> MT

    NC --> NCSHOP[NC Shop<br/>24 items<br/>gold + merit cost]
    NC --> NCBUILDING[Building Defense<br/>10-15M HP<br/>200 cohorts]

    R --> BEAST[Enigma Beasts<br/>capacity +3 max]
    R --> SPEED[Realm march speed<br/>+100% max]
    R --> BOSS[Warzone Guardian bosses<br/>5 Valhalla fights]

    MT --> PASS[Earn/spend Passes<br/>drop -50% / gain +100% max]
    MT --> TREASURY[Raid enemy<br/>treasury]

    classDef w fill:#f85149,color:#fff
    classDef n fill:#388bfd,color:#fff
    classDef r fill:#3fb950,color:#fff
    classDef m fill:#a371f7,color:#fff

    class W,NCBUILDING w
    class NC,NCSHOP n
    class R,BEAST,SPEED,BOSS r
    class MT,PASS,TREASURY m
```

### Neutral Cities (NCs)

- **Type-2 cells** in the 24×24 grid, named `Lv. N Neutral City #XXXX`
- Level unlocks tied to round number (see §1)
- **Storm's Eye (Lv.4)** — special CNC building with 60-min battle timeline, unlocked in R4
- Whoever owns an NC gets access to its **NC Shop** (24 gold-cost items + merit score gate)

### Seal Stone Realm

- PvE map unlocked during Realm phase
- **Enigma Beasts** — collectible stat-boost entities. Spec 4017 (Realm) unlocks +1 Beast carry slot per L3 wasteland (cap +3)
- **Warzone Guardian bosses** — 5 Valhalla monsters (monster_id `6100001`) that feed the "Ragnarok" achievement
- March speed inside the Realm: +100% cap from spec 4017

### Master Thief's Heist

- Hold a **Pass** → raid an enemy warzone's Treasury
- Spec 4018 (Realm Thief) reduces pass drop on defeat (-50% cap) and boosts pass gain (+100% cap)

---

## 6. Mining Hubs

Spec 4004 (Mining Hub) boosts all four mine tiers:

| Tier | Duration | Food | Oil | Thorium |
|:----:|---------:|-----:|----:|--------:|
| 1 | 14h | 1.2M | 1.2M | 400 |
| 2 | 14h | 2.5M | 2.5M | 600 |
| 3 | 14h | 4.2M | 4.2M | 800 |
| 4 | 14h | 6.3M | 6.3M | 1,000 |

Speed +5% · Warehouse +1 · Gather +1 (from the 3 spec 4004 slots).

---

## 7. Event buffs outside wastelands

### Crystal Buffs (faction-wide, from Fame points)

| Fame threshold | Buff |
|---------------:|------|
| 10,000 | Crystal Buff 1 — ATK +10% |
| 20,000 | Crystal Buff 2 — HP +10% |
| 30,000 | Crystal Buff 3 — ATK +10% |
| 40,000 | Crystal Buff 4 — HP +10% |
| 60,000 | Crystal Buff 5 — DMG Inc +3% |
| 80,000 | Crystal Buff 6 — DMG Red +3% |

### Global Boosts (task-point thresholds)

| Threshold | Boost |
|----------:|-------|
| 3,000 | Gathering Speed +10% |
| 18,000 | HP +10% & ATK +10% |
| 60,000 | Training Speed +10% & March Speed +10% |
| 150,000 | Repair Factory capacity +50 |

---

## 8. Hall of Fame (event-end titles)

14 end-of-event titles. Each has its own ranking criteria:

| # | Title | Awarded for |
|:-:|-------|-------------|
| 1 | Dominator's Crown | Most Merit overall |
| 2 | Dominator's Hammer | Most Merit from 2nd-ranked faction |
| 3 | Dominator's Blade | Most Merit from 3rd-ranked faction |
| 4 | Dominator's Sword | Most Valhalla units destroyed |
| 5 | Dominator's Shield | Most Merit from defending NC buildings |
| 6-14 | _various_ | Category-specific top contributors |

Plus **Warzone skins** for top 3 servers at Round 15 settlement (`warzone_skin: 601 / 602 / 603`).

---

## 9. Strategy notes

### Which specs to prioritize

The wasteland cap system matters:
- **Combat specs (ATK/HP/DMG/DEF)** are uncapped per-sector — you can own as many as you can hold, and each one stacks up to the global effect cap
- **Economy/utility specs** are capped at 40 per sector — the 41st doesn't help the whole warzone
- **DMG Increase and DMG Reduction have a 300% cap** but each L3 wasteland gives 45% — so you hit the cap with only 7 wastelands. Low-hanging fruit.

### Ship stacking

A fully-attacked wasteland has 200 total slots (100 MS + 50 Sw + 50 Pa) = enough for 100 players × 2 marches. In practice most wastelands see 30-80% fill. The winners are usually determined by **small-ship uptime**, not raw Mothership fill.

### Contested vs. uncontested declarations

`fightSids` in the wasteland's declaration data tells you who else declared. A 3-way fight splits the defending attention but also dilutes your reward share. Uncontested captures are free wins — target them first.

---

## 10. Data plumbing (for reference)

The event is driven by **54 `conqueror_*` tables** totaling ~1,147 rows. Key ones:

```mermaid
flowchart TB
    LT[conqueror_2025_landtype<br/>13 specs]
    ET[conqueror_2025_effecttype<br/>22 caps]
    LE[conqueror_2025_landeffect<br/>25 per-slot values]

    LT --> LE
    LE --> ET

    CAL[conqueror_2025_calendar<br/>30 phase entries]
    TIME[conqueror_2025_calendar_time<br/>362 time slots]
    CAL --> TIME

    RANK[conqueror_2025_rank<br/>165 tiers<br/>15 rds × 11]
    IND[conqueror_2025_individual<br/>30 tiers<br/>15 rds × 2]

    SHOP[conqueror_2025_shop<br/>51 items]
    CNCSHOP[conqueror_2025_cnc_shop<br/>24 items]

    ACH[conqueror_2025_achieve<br/>24 tasks]
    SUM[conqueror_2025_achieve_sum<br/>5 summary tiers]
    ACH --> SUM

    BOSS[conqueror_2025_bossfight<br/>5 Valhalla bosses]
    BTR[conqueror_2025_bosstrial_reward<br/>4 tiers]
    BOSS --> BTR

    PAL[conqueror_2025_palace<br/>14 Hall of Fame titles]

    classDef data fill:#1c2128,color:#e6edf3,stroke:#30363d

    class LT,ET,LE,CAL,TIME,RANK,IND,SHOP,CNCSHOP,ACH,SUM,BOSS,BTR,PAL data
```

Every string key (e.g. `conqueror2025_wasteland_172`) resolves to localized text via the game's `LocalManager`.

---

_Last updated: 2026-04-22 during Round 6 Publicity (2). Data source: Server 2864 live game client (Cocos Creator 2.4.6 H5). Compiled for the S2864 community._
