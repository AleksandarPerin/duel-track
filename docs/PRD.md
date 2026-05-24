# Product Requirements Document: DuelTrack — MtG Tournament Manager

**Version:** 1.0  
**Status:** Draft  
**Date:** 2026-05-24  
**Owner:** Product Team

---

## 1. Executive Summary

DuelTrack is a web-based Magic: The Gathering tournament management application designed to automate and streamline the full lifecycle of competitive MtG events — from player registration through Swiss-round pairings, results entry, standings calculation, and post-tournament statistics. The product targets local game stores (LGSs), regional organizers, and independent tournament organizers (TOs) who currently rely on fragile spreadsheets or desktop-only legacy tools such as Wizards Event Reporter (WER).

DuelTrack delivers a modern, mobile-responsive web interface backed by a robust Swiss pairing engine that is fully compliant with the MTR (Magic Tournament Rules) tiebreaker methodology. Its self-serve model means any organizer can run a sanctioned-quality event without specialized software installation or vendor lock-in.

---

## 2. Problem Statement

### Current Pain Points

| Pain Point | Impact |
|---|---|
| Legacy desktop tools (WER, MTG Companion) are Windows-only | Excludes macOS/Linux TOs and requires dedicated hardware |
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
- No tooling for large events that works in a browser
- Cannot delegate results entry to table judges without sharing master credentials

---

### Persona 3: The Competitive Player
**Name:** Sam  
**Age:** 22  
**Role:** Grinds FNM and local Regionals; tracks their own win rate and matchup history  
**Technical Comfort:** High — heavy mobile user

**Goals:**
- Check pairings on phone the moment they are posted
- View opponents' records, match win %, color percentages
- See their own historical performance over time

**Frustrations:**
- Has to wait in line to see paper pairings
- Cannot review past tournament history on any single platform
- No way to compare performance against local meta

---

### Persona 4: The Casual/New Player
**Name:** Jordan  
**Age:** 19  
**Role:** First-time FNM attendee, plays Arena and wants to try paper  
**Technical Comfort:** Basic — smartphone native

**Goals:**
- Easily find their seat and round pairing without confusion
- Understand standings and what they mean
- Register for the event on their phone before arriving

**Frustrations:**
- Paper systems are intimidating and opaque
- No self-service way to look up event information

---

## 4. Goals & Non-Goals

### Goals

1. Provide a web-first (no install required) tournament management tool usable on desktop and mobile
2. Implement a Swiss pairing engine fully compliant with WotC's Magic Tournament Rules (MTR) — including opponent match win % (OMW%), game win % (GW%), and opponent game win % (OGW%) tiebreakers
3. Support events from 4 to 512 players across all competitive RELs
4. Expose real-time public standings and pairings via shareable links (no login required for players to view)
5. Maintain full player profiles and historical statistics across events
6. Allow multi-judge results entry with role-based access control
7. Support single elimination (Top 8/4) brackets following Swiss rounds
8. Enable data export (CSV, JSON, PDF) for compliance and record-keeping
9. Provide round timer with push/web notifications

### Non-Goals (v1.0)

- **Not a deck registration or decklist submission tool** (out of scope for v1)
- **Not a matchmaking service** for unorganized play (1v1 queuing like Arena)
- **Not integrated with Wizards Play Network** for official sanctioning — organizers export and self-report
- **Not a mobile native application** (iOS/Android apps) — web app must work on mobile browsers
- **Not a payment processor** — entry fee collection is out of scope
- **Not a live video streaming platform** for feature matches
- **Not a sealed/draft pool generator**

---

## 5. Feature Requirements

### 5.1 Player Registration

#### Description
Tournament organizers and/or players can register participants for an event. Registration may be configured as TO-only entry (organizer manually adds players) or self-service (players join via shareable link).

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| REG-01 | TO can add players manually (name, optional DCI/email) | Must Have | Player appears in tournament roster within 1 second of submission |
| REG-02 | TO can import player list via CSV (name, email columns) | Must Have | Up to 512 rows processed; invalid rows flagged with row number |
| REG-03 | Players can self-register via shareable event link (no account required) | Should Have | Player submits name + optional email; TO approval queue shown |
| REG-04 | TO can approve or reject pending self-registrations | Should Have | Status visible in roster; approved players immediately eligible |
| REG-05 | TO can add/drop players before round 1 starts | Must Have | Drop removes player from all future pairings; past results preserved |
| REG-06 | Players with existing accounts auto-fill profile data | Should Have | Known email pre-populates name and DCI number |
| REG-07 | TO can assign first-round byes at registration | Should Have | Bye player receives 2-0 record credit and sits out round 1 |
| REG-08 | Duplicate name/email detection with TO override | Should Have | Warning shown; TO can confirm or merge |

#### Data Captured per Player

```
- Display name (required)
- Email address (optional)
- DCI / player number (optional)
- Linked account ID (if authenticated)
- Registration timestamp
- Bye flag
- Drop status + round dropped
```

---

### 5.2 Tournament Creation & Management

#### Description
Organizers create and configure tournaments, control round progression, and manage the event lifecycle from setup through completion.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| TRN-01 | TO can create a tournament with name, date, format, REL, venue | Must Have | Tournament visible in TO dashboard immediately |
| TRN-02 | System auto-calculates recommended round count from player count (per MTR table) | Must Have | Shown as default; TO can override within ±1 |
| TRN-03 | TO can start tournament (locks registration, generates round 1 pairings) | Must Have | Round 1 pairings visible within 3 seconds for ≤512 players |
| TRN-04 | TO can advance to next round after all results entered | Must Have | "Advance Round" button enabled only when all tables have results |
| TRN-05 | TO can force-advance round (override incomplete results with 0-0 draw) | Must Have | Warning dialog; audit log entry created |
| TRN-06 | TO can drop a player mid-tournament (graceful removal) | Must Have | Player removed from future pairings; receives loss for current open match |
| TRN-07 | TO can add a late player (receives byes for missed rounds) | Should Have | System assigns loss records for all past rounds; player enters next round |
| TRN-08 | Multiple simultaneous tournaments per organizer account | Should Have | Each tournament fully isolated; no cross-contamination |
| TRN-09 | Tournament can be paused (all actions frozen) and resumed | Could Have | State preserved across pause; all participants notified |
| TRN-10 | TO can configure Swiss rounds + Top 8/4/2 cut | Must Have | Cut announced after final Swiss round; bracket generated automatically |
| TRN-11 | Tournament formats: Standard, Modern, Legacy, Vintage, Pioneer, Draft, Sealed, Commander | Must Have | Format stored in metadata; affects display only in v1 |
| TRN-12 | REL levels: Regular, Competitive, Professional | Should Have | REL stored; Professional REL requires judge account role |

#### Tournament Lifecycle States

```
DRAFT → REGISTRATION_OPEN → IN_PROGRESS → TOP_CUT → COMPLETED → ARCHIVED
```

#### MTR Round Count Reference (auto-calculated)

| Players | Swiss Rounds |
|---------|-------------|
| 4–8 | 3 |
| 9–16 | 4 |
| 17–32 | 5 |
| 33–64 | 6 |
| 65–128 | 7 |
| 129–226 | 8 |
| 227–409 | 9 |
| 410–512 | 10 |

---

### 5.3 Swiss Pairing Engine

#### Description
The core algorithmic component. Generates optimal pairings for each round of Swiss play, minimizing repeat pairings and respecting point-based seeding, in compliance with WotC MTR Section 3 and Appendix C.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| PAR-01 | Players paired within same match-points bracket first | Must Have | All players with equal points paired against each other before crossing brackets |
| PAR-02 | No player paired against same opponent twice (rematch avoidance) | Must Have | System exhausts all non-rematch options before allowing rematch |
| PAR-03 | Bye assignment: lowest-ranked eligible player in lowest bracket receives bye | Must Have | Same player cannot receive two byes; bye counts as 2-0 win |
| PAR-04 | Seat/table assignment randomized within pairing | Must Have | Random coin flip for player 1 vs player 2 seat |
| PAR-05 | Pairings generated in under 3 seconds for ≤512 players | Must Have | Measured at p99 on reference hardware |
| PAR-06 | Pairings output sorted by table number; top tables = best records | Must Have | Table 1 = highest-point matchup |
| PAR-07 | Support odd player counts (automatic bye generation) | Must Have | If odd players, one player receives bye per round |
| PAR-08 | TO can manually override one or more pairings post-generation | Should Have | Override logged; affects only current round; does not alter algorithm state |
| PAR-09 | Pairing algorithm falls back to weighted random after constraint exhaustion | Should Have | Documented fallback; warning logged when invoked |
| PAR-10 | Top 8/4/2 single elimination bracket seeded by Swiss standings | Must Have | Seed 1 vs 8, 2 vs 7, etc. (standard bracket seeding) |

---

### 5.4 Results Entry & Standings

#### Description
Table judges and the head judge record match results. The system immediately recalculates standings and tiebreakers after each result is submitted.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| RES-01 | TO and judges can enter results by table number | Must Have | Result (2-0, 2-1, 1-2, 0-2, 1-1-1 draw, intentional draw) saved instantly |
| RES-02 | Results locked after round advances; TO can unlock specific result for correction | Must Have | Unlock creates audit log entry with reason |
| RES-03 | Standings recalculate within 1 second of result entry | Must Have | Standings page reflects updated data without full page reload |
| RES-04 | Tiebreakers calculated per MTR Appendix C: OMW%, GW%, OGW% | Must Have | All three values displayed in standings; sort order enforced |
| RES-05 | Public standings page accessible via shareable URL (no login) | Must Have | Page auto-refreshes every 30 seconds; manual refresh button available |
| RES-06 | Players can view their own pairing by entering table number or name search | Must Have | Search results in under 500ms |
| RES-07 | TO can enter result as match loss for a dropped player | Must Have | Dropped player's opponent receives 2-0 result |
| RES-08 | Judge role: can enter results but cannot advance rounds or modify settings | Must Have | Role enforced server-side |
| RES-09 | Intentional Draw (ID) must be explicitly selected; not a default option | Must Have | Separate "Intentional Draw" button with confirmation dialog |
| RES-10 | Export standings as CSV or PDF at any point during tournament | Should Have | Download available within 2 seconds; includes all tiebreaker columns |

#### Standings Display Columns

```
Rank | Player Name | Points | Record (W-L-D) | OMW% | GW% | OGW%
```

#### Tiebreaker Calculation Rules

1. **Match Points**: 3 per win, 1 per draw, 0 per loss
2. **Opponent Match-Win % (OMW%)**: Average of each opponent's match win percentage (minimum 33%)
3. **Game Win % (GW%)**: Games won / total games played (minimum 33%)
4. **Opponent Game-Win % (OGW%)**: Average of each opponent's GW% (minimum 33%)

---

### 5.5 Player Profiles & Statistics

#### Description
Registered (authenticated) players have persistent profiles that aggregate historical performance data across all events played on the platform.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| PRF-01 | Authenticated players have a persistent profile page | Must Have | Profile accessible at `/player/{username}` |
| PRF-02 | Profile displays: total events, overall W/L/D record, win rate % | Must Have | Calculated from all completed tournaments |
| PRF-03 | Profile shows per-tournament history with format, placement, record | Should Have | Sorted by date descending; paginated at 20 per page |
| PRF-04 | Profile shows format-specific win rates (e.g., Modern 64%, Standard 58%) | Should Have | Displayed as bar chart and table |
| PRF-05 | Profile shows common opponents and head-to-head record | Could Have | Shows top 10 most-faced opponents |
| PRF-06 | Profile shows average finish percentile across events | Could Have | Percentile = (players below player / total players) × 100 |
| PRF-07 | Players can set profile to private (hides from public search) | Should Have | Private profiles still visible to TO; excluded from public search |
| PRF-08 | TO can claim/merge guest records into a player's profile retroactively | Should Have | Email match or manual TO linkage; creates merge audit log |

#### Public Profile URL Structure

```
/player/{username}                → public profile
/player/{username}/history        → full tournament history
/player/{username}/stats          → detailed statistics breakdown
```

---

### 5.6 Notifications & Communication

#### Description
The system notifies players of round pairings, standings updates, and administrative messages via in-app display, email, and/or browser push notifications.

#### Functional Requirements

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NOT-01 | Browser push notification sent to subscribed players when new round posted | Should Have | Notification delivered within 5 seconds of round publication |
| NOT-02 | Email notification sent to players with email on file when round posted | Should Have | Email delivered within 60 seconds; includes table number and opponent |
| NOT-03 | In-app round timer visible to all participants on public standings page | Must Have | Countdown timer; TO sets duration (default 50 minutes); audible alert at 5 min |
| NOT-04 | TO can broadcast a message to all registered players (in-app + email) | Should Have | Message appears as banner on tournament page; logged in audit trail |
| NOT-05 | Players can opt out of email notifications per-tournament | Should Have | Opt-out link in every email; preference stored per tournament |
| NOT-06 | TO receives alert when any table has not submitted results within 10 minutes of timer expiry | Could Have | Alert shown in TO dashboard with table numbers |

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
                 │ HTTPS / WSS
┌────────────────▼────────────────────────────┐
│               API Layer                     │
│   Node.js + Express (or Fastify)            │
│   RESTful JSON API + WebSocket server       │
│   JWT authentication (short-lived tokens)  │
│   Role-based access control middleware      │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│              Data Layer                     │
│   PostgreSQL (primary relational store)     │
│   Redis (session cache, pub/sub for WS)     │
│   Object storage (exports, attachments)     │
└─────────────────────────────────────────────┘
```

**Hosting Target:** Containerized deployment (Docker Compose for dev; Kubernetes or Railway/Render for production).

**Authentication:** Email + password with bcrypt hashing. Optional OAuth2 (Google) for player convenience. JWT access tokens (15 min) + refresh tokens (7 days) stored in httpOnly cookies.

**Real-time:** WebSocket connections (Socket.io or native ws) per tournament room. Server pushes pairing and standings events; clients subscribe on tournament join.

---

### 6.2 Pairing Algorithm Specification

The pairing engine implements a weighted maximum matching over a graph of eligible player pairs, using the following approach:

#### Algorithm: Dutch Pairings (MTR-compliant weighted matching)

**Step 1: Group players by match points**
```
brackets = group_by(players, key=match_points)
sort brackets descending
```

**Step 2: Within each bracket, generate candidate pairs**
```
for each bracket:
    candidates = all (p1, p2) combinations where:
        - p1 ≠ p2
        - (p1, p2) not in previous_pairings
    if no valid candidates → allow one rematch (lowest-weight rematch)
```

**Step 3: Assign edge weights**
```
weight(p1, p2) =
    BASE_WEIGHT
    - REMATCH_PENALTY   (if previously paired)
    - BRACKET_CROSS_PENALTY × |bracket(p1) - bracket(p2)|  (if crossing point brackets)
    + RANDOM_JITTER     (small float [0,1] for randomization within equal-weight edges)
```

**Step 4: Apply Blossom algorithm for maximum weight perfect matching**
- Use Edmond's blossom algorithm (O(n³)) for optimal matching
- For n ≤ 512 this runs in well under the 3-second SLA
- Reference implementation: `networkx.max_weight_matching` or equivalent TypeScript port

**Step 5: Handle odd player count**
```
if len(players) % 2 == 1:
    bye_candidate = lowest_ranked player without prior bye
    assign bye to bye_candidate
    remove from matching pool before Step 4
```

**Step 6: Assign table numbers**
```
sort matched pairs by combined match points (descending)
assign table 1 to highest-points pair, incrementing
randomize player seat within each pair (coin flip)
```

#### Complexity

| Event Size | Pairs | Blossom Runtime (estimated) |
|-----------|-------|----------------------------|
| 16 players | 8 | < 1ms |
| 64 players | 32 | < 10ms |
| 256 players | 128 | < 200ms |
| 512 players | 256 | < 1.5s |

---

### 6.3 Data Model

#### Core Entities

```sql
-- Users (authenticated accounts)
users (
  id            UUID PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  dci_number    TEXT,
  role          TEXT DEFAULT 'player',  -- player | judge | organizer | admin
  profile_public BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
)

-- Tournaments
tournaments (
  id            UUID PRIMARY KEY,
  organizer_id  UUID REFERENCES users(id),
  name          TEXT NOT NULL,
  format        TEXT NOT NULL,        -- standard | modern | legacy | ...
  rel_level     TEXT NOT NULL,        -- regular | competitive | professional
  venue         TEXT,
  scheduled_at  TIMESTAMPTZ,
  status        TEXT DEFAULT 'draft', -- draft | registration | in_progress | top_cut | completed | archived
  total_rounds  INT NOT NULL,
  current_round INT DEFAULT 0,
  top_cut       INT DEFAULT 8,        -- 0 = no cut, 4 | 8
  created_at    TIMESTAMPTZ DEFAULT NOW()
)

-- Tournament Players (registration junction)
tournament_players (
  id              UUID PRIMARY KEY,
  tournament_id   UUID REFERENCES tournaments(id),
  user_id         UUID REFERENCES users(id) NULLABLE,  -- null for guest registrations
  guest_name      TEXT,
  guest_email     TEXT,
  seed            INT,
  byes_received   INT DEFAULT 0,
  status          TEXT DEFAULT 'active', -- active | dropped | disqualified
  drop_round      INT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
)

-- Rounds
rounds (
  id            UUID PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id),
  round_number  INT NOT NULL,
  status        TEXT DEFAULT 'pending', -- pending | active | completed
  timer_minutes INT DEFAULT 50,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  UNIQUE(tournament_id, round_number)
)

-- Pairings
pairings (
  id              UUID PRIMARY KEY,
  round_id        UUID REFERENCES rounds(id),
  table_number    INT NOT NULL,
  player1_id      UUID REFERENCES tournament_players(id),
  player2_id      UUID REFERENCES tournament_players(id) NULLABLE,  -- null = bye
  result_p1_wins  INT,
  result_p2_wins  INT,
  result_draws    INT,
  is_intentional_draw BOOLEAN DEFAULT FALSE,
  submitted_by    UUID REFERENCES users(id),
  submitted_at    TIMESTAMPTZ,
  override_note   TEXT,
  UNIQUE(round_id, table_number)
)

-- Standings (materialized / cached per round)
standings (
  id                UUID PRIMARY KEY,
  tournament_id     UUID REFERENCES tournaments(id),
  round_number      INT NOT NULL,
  player_id         UUID REFERENCES tournament_players(id),
  match_points      INT NOT NULL,
  match_wins        INT NOT NULL,
  match_losses      INT NOT NULL,
  match_draws       INT NOT NULL,
  game_wins         INT NOT NULL,
  game_losses       INT NOT NULL,
  omw_percent       NUMERIC(6,4),
  gw_percent        NUMERIC(6,4),
  ogw_percent       NUMERIC(6,4),
  rank              INT,
  UNIQUE(tournament_id, round_number, player_id)
)

-- Audit Log
audit_log (
  id            UUID PRIMARY KEY,
  tournament_id UUID REFERENCES tournaments(id),
  actor_id      UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     UUID,
  detail        JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
```

#### Indexes

```sql
CREATE INDEX idx_tournament_players_tournament ON tournament_players(tournament_id);
CREATE INDEX idx_pairings_round ON pairings(round_id);
CREATE INDEX idx_standings_tournament_round ON standings(tournament_id, round_number);
CREATE INDEX idx_audit_tournament ON audit_log(tournament_id, created_at DESC);
```

---

### 6.4 Performance & Scalability

| Metric | Target |
|--------|--------|
| Pairing generation (512 players) | p99 < 3 seconds |
| Standings recalculation | p99 < 1 second after result entry |
| Public standings page load | p95 < 800ms (server-rendered initial payload) |
| Concurrent tournaments | 100 simultaneous active tournaments per instance |
| Concurrent WebSocket connections | 5,000 per instance (horizontally scalable via Redis pub/sub) |
| API availability | 99.9% uptime SLA |
| Database backup | Daily automated backup; point-in-time recovery to 1 hour |

**Scalability Strategy:**
- Standings materialized in `standings` table after each result; no real-time tiebreaker recalculation on read
- Redis pub/sub decouples WebSocket broadcast from API response path
- Pairing computation is CPU-bound; offload to worker process / job queue (BullMQ) to avoid blocking event loop
- Static assets served via CDN; SPA shell cached aggressively
- Horizontal scaling of API tier via load balancer; PostgreSQL connection pooling via PgBouncer

---

## 7. Success Metrics

### Launch Metrics (Month 1–3)

| Metric | Target |
|--------|--------|
| Tournaments created | 100+ |
| Players registered | 1,000+ |
| Rounds completed without error | > 99% |
| TO satisfaction (post-event survey) | ≥ 4.2 / 5.0 |
| Pairing accuracy complaints | < 0.5% of pairings |

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
| Pairing generation SLA met | ≥ 99.9% |
| Standings calculation SLA met | ≥ 99.9% |
| WebSocket delivery latency (round posted → notification) | p95 < 5 seconds |
| Zero data-loss incidents | 100% |

---

## 8. Phased Roadmap

### Phase 1: MVP (Weeks 1–8)

**Goal:** A working tournament tool a single TO can use end-to-end for a Swiss event.

**Scope:**
- [ ] TO account creation and authentication
- [ ] Tournament creation (manual config; no wizard)
- [ ] Player registration (TO-only manual entry)
- [ ] Round generation using Swiss pairing engine (core blossom algorithm)
- [ ] Results entry by TO only
- [ ] Standings display with MTR tiebreakers
- [ ] Public shareable standings URL (read-only)
- [ ] Basic round timer (display only)
- [ ] Single elimination Top 8 bracket (seeded from Swiss standings)
- [ ] CSV export of final standings

**Out of Scope in Phase 1:** Player accounts, push notifications, email, statistics, mobile PWA, judge roles

**Exit Criteria:** 3 successful alpha test events run by internal testers with 16–32 players each, zero pairing errors, pairings generated in < 3s.

---

### Phase 2: Core Product (Weeks 9–20)

**Goal:** Full-featured tool ready for public LGS use.

**Scope:**
- [ ] Player account registration and authentication (email + Google OAuth)
- [ ] Player self-registration for events via shareable link
- [ ] TO approval queue for self-registrations
- [ ] Judge role (results entry, read-only settings)
- [ ] Email notifications for round pairings (per-player opt-out)
- [ ] Browser push notifications (PWA)
- [ ] Player profiles with cross-tournament history
- [ ] Format-specific win rate statistics
- [ ] CSV import for player bulk registration
- [ ] Round timer with audible 5-minute warning
- [ ] Pairing override with audit log
- [ ] TO broadcast messages

**Exit Criteria:** 20 LGS organizers running live events, NPS ≥ 40, < 1% pairing error rate reported.

---

### Phase 3: Advanced Features (Weeks 21–36)

**Goal:** Platform for regional and competitive-level events; differentiation features.

**Scope:**
- [ ] Multi-event support (side events, multiple simultaneous tournaments)
- [ ] Late player addition with automatic bye assignment
- [ ] Profile merge / guest record claim
- [ ] Head-to-head statistics and opponent history
- [ ] Advanced analytics dashboard for TOs (attendance trends, format popularity)
- [ ] PDF pairings export (printable table layout)
- [ ] API access for third-party integrations (read-only, scoped JWT)
- [ ] Customizable tiebreaker ordering (for non-standard formats)
- [ ] Archival and search of historical tournaments (public tournament library)
- [ ] Mobile-optimized PWA with offline standings cache

**Exit Criteria:** 3 Regionals (150+ player events) successfully run; OMW% calculation independently verified against WER output for identical data sets.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Pairing algorithm produces incorrect results | Medium | Critical | Exhaustive unit tests against known WER outputs; property-based testing with randomized player pools; formal verification of tiebreaker math |
| WebSocket scaling bottleneck under large events | Medium | High | Redis pub/sub horizontal scaling; load testing at 512 players × 5 concurrent events before launch |
| Low TO adoption (habit inertia toward WER/spreadsheets) | High | High | White-glove onboarding for pilot LGSs; import tool for existing spreadsheet data; "5-minute setup" positioning |
| Player data loss (database failure) | Low | Critical | Daily backups + point-in-time recovery; transaction-safe result writes; optimistic locking on standings |
| MTR rule changes invalidating tiebreaker logic | Low | Medium | Decouple tiebreaker calculation into a versioned, replaceable module; monitor WotC official communications |
| Abuse of public standings URLs (scraping, DDoS) | Medium | Medium | Rate limiting on public endpoints; Cloudflare or equivalent CDN/WAF in front of API |
| Judge accounts used to tamper with results | Low | High | Server-side role enforcement; full audit log with actor ID; TO receives alert on any result modification |
| Blossom algorithm port introduces bugs | Medium | High | Use well-tested reference implementation; validate output against known-good pairings for standard player counts |

---

## 10. Open Questions

| # | Question | Owner | Target Date |
|---|----------|-------|-------------|
| OQ-01 | Should DuelTrack pursue formal WPN integration for sanctioned event reporting, or remain a complementary third-party tool? | Product | Phase 2 planning |
| OQ-02 | What is the pricing model? Freemium (free for ≤ 16 players; paid tiers for larger events)? Subscription per organizer? | Business | Before Phase 1 launch |
| OQ-03 | Should the pairing algorithm support Draft-specific considerations (e.g., pod seating)? If so, does pod assignment happen within DuelTrack? | Engineering | Phase 2 planning |
| OQ-04 | How should the system handle a WotC DCI number field given WPN is transitioning away from DCI numbers? | Product | Immediately |
| OQ-05 | Is there a legal or compliance obligation to store player PII (email, name) and if so, what GDPR/CCPA controls are required? | Legal / Eng | Before Phase 1 launch |
| OQ-06 | Should standings and player profiles be permanently public, or should TOs control visibility (e.g., private event)? | Product | Phase 1 design |
| OQ-07 | What is the conflict-resolution policy when two judges simultaneously submit different results for the same table? | Product / Eng | Phase 2 design |
| OQ-08 | Should the mobile experience support offline-first result entry with sync when connectivity is restored (relevant for venues with poor WiFi)? | Engineering | Phase 3 scoping |
| OQ-09 | Is there appetite for a white-label offering for tournament circuits that want their own branding? | Business | Phase 3 planning |
| OQ-10 | Should Commander/multiplayer formats (4-player pods) be in scope, and if so, what pairing model applies? | Product | Phase 2 planning |

---

*Document prepared by the DuelTrack Product Team. This PRD is a living document and will be updated as open questions are resolved and stakeholder feedback is incorporated.*
