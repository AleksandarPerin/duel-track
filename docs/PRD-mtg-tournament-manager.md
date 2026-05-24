# Product Requirements Document: DuelTrack — MtG Tournament Manager

**Version:** 1.1 (Reviewed)
**Status:** Final Draft
**Date:** 2026-05-24
**Owner:** Product Team
**Reviewed by:** Engineering / Domain Review

> **Review changelog (v1.0 → v1.1):**
> All changes from the original draft are summarised in [Appendix A — Review Notes](#appendix-a--review-notes).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users & Personas](#3-target-users--personas)
4. [Goals & Non-Goals](#4-goals--non-goals)
5. [Feature Requirements](#5-feature-requirements)
6. [Technical Requirements](#6-technical-requirements)
7. [Success Metrics](#7-success-metrics)
8. [Phased Roadmap](#8-phased-roadmap)
9. [Risks & Mitigations](#9-risks--mitigations)
10. [Open Questions](#10-open-questions)
11. [Glossary](#11-glossary)
12. [Appendix A — Review Notes](#appendix-a--review-notes)

---

## 1. Executive Summary

DuelTrack is a web-based Magic: The Gathering tournament management application designed to automate and streamline the full lifecycle of competitive MtG events — from player registration through Swiss-round pairings, results entry, standings calculation, and post-tournament statistics. The product targets local game stores (LGSs), regional organizers, and independent tournament organizers (TOs) who currently rely on fragile spreadsheets or desktop-only legacy tools such as Wizards Event Reporter (WER).

DuelTrack delivers a modern, mobile-responsive web interface backed by a robust Swiss pairing engine that is fully compliant with the Magic Tournament Rules (MTR) tiebreaker methodology, specifically MTR Appendix E. Its self-serve model means any organizer can run a sanctioned-quality event without specialized software installation or vendor lock-in.

---

## 2. Problem Statement

### Current Pain Points

| Pain Point | Impact |
|---|---|
| Legacy desktop tools (WER, MTG Companion) are Windows-only or discontinued | Excludes macOS/Linux TOs and requires dedicated hardware |
| No real-time standings for spectators or players | Reduces engagement; players must ask the TO for standings |
| Manual pairing calculation on spreadsheets is error-prone | Wrong pairings damage event integrity and trust |
| No historical player profiles or statistics tracking | TOs cannot reward loyal players or analyze attendance |
| No built-in communication tools | TOs must use separate channels to announce rounds |
| Offline-only tools fail when hardware breaks | Single point of failure at events |

### Core Problem Statement

Tournament organizers running Magic: The Gathering events lack a reliable, accessible, standards-compliant web tool that handles Swiss pairings automatically, exposes real-time standings to all participants, and preserves player history — resulting in preventable errors, reduced player experience, and significant TO burden.

---

## 3. Target Users & Personas

### Persona 1: The Local Game Store Owner / Head Judge
**Name:** Marcus
**Age:** 34
**Role:** Runs Friday Night Magic and PPTQ-equivalent events at his LGS (16–48 players)
**Technical Comfort:** Moderate — uses Google Sheets, familiar with WER

**Goals:**
- Complete round pairings in under 2 minutes per round
- Let players check standings on their phones without bothering staff
- Export results for reporting to the regional body

**Frustrations:**
- WER crashes unpredictably; no autosave
- Players crowd the pairings board; no digital display
- Cannot see multi-week attendance trends

---

### Persona 2: The Regional/Circuit Tournament Organizer
**Name:** Priya
**Age:** 41
**Role:** Runs quarterly 150–300 player Regionals and competitive REL events
**Technical Comfort:** High — comfortable with APIs and data exports

**Goals:**
- Support multiple simultaneous tournaments (e.g., main event + side events)
- Export full tournament data (JSON/CSV) for compliance and seeding
- Fine-grained control over tiebreaker rules and byes

**Frustrations:**
- No browser-based tooling that handles large competitive events reliably
- Cannot delegate results entry to table judges without sharing master credentials

---

### Persona 3: The Competitive Player
**Name:** Sam
**Age:** 22
**Role:** Grinds FNM and local Regionals; tracks their own win rate and matchup history
**Technical Comfort:** High — heavy mobile user

**Goals:**
- Check pairings on phone the moment they are posted
- View current standings and their own match win %
- See their own historical performance over time

**Frustrations:**
- Has to wait in line to see paper pairings
- Cannot review past tournament history on any single platform
- No way to compare performance against the local meta

---

### Persona 4: The Casual/New Player
**Name:** Jordan
**Age:** 19
**Role:** First-time FNM attendee, plays Arena and wants to try paper
**Technical Comfort:** Basic — smartphone native

**Goals:**
- Easily find their seat and round pairing without confusion
- Understand what standings mean
- Register for the event on their phone before arriving

**Frustrations:**
- Paper systems are intimidating and opaque
- No self-service way to look up event information

---

## 4. Goals & Non-Goals

### Goals

1. Provide a web-first (no install required) tournament management tool usable on desktop and mobile
2. Implement a Swiss pairing engine fully compliant with WotC's Magic Tournament Rules (MTR) — including Opponent Match Win % (OMW%), Game Win % (GW%), and Opponent Game Win % (OGW%) tiebreakers per **MTR Appendix E**
3. Support events from 8 to 512 players across all competitive RELs
4. Expose real-time public standings and pairings via shareable links (no login required for players to view)
5. Maintain full player profiles and historical statistics across events
6. Allow multi-judge results entry with role-based access control
7. Support single elimination (Top 8/4/2) brackets following Swiss rounds
8. Enable data export (CSV, JSON, PDF) for compliance and record-keeping
9. Provide round timer with push/web notifications

### Non-Goals (v1.0)

- **Not a deck registration or decklist submission tool** (out of scope for v1)
- **Not a matchmaking service** for unorganized play (1v1 queuing like Arena)
- **Not integrated with Wizards Play Network** for official sanctioning — organizers export and self-report
- **Not a mobile native application** (iOS/Android apps) — web app must work on mobile browsers
- **Not a payment processor** — entry fee collection is out of scope
- **Not a live video streaming platform** for feature matches
- **Not a sealed/draft pool generator or pod seating tool**

---

## 5. Feature Requirements

### 5.1 Player Registration

#### Description
Tournament organizers and/or players can register participants for an event. Registration may be configured as TO-only entry (organizer manually adds players) or self-service (players join via shareable link).

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| REG-01 | TO can add players manually (name, optional WPN player number/email) | Must Have | Player appears in tournament roster within 1 second of submission |
| REG-02 | TO can import player list via CSV (name, email columns) | Must Have | Up to 512 rows processed; invalid rows flagged with row number and reason |
| REG-03 | Players can self-register via shareable event link (no account required) | Should Have | Player submits name + optional email; TO approval queue shown |
| REG-04 | TO can approve or reject pending self-registrations | Should Have | Status visible in roster; approved players immediately eligible |
| REG-05 | TO can drop players before round 1 starts (full removal) or between rounds (graceful drop) | Must Have | Pre-round-1 drop removes player entirely; post-round-1 drop preserves past results and record for tiebreaker calculations |
| REG-06 | Players with existing accounts auto-fill profile data | Should Have | Known email pre-populates name and player number |
| REG-07 | TO can assign a first-round bye at registration time | Should Have | Bye player is excluded from round 1 pairings; receives 3 match points and a 2-0-0 game record credit for round 1; bye_received count incremented by 1 |
| REG-08 | Duplicate name/email detection with TO override | Should Have | Warning shown; TO can confirm or merge |

#### Data Captured per Player

```
- Display name (required)
- Email address (optional)
- WPN player number (optional; formerly DCI number — see OQ-04)
- Linked account ID (if authenticated)
- Registration timestamp
- sort_seed (stable random integer assigned at registration;
              used for deterministic ordering within score brackets)
- byes_received count
- Drop status + round dropped after
```

---

### 5.2 Tournament Creation & Management

#### Description
Organizers create and configure tournaments, control round progression, and manage the event lifecycle from setup through completion.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| TRN-01 | TO can create a tournament with name, date, format, REL, venue | Must Have | Tournament visible in TO dashboard immediately |
| TRN-02 | System auto-calculates recommended round count from player count per the MTR Appendix E table | Must Have | Shown as default; TO can override |
| TRN-03 | TO can start tournament (locks registration, generates round 1 pairings) | Must Have | Round 1 pairings visible within 3 seconds for ≤ 512 players; minimum 8 players required to start |
| TRN-04 | TO can advance to next round only after all pairings in the current round have a recorded result | Must Have | "Advance Round" button is disabled and labelled with count of outstanding results until all are entered |
| TRN-05 | TO can force-advance a round, issuing a Match Loss to the player(s) responsible for any outstanding result | Must Have | Warning dialog names the affected player(s) and resulting record change; opponent receives 2-0 game record win; audit log entry created with actor and reason |
| TRN-06 | TO can drop a player mid-tournament | Must Have | Player removed from all future pairings; if dropped during an active round, that round's unfinished match resolves as a match loss for the dropped player (opponent receives 2-0 win); dropped player's record is frozen and retained for opponents' tiebreaker calculations |
| TRN-07 | TO can add a late-arriving player after round 1 (player receives a match loss record for all missed rounds, not byes) | Should Have | Late player enters the pairing pool in the next round; their match-loss records for missed rounds are used in standing calculations |
| TRN-08 | Multiple simultaneous tournaments per organizer account | Should Have | Each tournament fully isolated; no cross-contamination of player records or pairings |
| TRN-09 | Tournament can be paused (all actions frozen) and resumed | Could Have | State preserved across pause; all participants notified |
| TRN-10 | TO can configure Swiss rounds + Top 8/4/2 cut | Must Have | Cut announced after final Swiss round; bracket generated automatically seeded by Swiss standings |
| TRN-11 | Tournament formats: Standard, Modern, Legacy, Vintage, Pioneer, Draft, Sealed | Must Have | Format stored; affects round timer default and display |
| TRN-12 | REL levels: Regular, Competitive, Professional | Should Have | REL stored; Professional REL requires a judge account role to be assigned before the tournament can start |

#### Tournament Lifecycle States

```
DRAFT → REGISTRATION_OPEN → IN_PROGRESS → TOP_CUT → COMPLETED → ARCHIVED
```

#### MTR Recommended Round Count (auto-calculated, per MTR Appendix E)

| Players | Swiss Rounds |
|---------|-------------|
| 8 | 3 |
| 9–16 | 4 |
| 17–32 | 5 |
| 33–64 | 6 |
| 65–128 | 7 |
| 129–226 | 8 |
| 227–409 | 9 |
| 410–512 | 10 |

> **Implementation note:** The minimum supported player count is 8. Events with fewer than 8 players cannot be started. The original draft listed "4–8 → 3 rounds" in this table; this was incorrect — the MTR does not define a round count for fewer than 8 players.

---

### 5.3 Swiss Pairing Engine

#### Description
The core algorithmic component. Generates optimal pairings for each round of Swiss play, minimising repeat pairings and respecting match-point-based seeding, in compliance with WotC MTR Section 8 (Swiss Pairings) and Appendix E (Tiebreakers).

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| PAR-01 | Players paired within the same match-points bracket first; cross-bracket pairing only when a bracket has an odd number of players (carry-down rule) | Must Have | All players with equal points paired against each other before crossing brackets |
| PAR-02 | No player paired against the same opponent twice if any valid alternative exists; repeat pairings permitted only when unavoidable and must be logged | Must Have | System exhausts all non-rematch options before permitting a rematch; any repeat pairing appears in the audit log |
| PAR-03 | Bye assignment: the lowest-ranked active player who has received the fewest byes in this tournament receives the bye when the player count is odd; ties broken by sort_seed | Must Have | Bye player receives 3 match points and a 2-0-0 game record credit; the bye round is excluded from that player's OMW% and OGW% calculations; byes_received incremented |
| PAR-04 | Seat assignment (player 1 / player 2 within a pairing) randomized | Must Have | Determined by a hash of the pairing ID for reproducibility; not deterministically biased toward any player |
| PAR-05 | Pairings generated in under 3 seconds for ≤ 512 players | Must Have | Measured at p99 on reference hardware |
| PAR-06 | Pairings output sorted by table number; top tables = highest combined match-points matchup | Must Have | Table 1 = highest-points pairing |
| PAR-07 | Support odd player counts via automatic bye generation | Must Have | If odd active players, exactly one player receives a bye per round |
| PAR-08 | TO can manually swap two pairings (exchange opponents between two tables) post-generation, before any result is entered for the current round | Should Have | Swap logged with actor, timestamp, and mandatory reason field; affects only current round |
| PAR-09 | Pairing engine logs a warning when backtracking limit is reached and returns a best-effort result | Should Have | Warning visible in TO dashboard and audit log; engine never silently produces a suboptimal pairing |
| PAR-10 | Top 8/4/2 single-elimination bracket seeded by final Swiss standings: Seed 1 vs. Seed 8, Seed 2 vs. Seed 7, etc. | Must Have | Seeding matches standard MtG bracket convention; if the cut size is not a power of two, top seeds receive first-round byes to pad to the next power of two |

---

### 5.4 Results Entry & Standings

#### Description
Table judges and the head judge record match results. The system recalculates standings and tiebreakers after each round is completed, in strict compliance with MTR Appendix E.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| RES-01 | TO and judges can enter results by table number; valid result types: 2-0, 2-1, 1-2, 0-2, 1-1-1 (match draw), intentional draw (ID), double match loss | Must Have | Result saved and validated against game-count constraints; standings updated atomically after round is advanced |
| RES-02 | Results locked after round advances; TO can unlock a specific result for correction with a mandatory reason | Must Have | Unlock creates audit log entry with actor, timestamp, reason, previous value, and new value |
| RES-03 | Standings recalculate and persist within 1 second of the TO advancing the round | Must Have | Standings page reflects updated data without full page reload |
| RES-04 | Tiebreakers calculated strictly per MTR Appendix E: OMW%, GW%, OGW% in that order | Must Have | All three values displayed in standings; sort order enforced server-side, never client-side only |
| RES-05 | Public standings page accessible via shareable URL (no login); standings are hidden until the TO explicitly publishes them for each round | Must Have | Unpublished standings visible only to TO and Judge roles; published page auto-refreshes every 30 seconds |
| RES-06 | Players can find their current pairing by name search or table number | Must Have | Results returned in under 500 ms |
| RES-07 | Dropped player handling: open match resolved automatically as a match loss for the dropped player; opponent receives a 2-0 game record win | Must Have | No manual result entry required when a drop is triggered via the drop action |
| RES-08 | Judge role can enter and edit results for the current round but cannot advance rounds or modify tournament settings | Must Have | Role enforced server-side on every mutation endpoint |
| RES-09 | Intentional Draw (ID) must be explicitly selected via a dedicated control with a confirmation dialog; it must not appear as a default result option | Must Have | ID records 0 game wins / 0 game losses / 0 games played for both players; both receive 1 match point; the match does not contribute to GW% |
| RES-10 | Export standings as CSV or PDF at any point during the tournament | Should Have | Download available within 2 seconds; includes all tiebreaker columns |

#### Standings Display Columns

```
Rank | Player Name | Points | Record (W-L-D) | OMW% | GW% | OGW%
```

#### Tiebreaker Calculation Rules (MTR Appendix E — Normative)

The following rules are normative. The implementation must match them exactly. Any deviation is a bug.

**Match Points**

| Result | Points awarded |
|--------|---------------|
| Match Win | 3 |
| Match Draw (including Intentional Draw) | 1 per player |
| Match Loss | 0 |
| Bye | 3 (treated identically to a match win) |

**Opponent Match-Win Percentage (OMW%)**

```
For each active opponent O of player P (bye rounds excluded):
    MWP(O) = max(0.33, O.match_wins / O.matches_played)

OMW%(P) = mean( MWP(O) for all O in opponents(P) )
```

Critical implementation note: the 0.33 floor is applied to each **individual opponent's MWP** before computing the average. It is not applied to the final OMW% value. Applying the floor to the average instead of per-opponent is a common mistake that produces different results.

Bye rounds are excluded from the opponent list entirely: the bye does not count as an opponent, and the bye round is not included in P's `matches_played` for other players computing OMW% against P.

**Game Win Percentage (GW%)**

```
GW%(P) = max(0.33, P.game_wins / P.games_played)
```

- Bye credit: +2 game wins, +2 games played added to P's totals.
- Intentional Draw credit: +0 game wins, +0 games played (ID adds nothing to GW%).
- 1-1-1 match draw: each player records 1 game win, 1 game loss, 1 drawn game (3 games total in denominator).
- 2-1 match: winning player records 2 game wins, 3 games played; losing player records 1 game win, 3 games played.
- Double Match Loss (0-2 / 0-2): each player records 0 game wins, 2 game losses, 2 games played.

**Opponent Game-Win Percentage (OGW%)**

```
OGW%(P) = mean( GW%(O) for all O in opponents(P) )
```

GW%(O) here already has the 0.33 floor applied. Bye rounds excluded identically to OMW%.

**Dropped players:** A dropped player's match record is frozen at the round they were dropped. Their frozen record (with floors applied) is included in all past and future opponents' OMW% and OGW% calculations. Dropped players do not receive additional match losses after their drop round for the purpose of tiebreaker calculations.

---

### 5.5 Player Profiles & Statistics

#### Description
Registered (authenticated) players have persistent profiles that aggregate historical performance data across all events played on the platform.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| PRF-01 | Authenticated players have a persistent profile page | Must Have | Profile accessible at `/player/{username}` |
| PRF-02 | Profile displays: total events, overall W/L/D record, match win rate % | Must Have | Calculated from all completed tournaments |
| PRF-03 | Profile shows per-tournament history with format, placement, record | Should Have | Sorted by date descending; paginated at 20 per page |
| PRF-04 | Profile shows format-specific win rates (e.g., Modern 64%, Standard 58%) | Should Have | Displayed as bar chart and table |
| PRF-05 | Profile shows common opponents and head-to-head record | Could Have | Shows top 10 most-faced opponents |
| PRF-06 | Profile shows average finish percentile across events | Could Have | Percentile = (players finishing below player / total players) × 100 |
| PRF-07 | Players can set profile to private | Should Have | Private profiles still visible to TO; excluded from public search |
| PRF-08 | TO can link guest records into a player's profile retroactively | Should Have | Email match or manual TO linkage; creates merge audit log entry |

#### Public Profile URL Structure

```
/player/{username}             → public profile summary
/player/{username}/history     → full tournament history
/player/{username}/stats       → detailed statistics breakdown
```

---

### 5.6 Notifications & Communication

#### Description
The system notifies players of round pairings, standings updates, and administrative messages via in-app display, email, and/or browser push notifications.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NOT-01 | Browser push notification sent to subscribed players when new round pairings are published | Should Have | Notification delivered within 5 seconds of round publication |
| NOT-02 | Email notification sent to players with email on file when round pairings are published | Should Have | Email delivered within 60 seconds; includes table number and opponent name |
| NOT-03 | In-app round timer visible to all participants on the public standings page | Must Have | Countdown timer; TO sets duration per round (default 50 minutes for Constructed, 60 minutes for Limited); audible alert at 5 minutes remaining |
| NOT-04 | TO can broadcast a text message to all registered players (in-app banner + email) | Should Have | Message appears as banner on tournament page; logged in audit trail |
| NOT-05 | Players can opt out of email notifications per-tournament | Should Have | Opt-out link in every notification email; preference stored per tournament registration |
| NOT-06 | TO dashboard shows alert when any table has not submitted results within 10 minutes of timer expiry | Could Have | Alert displayed with outstanding table numbers |

---

## 6. Technical Requirements

### 6.1 Architecture Overview

DuelTrack follows a three-tier web architecture with a stateless API layer and real-time event broadcasting.

```
┌─────────────────────────────────────────────┐
│                  Client Layer               │
│   React SPA (TypeScript)                   │
│   Mobile-responsive, PWA-capable           │
│   WebSocket subscriber for live updates    │
└────────────────┬────────────────────────────┘
                 │ HTTPS / WSS (TLS required; HTTP redirected to HTTPS)
┌────────────────▼────────────────────────────┐
│               API Layer                     │
│   Node.js + Express (or Fastify)            │
│   RESTful JSON API + WebSocket server       │
│   JWT authentication (short-lived tokens)  │
│   Role-based access control middleware      │
│   CSRF protection on all state-mutating     │
│   endpoints                                 │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│              Data Layer                     │
│   PostgreSQL (primary relational store)     │
│   Redis (session cache, pub/sub for WS)     │
│   Object storage (exports, attachments)     │
└─────────────────────────────────────────────┘
```

**Hosting target:** Containerised deployment (Docker Compose for dev; Kubernetes or Railway/Render for production).

**Authentication:** Email + password with bcrypt hashing (minimum cost factor 12). Optional OAuth2 (Google) for player convenience. JWT access tokens (15 min) + refresh tokens (7 days) stored in httpOnly, Secure, SameSite=Strict cookies. Authentication endpoints rate-limited to 10 attempts per IP per minute.

**Real-time:** WebSocket connections (Socket.io or native `ws`) per tournament room. Server pushes pairing and standings events; clients subscribe on tournament join.

**Security baseline:**
- All traffic served over TLS; plaintext HTTP connections redirected to HTTPS.
- CSRF tokens required on all POST/PATCH/DELETE endpoints.
- Passwords stored as bcrypt hashes (cost ≥ 12); plaintext passwords never logged or transmitted after hashing.
- Player PII limited to display name and optional email. No payment data stored. See OQ-05 for GDPR/CCPA obligations.
- Admin and judge passcodes minimum 8 characters, enforced server-side.
- Rate limiting: 10 authentication attempts per IP per minute; 100 requests per IP per minute on public standings endpoints.

**Accessibility:** All user-facing interfaces must meet WCAG 2.1 Level AA. Colour is never the sole indicator of state (e.g., result status, standings cut line). Minimum body font size 16 px; pairings display minimum 18 px. All interactive controls have accessible labels.

**Browser support:** Chrome/Edge 110+, Firefox 110+, Safari 16+, iOS Safari 16+, Android Chrome 110+. No Internet Explorer support.

---

### 6.2 Pairing Algorithm Specification

The pairing engine implements weighted maximum matching over a graph of eligible player pairs using the Dutch Swiss pairing model. The algorithm is implemented as a **pure, deterministic function**: given the same input state, it must always produce identical output. This is a hard requirement for auditability and test reproducibility.

#### Algorithm: Dutch Swiss Weighted Matching

**Step 1: Assign stable random seeds at registration**

Each player is assigned a `sort_seed` (random integer) at registration time, persisted in `tournament_players.sort_seed`. This seed is the final deterministic tiebreaker within a score bracket, ensuring reproducible pairing output.

**Step 2: Group players by match points**

```
brackets = group_by(active_players, key=match_points)
sort brackets descending by match_points
within each bracket: sort players by (omw_pct DESC, gw_pct DESC, sort_seed ASC)
```

**Step 3: Within each bracket, build the candidate edge set**

```
for each bracket B:
    edges = all (p1, p2) combinations from B where p1 != p2
    if B has an odd number of players:
        carry the lowest-ranked player in B down to the next bracket
```

**Step 4: Assign edge weights**

```
weight(p1, p2) =
    BASE_WEIGHT (e.g., 1000)
    - REMATCH_PENALTY (e.g., 500)        if (p1, p2) in previous_pairings
    - BRACKET_CROSS_PENALTY * bracket_distance(p1, p2)
    + deterministic_jitter(p1, p2)       a float in [0, 1) derived from
                                         hash(p1.sort_seed XOR p2.sort_seed)
```

Using a deterministic hash (not `Math.random()`) ensures that running the algorithm twice on the same input produces the same pairings. True within-bracket randomness is achieved by the randomly-assigned `sort_seed` values set at registration.

**Step 5: Apply maximum weight perfect matching (Blossom algorithm)**

- Implement Edmonds' blossom algorithm (O(n³)) for optimal matching.
- For n ≤ 512, runtime is well within the 3-second SLA.
- **TypeScript/JavaScript reference:** use the `edmonds-blossom` npm package or a validated equivalent TypeScript port. Do not use `networkx` (Python-only library); it may be used as a reference comparator in tests but not as the runtime dependency.
- The REMATCH_PENALTY weight allows the algorithm to find the minimum-rematch solution naturally when a fully rematch-free matching does not exist.

**Step 6: Handle odd player count (bye)**

```
if count(active_players) is odd:
    bye_candidate = active player with the lowest byes_received in this tournament,
                    breaking ties by (match_points ASC, omw_pct ASC, sort_seed ASC)
    assign bye to bye_candidate
    remove bye_candidate from matching pool before Step 5
    credit bye_candidate with: +3 match points, +2 game wins, +2 games played
    bye_candidate.byes_received += 1
    exclude this round from bye_candidate's OMW% and OGW% calculations
```

**Step 7: Assign table numbers**

```
sort matched pairs by combined match points descending
assign table 1 to highest-points pair, incrementing sequentially
seat assignment within each pair: hash(pairing.id) % 2 determines player1 / player2
```

**Step 8: Backtracking limit**

If the matching algorithm exceeds 10,000 internal iterations without converging on a complete solution (a degenerate case), it emits a warning to the audit log and TO dashboard and returns the best partial solution found. It must never silently produce an incorrect or incomplete pairing.

#### Complexity

| Event Size | Active Pairs | Estimated Blossom Runtime |
|-----------|-------------|--------------------------|
| 16 players | 8 | < 1 ms |
| 64 players | 32 | < 10 ms |
| 256 players | 128 | < 200 ms |
| 512 players | 256 | < 1.5 s |

---

### 6.3 Data Model

#### Core Entities

```sql
-- Users (authenticated accounts)
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  display_name   TEXT NOT NULL,
  password_hash  TEXT,                           -- bcrypt, cost >= 12
  wpn_number     TEXT,                           -- WPN player number (formerly DCI)
  role           TEXT NOT NULL DEFAULT 'player', -- player | judge | organizer | admin
  profile_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournaments
CREATE TABLE tournaments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  format        TEXT NOT NULL,    -- standard | pioneer | modern | legacy | vintage | draft | sealed
  rel_level     TEXT NOT NULL,    -- regular | competitive | professional
  venue         TEXT,
  scheduled_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'draft',
                -- draft | registration | in_progress | top_cut | completed | archived
  total_rounds  INT NOT NULL,
  current_round INT NOT NULL DEFAULT 0,
  top_cut       INT NOT NULL DEFAULT 8,  -- 0 = no cut, 2 | 4 | 8
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tournament Players (one row per player per tournament)
CREATE TABLE tournament_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id),
  user_id         UUID REFERENCES users(id),  -- NULL for guest registrations
  guest_name      TEXT,                        -- required when user_id IS NULL
  guest_email     TEXT,
  sort_seed       INT NOT NULL,                -- stable random integer assigned at registration;
                                               -- used for deterministic bracket ordering
  byes_received   INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active', -- active | dropped | disqualified
  drop_round      INT,                         -- round after which the player was dropped
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, user_id),
  CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);

-- Rounds
CREATE TABLE rounds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id),
  round_number  INT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'swiss',   -- swiss | elimination
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | active | completed
  timer_minutes INT NOT NULL DEFAULT 50,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  UNIQUE(tournament_id, round_number)
);

-- Pairings (one row per match slot; does not store result data)
CREATE TABLE pairings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        UUID NOT NULL REFERENCES rounds(id),
  table_number    INT NOT NULL,
  player1_id      UUID NOT NULL REFERENCES tournament_players(id),
  player2_id      UUID REFERENCES tournament_players(id), -- NULL = bye
  is_bye          BOOLEAN NOT NULL GENERATED ALWAYS AS (player2_id IS NULL) STORED,
  override_note   TEXT,  -- populated if the TO manually swapped this pairing
  UNIQUE(round_id, table_number)
);

-- Results (separate from pairings to support clean audit logging of edits)
CREATE TABLE results (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_id         UUID NOT NULL UNIQUE REFERENCES pairings(id),
  player1_game_wins  INT NOT NULL CHECK (player1_game_wins >= 0 AND player1_game_wins <= 2),
  player2_game_wins  INT NOT NULL CHECK (player2_game_wins >= 0 AND player2_game_wins <= 2),
  games_drawn        INT NOT NULL DEFAULT 0 CHECK (games_drawn >= 0 AND games_drawn <= 1),
  outcome            TEXT NOT NULL,
                     -- player1_win | player2_win | draw | intentional_draw | double_loss
  entered_by         UUID NOT NULL REFERENCES users(id),
  entered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_game_total CHECK (
    (outcome = 'intentional_draw'
       AND player1_game_wins = 0
       AND player2_game_wins = 0
       AND games_drawn = 0)
    OR (player1_game_wins + player2_game_wins + games_drawn <= 3
       AND player1_game_wins + player2_game_wins + games_drawn >= 2)
  )
);

-- Standings (materialised per round; recomputed when a round is advanced)
CREATE TABLE standings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id),
  round_number    INT NOT NULL,
  player_id       UUID NOT NULL REFERENCES tournament_players(id),
  match_points    INT NOT NULL,
  match_wins      INT NOT NULL,
  match_losses    INT NOT NULL,
  match_draws     INT NOT NULL,
  game_wins       INT NOT NULL,
  game_losses     INT NOT NULL,
  omw_percent     NUMERIC(6,4),
  gw_percent      NUMERIC(6,4),
  ogw_percent     NUMERIC(6,4),
  rank            INT,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(tournament_id, round_number, player_id)
);

-- Audit Log (append-only; rows are never updated or deleted)
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id),
  actor_id      UUID NOT NULL REFERENCES users(id),
  action        TEXT NOT NULL,
                -- result_entered | result_edited | pairing_swapped | player_dropped
                -- round_force_advanced | standings_published | player_added | player_merged
  entity_type   TEXT,
  entity_id     UUID,
  detail        JSONB NOT NULL,  -- always includes { "before": ..., "after": ... } for mutations
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Indexes

```sql
CREATE INDEX idx_tournament_players_tournament ON tournament_players(tournament_id);
CREATE INDEX idx_pairings_round ON pairings(round_id);
CREATE INDEX idx_results_pairing ON results(pairing_id);
CREATE INDEX idx_standings_tournament_round ON standings(tournament_id, round_number);
CREATE INDEX idx_standings_published
  ON standings(tournament_id, round_number) WHERE is_published = TRUE;
CREATE INDEX idx_audit_tournament ON audit_log(tournament_id, created_at DESC);
```

---

### 6.4 Performance & Scalability

| Metric | Target |
|--------|--------|
| Pairing generation (512 players) | p99 < 3 seconds |
| Standings recalculation (on round advance) | p99 < 1 second |
| Public standings page load | p95 < 800 ms (server-rendered initial payload) |
| Concurrent active tournaments per instance | 100 |
| Concurrent WebSocket connections | 5,000 per instance (horizontally scalable via Redis pub/sub) |
| API availability | 99.9% uptime SLA |
| Database backup | Daily automated backup; point-in-time recovery to within 1 hour |

**Scalability strategy:**
- Standings materialised in the `standings` table after each round advances; no real-time tiebreaker recalculation on read.
- Redis pub/sub decouples WebSocket broadcast from the API response path.
- Pairing computation is CPU-bound; offloaded to a worker process / job queue (BullMQ) to avoid blocking the Node.js event loop.
- Static assets served via CDN; SPA shell cached aggressively.
- Horizontal scaling of API tier via load balancer; PostgreSQL connection pooling via PgBouncer.
- The `results` table is separated from `pairings` so that result edits do not mutate pairing rows, keeping the audit log clean and preventing partial-write ambiguity.

---

## 7. Success Metrics

### Launch Metrics (Month 1–3)

| Metric | Target |
|--------|--------|
| Tournaments created | 100+ |
| Players registered | 1,000+ |
| Rounds completed without pairing or tiebreaker error | > 99% |
| TO satisfaction (post-event survey) | ≥ 4.2 / 5.0 |
| Pairing accuracy complaints (repeat pairings, wrong bracket) | < 0.5% of pairings |

### Growth Metrics (Month 3–12)

| Metric | Target |
|--------|--------|
| Active organizer accounts | 250+ |
| Monthly active players | 5,000+ |
| Average events per organizer per month | ≥ 2 |
| Player profile adoption (% of participants with accounts) | ≥ 40% |
| Net Promoter Score | ≥ 45 |

### Quality Metrics (Ongoing)

| Metric | Target |
|--------|--------|
| Pairing generation SLA met (p99 < 3 s) | ≥ 99.9% of rounds |
| Standings calculation SLA met (p99 < 1 s) | ≥ 99.9% of rounds |
| WebSocket delivery latency (round posted → notification) | p95 < 5 seconds |
| Data-loss incidents | Zero |
| Tiebreaker calculation accuracy vs. independent manual verification | 100% — zero known deviations from MTR Appendix E |

---

## 8. Phased Roadmap

### Phase 1: MVP (Weeks 1–8)

**Goal:** A working tournament tool a single TO can use end-to-end for a Swiss event.

**Scope:**
- [ ] TO account creation and authentication
- [ ] Tournament creation (manual config)
- [ ] Player registration — TO-only manual entry and CSV bulk import
- [ ] Swiss pairing engine (Edmonds' blossom algorithm, TypeScript implementation)
- [ ] Results entry by TO only; result validation per RES-01 constraints
- [ ] Standings display with MTR Appendix E tiebreakers (OMW%, GW%, OGW%)
- [ ] Correct bye handling (3 match points, 2-0 game credit, OMW%/OGW% exclusion)
- [ ] Correct dropped-player handling (record frozen; retained in opponents' tiebreakers)
- [ ] Public shareable standings URL (read-only; TO controls publication per round)
- [ ] Basic round timer (display only)
- [ ] Single elimination Top 8 bracket (seeded from Swiss standings)
- [ ] CSV export of final standings
- [ ] Append-only audit log (visible to TO)

**Out of scope in Phase 1:** Player accounts, push notifications, email, statistics, PWA offline mode, judge roles, late-player addition, pairing overrides

**Exit criteria:**
- 3 successful alpha test events run by internal testers with 16–32 players each
- Zero pairing errors and zero tiebreaker calculation errors verified against independent manual calculation
- Pairings generated in < 3 s for all test events
- Unit tests for pairing engine and standings engine at ≥ 95% line coverage
- OMW% floor-per-opponent behaviour explicitly covered by unit tests

---

### Phase 2: Core Product (Weeks 9–20)

**Goal:** Full-featured tool ready for public LGS use.

**Scope:**
- [ ] Player account registration and authentication (email + Google OAuth)
- [ ] Player self-registration via shareable link with TO approval queue
- [ ] Judge role (results entry; cannot advance rounds or modify settings)
- [ ] Email notifications for round pairings (per-player opt-out)
- [ ] Browser push notifications (PWA service worker)
- [ ] Player profiles with cross-tournament history
- [ ] Format-specific win rate statistics
- [ ] Round timer with audible 5-minute warning
- [ ] Pairing override (swap) with mandatory audit log entry
- [ ] TO broadcast messages (in-app + email)
- [ ] Concurrent multi-tournament support (per-organizer isolation)
- [ ] Late player addition (receives match losses for missed rounds, not byes)
- [ ] Simultaneous result submission conflict detection and TO alert (see OQ-07)

**Exit criteria:** 20 LGS organizers running live events; NPS ≥ 40; < 1% pairing error rate reported; OMW% independently verified against a reference dataset.

---

### Phase 3: Advanced Features (Weeks 21–36)

**Goal:** Platform for regional and competitive-level events; differentiation features.

**Scope:**
- [ ] Profile merge / guest record claim
- [ ] Head-to-head statistics and opponent history
- [ ] Advanced analytics dashboard for TOs (attendance trends, format popularity)
- [ ] PDF pairings export (printable table layout)
- [ ] Public read-only API for third-party integrations (scoped JWT)
- [ ] Archival and search of historical tournaments (public tournament library)
- [ ] Mobile-optimised PWA with offline standings cache and queued result-entry sync
- [ ] Full JSON export (all rounds, pairings, results, standings)

**Exit criteria:**
- 3 Regionals (150+ player events) successfully run
- OMW% calculation independently verified against WER output for identical datasets
- Offline PWA demonstrated functional at a venue with intermittent connectivity

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Pairing algorithm produces incorrect results (wrong brackets, missed rematch avoidance) | Medium | Critical | Exhaustive unit tests against known-correct tournament records; property-based testing with randomised player pools; pure-function design enables deterministic test replay |
| OMW% floor logic applied to the average rather than per-opponent (common implementation mistake) | Medium | High | Single authoritative tiebreaker computation function; dedicated unit tests for 0.33 floor with 0-win players, dropped players, and single-opponent edge cases |
| Blossom algorithm TypeScript port introduces correctness bugs | Medium | High | Use well-tested `edmonds-blossom` npm package; validate output against Python `networkx` reference for standard player counts in CI |
| WebSocket scaling bottleneck under large concurrent events | Medium | High | Redis pub/sub horizontal scaling; load test at 512 players × 5 concurrent events before public launch |
| Low TO adoption (habit inertia toward WER/spreadsheets) | High | High | White-glove onboarding for pilot LGSs; CSV import for existing data; "5-minute setup" positioning |
| Player data loss (database failure) | Low | Critical | Daily backups + point-in-time recovery; transaction-safe result writes; `results` table separate from `pairings` so partial writes are detectable |
| MTR Appendix E update invalidates tiebreaker logic | Low | Medium | Tiebreaker calculation isolated in a versioned, replaceable module; monitor WotC official MTR publication updates |
| Judge accounts used to tamper with results | Low | High | Server-side role enforcement on every mutation endpoint; full audit log with actor ID and before/after values; TO receives in-app alert on any result modification they did not perform |
| Simultaneous result submission conflict (two judges submit different results for the same table) | Low | High | Optimistic locking on result rows (ETag / version column); last-write-wins with full audit trail; TO sees conflict alert and resolves manually |

---

## 10. Open Questions

| # | Question | Owner | Target Date |
|---|----------|-------|-------------|
| OQ-01 | Should DuelTrack pursue formal WPN integration for sanctioned event reporting, or remain a complementary third-party tool? | Product | Phase 2 planning |
| OQ-02 | What is the pricing model? Freemium (free for ≤ 32 players; paid tiers for larger events)? Subscription per organizer? | Business | Before Phase 1 launch |
| OQ-03 | Should the pairing engine support draft-specific pod seating (assigning players to draft pods for the drafting phase, separate from Swiss pairings)? If so, is pod seating a separate feature or integrated into tournament creation? | Engineering / Product | Phase 2 planning |
| OQ-04 | The WPN player number field replaces the retired DCI number. Should all UI label this field "WPN Player Number" or keep it generic as "Player Number" for flexibility with non-WPN events? | Product | Phase 1 design |
| OQ-05 | What GDPR/CCPA controls are required for storing player name and email? Is a privacy policy, data-deletion flow (right to erasure), and data-processing agreement with the hosting provider required before Phase 1 launch? | Legal / Engineering | Before Phase 1 launch |
| OQ-06 | Should tournament standings and player profiles default to public, or should TOs control visibility per-event (e.g., private events for invite-only tournaments)? | Product | Phase 1 design |
| OQ-07 | What is the conflict-resolution UX when two judges simultaneously submit different results for the same table? The proposed approach (optimistic locking + TO alert) is captured in the risks table; this question covers the UI flow for the TO resolving the conflict. | Product / Engineering | Phase 2 design |
| OQ-08 | Is offline-first result entry (PWA with sync queue) required for Phase 1 or acceptable as a Phase 3 feature? Venues with poor WiFi are a stated pain point (Problem Statement row 6). The team should decide whether this gap is acceptable at launch. | Engineering / Product | Phase 1 scoping |
| OQ-09 | Is there appetite for a white-label offering for tournament circuits that want their own branding? | Business | Phase 3 planning |
| OQ-10 | Should Commander/multiplayer formats (4-player pods) be in scope? Note: pod-format pairing is fundamentally different from 1v1 Swiss (pods are not pairs; tiebreaker rules differ substantially) and would require a separate domain specification. | Product | Phase 2 planning |

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **Blossom algorithm** | Edmonds' blossom algorithm — a polynomial-time (O(n³)) graph matching algorithm that finds the maximum weight perfect matching in a general graph. Used by DuelTrack to compute optimal Swiss pairings. |
| **Bracket (score bracket / pod)** | The set of all active players with the same number of match points in a given round. Players are paired within their bracket before cross-bracket pairing is considered. |
| **Bye** | A round in which a player has no opponent. The player automatically receives 3 match points and a 2-0-0 game record credit. The bye round is excluded from the player's OMW% and OGW% denominator. |
| **DCI number** | A player identifier formerly issued by Wizards of the Coast for organised play. Discontinued in 2020 and superseded by WPN player numbers. |
| **Double Match Loss** | A penalty result (e.g., both players receive a Game Loss penalty totalling a match loss each) recorded as 0-2 / 0-2. Both players receive 0 match points. |
| **Drop** | A player who withdraws from a tournament after it has started. Their past results are retained for opponents' tiebreaker calculations. They receive a match loss for any open match at the time of the drop. |
| **GW%** | Game Win Percentage. `max(0.33, game_wins / games_played)`. Bye credit: +2 wins, +2 games. Intentional Draw: +0 wins, +0 games (no games played). |
| **ID (Intentional Draw)** | A match result where both players mutually agree to record a draw without playing. Both receive 1 match point. No games are recorded; the match adds nothing to GW%. |
| **LGS** | Local Game Store — a retail store that hosts MtG Organised Play events. |
| **Match** | A best-of-three contest between two players resulting in a match win, match draw, or match loss. |
| **Match Points** | Cumulative score: Win = 3, Draw = 1, Loss = 0, Bye = 3. |
| **MTR** | Magic: The Gathering Tournament Rules — the official WotC document governing organised play. Tiebreaker rules are defined in **Appendix E**. |
| **OGW%** | Opponent Game Win Percentage. The mean of all opponents' GW% values (each already floored at 0.33). Bye rounds excluded. |
| **OMW%** | Opponent Match Win Percentage. The mean of all opponents' MWP values, where each opponent's MWP is individually floored at 0.33 before averaging. Bye rounds excluded. |
| **REL** | Rules Enforcement Level — Regular, Competitive, or Professional. Governs penalty strictness and judging policy. |
| **Swiss system** | A tournament format where players are paired against opponents with equal or similar match records each round; no player is eliminated. |
| **TO** | Tournament Organizer — the person responsible for administering the event. |
| **Top cut** | A single-elimination bracket played after Swiss rounds, seeded by final Swiss standings: Seed 1 vs. Seed N, Seed 2 vs. Seed N-1, etc. |
| **WPN** | Wizards Play Network — WotC's organised play programme for LGS operators, replacing the DCI system from 2020 onward. |
| **WotC** | Wizards of the Coast — publisher of Magic: The Gathering. |

---

## Appendix A — Review Notes

The following corrections and additions were made during the engineering/domain review of the original draft (v1.0) to produce v1.1. All changes are motivated by domain accuracy, implementation correctness, or completeness for the development team.

### A.1 MtG Domain Corrections

| Location | Issue in v1.0 | Correction in v1.1 |
|----------|---------------|---------------------|
| Section 5.3 description | References "MTR Section 3 and Appendix C" | Corrected to "MTR Section 8 (Swiss Pairings) and Appendix E (Tiebreakers)". Appendix C in the MTR covers floor rules; it does not contain pairing or tiebreaker rules. |
| Section 5.4 tiebreaker rules heading | References "MTR Appendix C" | Corrected to "MTR Appendix E" throughout. |
| TRN-02 round count table | First row: "4–8 → 3 rounds". The MTR defines no round count for fewer than 8 players. | Row corrected to "8 → 3 rounds". Minimum player count set to 8; enforced in TRN-03. |
| Goals item 3 | "Support events from 4 to 512 players" | Corrected to "8 to 512 players" to match the MTR minimum. |
| PAR-03 bye description | "bye counts as 2-0 win" | Expanded: bye = 3 match points + 2-0-0 game record credit + excluded from OMW%/OGW% denominator. All three effects are required by MTR Appendix E. |
| RES-04 OMW% rule | "Average of each opponent's MWP (minimum 33%)" — ambiguous; can be read as flooring the final average | Rewritten to make explicit that the 0.33 floor is applied per individual opponent's MWP before averaging, not to the final OMW% result. Applying the floor to the average is a common implementation error that produces different standings. |
| RES-04 GW% rule | No mention of how Intentional Draws affect the GW% denominator | Added: ID adds 0 games to the denominator (no games were played). |
| RES-04 GW% rule | No mention of bye game credit vs. games_played | Added: bye credit = +2 game wins, +2 games played. |
| TRN-05 force-advance result | "Override incomplete results with 0-0 draw" — a 0-0 draw yields 1 match point each (a draw), not a match loss | Corrected: force-advance records a match loss for the player responsible for the outstanding result; their opponent receives a 2-0 game record win. A draw is incorrect here. |
| TRN-07 late player | "Receives byes for missed rounds" | Corrected: late players receive match losses for missed rounds. Byes in the MTR arise from odd player counts, not from late arrival. This is now explicitly distinguished. |
| RES-09 ID game record | No specification of effect on GW% | Added: ID records 0-0-3 in the pairing (0 game wins, 0 game losses, 0 games played). Both players receive 1 match point. The match does not contribute to GW%. |
| Dropped player tiebreaker treatment | No explicit statement | Added to RES-04: dropped players' records are frozen at drop round and retained for all opponents' OMW% and OGW% calculations. |

### A.2 Implementation Corrections

| Location | Issue in v1.0 | Correction in v1.1 |
|----------|---------------|---------------------|
| Section 6.2 edge weight | "RANDOM_JITTER (small float [0,1])" implied use of `Math.random()`, making pairings non-reproducible | Replaced with a deterministic hash of player sort seeds. Reproducibility is now a hard requirement for the pairing function. |
| Section 6.2 Step 1 | No sort_seed assigned to players | Added sort_seed assignment in Step 1; persisted in `tournament_players.sort_seed`. |
| Section 6.2 Blossom reference | "Reference implementation: `networkx.max_weight_matching` or equivalent TypeScript port" — networkx is a Python library and cannot be used as a runtime dependency in a Node.js application | Replaced with `edmonds-blossom` npm package as the primary implementation reference; networkx retained only as a test validator. |
| Data model — pairings table | Result columns (`result_p1_wins`, `result_p2_wins`, `result_draws`, `is_intentional_draw`, `submitted_by`, `submitted_at`) stored directly on the `pairings` row | Separated into a dedicated `results` table (1:1 with pairings). This enables audit logging of result edits without mutating the pairing row and makes partial-write failures detectable. |
| Data model — tournament_players | No `sort_seed` column | Added `sort_seed INT NOT NULL` for deterministic and reproducible bracket ordering. |
| Data model — standings | No `is_published` column | Added `is_published BOOLEAN NOT NULL DEFAULT FALSE` to support the TO-controlled standings visibility requirement (RES-05). |
| Data model — results | No CHECK constraints on game totals | Added `valid_game_total` constraint and per-column range checks to catch invalid result entries at the database layer. |

### A.3 Completeness Additions

| Addition | Reason |
|----------|--------|
| Security baseline in Section 6.1 (TLS, CSRF, rate limiting, bcrypt cost, PII scope) | Entirely absent from v1.0; required for any public-facing web application handling user accounts |
| Accessibility requirement (WCAG 2.1 AA) in Section 6.1 | Required for a public-facing product; absent from v1.0 |
| Browser support matrix in Section 6.1 | Development team needs a defined target to scope front-end work |
| Glossary (Section 11) | MtG-specific terminology used throughout without definition; essential for developers unfamiliar with Organised Play |
| Phase 1 exit criteria expanded | v1.0 mentioned tiebreaker verification informally; v1.1 makes it an explicit, measurable criterion with a unit test coverage target |
| Simultaneous result submission conflict risk (Risk 9) | Real operational hazard at events with multiple judges; absent from v1.0 |
| OQ-07 added | Addresses the conflict-resolution UX omitted from v1.0's open questions |
| OQ-08 elevated | v1.0 deferred offline PWA to Phase 3 with no discussion. Offline resilience is listed as a core pain point (Problem Statement, row 6) and the deferral decision should be deliberate and explicitly recorded |
| Phase 2 includes conflict detection scope | Derived from the new risk; development team needs to know this is a Phase 2 commitment |

---

*Document prepared by the DuelTrack Product Team. This PRD is a living document and will be updated as open questions are resolved and stakeholder feedback is incorporated.*
