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

## Decisions & gotchas — 2026-11-13 (first fleet run)
- **Automatic helper links use `ensureRelationship`, never `addRelationship`.** Helper links
  (co-parent, "Also <spouse>'s child", sibling → shared parents) must not overwrite an existing
  edge's subtype/note. `addRelationship` patches only the fields passed.
- **`isBloodEdge()` in `kinship.ts` is the single place that decides which parent subtypes count
  as descent.** Foster is not blood and has its own labels. Change it there, nowhere else.
- **Sibling subtype matters.** Only full/adoptive/untyped siblings share parents. Explicit
  step/half siblings get Step-/Half- labels. Adoptive siblings are linked as adoptive. No co-parent
  link is created for step/foster parents.
- Parent cycles of any length are rejected by the DB layer. Only one person can be `isMe`
  (enforced on import/restore too). Restore drops dangling relationships and checks the backup version.
- Import dedupe: `findDuplicate` returns `{ person, strength: 'strong' | 'possible' }`. A name-only
  match counts only when one side has no phone/email. Empty `Place` counts as missing when merging.
- "Earliest ancestor" is shown only when a birth year is known (otherwise it was arbitrary).
- Dexie: one `rw` transaction can wrap the helper calls; the UI does one transaction per add.
- **Port 4190 is browser-blocked**; don't use it for preview servers.
- Spawn vite in scripts via `node node_modules/vite/bin/vite.js`, not `npx`, so `kill()` stops the
  real server (npx left orphan servers behind).
- TS build info (`*.tsbuildinfo`) is gitignored.

## Repository is public (2026-11-13)
- `ravikirankalal/Lineage` is a **public** GitHub repo. GitHub Pages works on the free plan, and the
  site is served from `https://ravikirankalal.github.io/Lineage/` once Pages is enabled
  (Settings → Pages → Source: GitHub Actions).
- Everything committed is world-readable. Never commit real people's data: no real contacts,
  backups, GEDCOM files or screenshots of a real family. Test fixtures and the sample family must
  stay invented. `smoke-output/` is gitignored, so keep it that way.
- User data itself is unaffected: it lives only in each browser's IndexedDB, never in the repo.

## Decisions & gotchas — 2026-11-13 (second fleet round)
- **Merge: the kept person's values win.** The dropped person's names go to `otherNames`; edge
  subtypes (adoptive/divorced/half) carry over; sibling/spouse links that would point at an
  ancestor/descendant after the merge are removed; merges that create a parent cycle are rejected;
  `previewMerge` warns when the two are directly related.
- **GEDCOM export defaults to "Family tree only (safe to share)"**, which omits phones, emails,
  street lines, notes, how-we-met and facts. "Everything (private backup)" is opt-in.
  `_LINEAGE_ME` marks the user and is honoured on import only when no local "me" exists.
  Half/step/other sibling edges travel as `ASSO` + `RELA`.
- **Re-importing a GEDCOM file adds duplicates** by design for now; merge them. Matching existing
  people is a backlog item.
- **`parseGedcomDate` no longer returns a date for BEF/AFT/BET/FROM/TO.** Approximate ranges never
  become exact birth/death dates (deceased is still set). ABT/CAL/EST keep the year plus the qualifier.
- **`familyPathTree` is the single path search** (used by `familyPath`, `pathInTree`, `knownPath`
  and `regionalTermsFor`). Changing its `order()` changes every path and every regional term.
  Don't add a second search. For longer term patterns raise `MAX_PATTERN` in `kinshipTerms.ts`.
- **`FamilyGraph` must stay immutable.** It caches explicit sibling groups; mutate it and the cache
  goes stale. Build a new graph instead.
- **Batch callers pass `pathInTree(...) ?? null` into `kinship()`** so it reuses the shared search.
  Equality tests check batch results against per-target `kinship()` / `regionalTerm()`.
- Tree cards show the regional term first ("Dadi · Grandmother") so it isn't truncated on phones.
- **GitHub Pages source must be "GitHub Actions".** "Deploy from a branch" serves the raw source
  `index.html`, which is a blank page. Live site: https://ravikirankalal.github.io/Lineage/ (deploys `master`).

## Firebase project (2026-11-13)
- Firebase project id: **lineage-d575c** (Firestore region asia-south1). The Hosting URL is
  https://lineage-d575c.web.app (and lineage-d575c.firebaseapp.com).
- `.firebaserc` pins it for local `firebase` CLI commands. CI reads it from the repo variable
  `VITE_FIREBASE_PROJECT_ID`, and the variables plus the `FIREBASE_SERVICE_ACCOUNT` secret are set by the owner in GitHub.
- Project ids and the web config are public. The service-account JSON is the only secret and lives
  only in GitHub secrets.
