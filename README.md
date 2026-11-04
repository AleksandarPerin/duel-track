# DuelTrack

[![CI](https://github.com/AleksandarPerin/duel-track/actions/workflows/ci.yml/badge.svg)](https://github.com/AleksandarPerin/duel-track/actions/workflows/ci.yml)

A web app for running Magic: The Gathering tournaments: player registration,
Swiss pairings, results entry and standings, aimed at local game stores and
independent tournament organizers who currently run events from spreadsheets.

The product requirements are in [docs/PRD-mtg-tournament-manager.md](docs/PRD-mtg-tournament-manager.md).

## Features

### In the app

- **Sign-ups** — email login; organizers share a sign-up link, players register through it, and the organizer approves or rejects each one.
- **Running rounds** — start the tournament, Swiss pairings for each round with a round timer, results entry,
  close the round and pair the next.
- **Results and standings** — entered by the organizer or the tournament's judges, including draws, intentional
  draws and double losses. Tiebreakers (OMW%, GW%, OGW%) follow the Magic Tournament Rules, Appendix C; counting an
  intentional draw as 0-0-1 is a product decision where the rules are ambiguous (see the PRD changelog, v1.4).
- **Public page** — published standings and the round timer, served from a public JSON export endpoint.
- **Works offline** — the client is a PWA; results entered without a connection are queued and synced later.
- **Audit log** of organizer and judge actions: results, pairings, registrations, standings.

### API only so far (no screens yet)

Creating accounts, creating tournaments, adding judges, CSV import of players, optional Google sign-in, standings pushed over
WebSockets, a printable pairings PDF, player profiles and head-to-head records, the tournament archive and
analytics, and API tokens for external tools.

Pairing is a maximum-weight matching (Edmonds' blossom algorithm) that avoids rematches and assigns byes.

## Stack

TypeScript throughout, as an npm-workspaces monorepo:

| Package | |
|---|---|
| `packages/server` | Fastify, PostgreSQL (`pg`, `node-pg-migrate`), Redis (`ioredis`, BullMQ), Zod |
| `packages/client` | React, React Router, Vite, `vite-plugin-pwa`, IndexedDB |
| `packages/shared` | Types and logic shared by both |

## Running locally

Needs Node 24 and Docker.

```bash
npm install
npm run docker:up                     # Postgres 16 + Redis 7
cp .env.example .env                  # then set the two JWT secrets
set -a; . ./.env; set +a              # the server reads its config from the environment
npm run migrate -w @dueltrack/server
npm run seed:demo                     # demo organizer + a tournament with 8 players
npm run dev                           # API on :3000, client on :5173
```

The app has no sign-up or create-tournament screen yet, so `seed:demo` creates both; it prints the
login to use at http://localhost:5173. To start over, `npm run docker:reset` and migrate again.

## Testing

```bash
npm run build && npm test
```

- **Unit tests** (Vitest) for the pairing and standings engines, the offline sync queue, PDF output and validation.
- **Integration tests** drive the real Fastify app through `app.inject()` against a migrated Postgres test
  database (`dueltrack_test`, created automatically) and Redis, with no mocks. The player and result
  endpoints are checked for each role (organizer, judge, unrelated user, anonymous); the other routes are
  being backfilled to the same standard.
- **Domain rules are sourced independently.** The standings tests (tiebreakers, byes, draws) cite the Magic
  Tournament Rules section they encode rather than the PRD. Writing them that way found errors in the PRD
  itself, which are recorded in its changelog.
- **Mutation testing** was used to find assertions that passed regardless of the code under test.
- **Coverage floors** — `npm run test:coverage` measures every source file, tested or not, and fails if
  coverage drops below the floor set in each package's Vitest config. The floors only go up.
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) builds and runs the full suite with coverage,
  including the integration tests against Postgres and Redis service containers, on every push.

Next up: committed Playwright tests at a 375px mobile viewport.

## How this was built: AI agents with quality gates

DuelTrack was developed with Claude Code as a pair programmer, using
[Ruflo](https://www.npmjs.com/package/ruflo) for agent orchestration and memory and
[Agentic QE](https://www.npmjs.com/package/agentic-qe) for quality-engineering agents.
The agents write code; a definition of done in [CLAUDE.md](CLAUDE.md) decides when it is finished:

1. Each step starts as a user story with an acceptance test.
2. Tests are written first and seen failing.
3. Server behaviour is tested against real Postgres, including the permission cases.
4. Build and tests pass.
5. A separate reviewer agent reviews the change harshly; every major finding is fixed and re-reviewed before commit.

The agent also has to stop and ask, rather than guess, when the PRD contradicts itself or the
tournament rules, or when an expected test value would come only from the PRD.

This definition of done was introduced partway through the project, after the first features were built;
earlier code is being brought up to it, which is what the coverage floors track.

## Credits

The dev container setup is adapted from [cf-devpod](https://github.com/proffesor-for-testing/cf-devpod)
by Dragan Spiridonov, based on [agentists-quickstart](https://github.com/jedarden/agentists-quickstart).
