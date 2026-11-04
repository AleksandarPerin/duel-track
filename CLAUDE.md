# DuelTrack — Definition of Done (overrides the tooling rules imported below)

A step is NOT done until all of these hold:
1. It is written as a user story with an acceptance test
   ("As a TO, I can … in the browser").
2. Failing tests were written FIRST and seen failing, then made to pass.
3. Server behaviour is covered by an `app.inject()` test against real Postgres
   (not mocks), including the permission cases (organizer / judge / stranger / anonymous).
4. The feature is reachable in the UI and exercised by a committed Playwright
   test at 375px; no throwaway-only live checks.
5. `npm run build` and `npm test` pass (and CI is green once it exists);
   coverage does not drop.
6. A harsh review by a separate reviewer agent, with every Major fixed and re-reviewed.

Until the DB test harness (A2) and committed Playwright (A3) exist, points 3
and 4 are met by a live check against the real stack, recorded in the commit
message; once they exist, they are enforced as written.

Stop and ask the user when:
- the PRD contradicts itself, or contradicts the official Magic Tournament
  Rules (MTR) or other domain rules;
- an expected value in a test would come from the PRD alone. Domain
  formulas (tiebreakers, pairing, byes, drops) must cite an independent
  source (MTR section, a judge, or a real event export) in the test.

---

# Local agent tooling

Ruflo and Agentic QE generate their own agent instructions; they live in a
local, untracked file so this one stays project-specific.

@.claude/ruflo-aqe.md
