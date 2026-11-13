# Memory — decisions, conventions, gotchas

Read this before changing code. Append new learnings at the bottom.

## Product decisions
- **Local-first, no backend.** Privacy matters for a family/people database. IndexedDB via Dexie;
  JSON backup is the safety net. Sync is a backlog item, not a default.
- **"My Family" is family only.** Lineage views traverse only `parent`/`spouse`/`sibling` edges
  (`FamilyGraph.familyComponent`), so friends can never leak in. Keep it that way.
- **Store minimal edges, derive the rest.** Only parent, spouse, sibling (+ social types) are
  stored. Children, grandparents, cousins, in-laws are computed in `src/lib/kinship.ts`.
- **Adding a sibling links them to the same parents** when parents are known (better tree);
  otherwise an explicit `sibling` edge is stored and siblings are assumed to share parents.
- **Adding a parent** offers "Married to <other parent>"; **adding a child** offers "Also
  <spouse>'s child" — both default on, to keep trees connected with minimal taps.
- Partial dates are strings: `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (ancestors often only have a year).
- Gender drives labels (uncle/aunt). Unknown gender gives neutral words ("Parent", "Sibling").
- Implicit circles (same area/city/home town/college/workplace) match on normalised text; the edit
  form offers datalist suggestions from existing values to keep spellings consistent.

## Code conventions
- Pure logic in `src/lib/*` with tests in `src/lib/__tests__`; React in `components/` and `pages/`.
- All app data flows through `useData()` (`src/lib/data.tsx`): live Dexie queries + a memoised
  `FamilyGraph`. Write via helpers in `src/lib/db.ts`.
- `HashRouter` + `base: './'` so the static build works on any host/sub-path.
- Tailwind component classes (`card`, `btn-primary`, `input`, `chip`, …) live in `src/index.css`.
- Relationship direction: `parent` edge = `fromId` is parent of `toId`. Everything else symmetric.

## Gotchas
- **`scrollTo()` returns a Promise in current Chromium.** Never write
  `useEffect(() => el.scrollTo(...))` — React treats the returned Promise as a cleanup and
  crashes ("l is not a function"). Always use a block body `{ ... }`.
- TypeScript 7 rejects the `test` key in `vite.config.ts`'s `defineConfig`; vitest defaults work.
- vCard 2.1 from older Android uses QUOTED-PRINTABLE with soft line breaks — handled in `unfold`.
- iPhone vCards label phones via `itemN.X-ABLabel` lines — handled.
- Playwright in this environment: `require('playwright')` works; no install needed.
