# Memory — decisions, conventions, gotchas

Read this before changing code. Append new learnings at the bottom.

## Product decisions
- **Local-first, no backend.** Privacy matters for a family/people database. IndexedDB via Dexie;
  JSON backup is the safety net. Sync is a backlog item, not a default.
  _Revised 2026-11-13 (third round): still local-first and fully usable signed-out, but optional
  Google sign-in now adds Firebase sync and family sharing. See the third-round section below._
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

## Decisions & gotchas — 2026-11-13 (third fleet round: sign-in, sync, sharing)
- **`src/lib/cloud/contract.ts` is the contract** between security-engineer, data-steward and
  ui-builder (layout, roles, signatures). Change it only with the coordinator. Contract-first
  parallel work went well; do it again for cross-area features.
- **Only the family part is shared.** Members get `scope == 'family'` records (owner's family
  component + family edges). Friends, colleagues and private notes about non-family never leave
  the owner's space. **Authorization is `firestore.rules`**; the UI (`usePermissions`/`useCanEdit`)
  only mirrors it. Rules are not filters: non-owner queries must filter on scope.
- **Accepted by design:** members see a family person's full record (phones, address, notes);
  sync is last-write-wins on client clocks; a record stamped far in the future before the rules fix
  stays frozen; regional terms in a shared space use the owner's "me" (only the owner may set `isMe`).
- **Security-review fixes to keep:** invites are single-use (leftover invite allowed rejoining);
  `updatedAt` must be monotonic and ≤ now + 5 min (far-future stamps froze sync); only the owner
  sets `isMe` (an editor-planted `isMe` could un-share the family); account switching is
  race-free; a rejected edit no longer wipes the editor's copy.
- **Another account's local data is never uploaded.** Each space has its own Dexie DB. Sign-out
  never deletes cloud data. Removing a member deletes the family copy on their device via
  `refreshSpaces` (best-effort: a device that never comes online keeps it).
- Full resync prunes records that are no longer shared; `forgetSpace` drops a space's local DB.
- **Ports:** `npm run test:rules` uses Firestore on 8180 (`firebase.rules-test.json`);
  `npm run qa:cloud` uses 8080 (Firestore), 9099 (Auth) and 4196 (preview) and needs a CDN
  warm-up sign-in first. Both use project `demo-lineage`.
- **Firestore rules hot-reload in the emulator mid-test.** Don't edit `firestore.rules` while
  rules tests or qa:cloud are running.
- **Never `git stash` or switch branches while agents are editing** the working tree (the
  coordinator learned this the hard way).
- Firebase setup steps: [FIREBASE_SETUP.md](FIREBASE_SETUP.md).

## Google Contacts import (2026-11-13)
- The import never signs anyone in. `getContactsAccessToken` throws `not-signed-in`, so sign-in always
  goes through CloudProvider's account-isolation and consent flow. ImportPage disables the card until
  consent is settled, and every import path re-checks a `{uid, activeSpaceId}` snapshot before writing.
- The OAuth token (contacts.readonly) lives only in local variables. An expired token mid-fetch stops
  with "tap again"; never open a popup without a user gesture.
- Phone keys ignore extensions for matching (`phoneKey`); `phoneEntryKey` keeps different extensions
  distinct when merging lists, and db.ts mergePeople uses it too.
- `npm run qa:cloud` flow 7 (account switch) can time out once on a cold auth emulator. Re-run before
  treating it as a regression.
- Owner setup for the import: People API enabled, contacts.readonly scope, test users
  (FIREBASE_SETUP.md §10).
- (2026-11-14) The public Firebase web config is committed in `.env.production`. Builds no longer
  read VITE_FIREBASE_* repo variables except PROJECT_ID for deploy commands, because a truncated
  variable (key cut at '-') broke sign-in with auth/api-key-not-valid.

- (2026-11-14) **GitHub Pages hosting retired.** `deploy.yml` was deleted, and Firebase Hosting
  (https://lineage-d575c.web.app) is the only host. The older GitHub Pages notes above are historical.

- (2026-11-14) **Tree layout engine** is `src/lib/familyLayout.ts` (`layoutFamilyV2`, re-exported as `layoutFamily`
  in tree.ts; the old `layoutTree` hourglass is gone). Rows are keyed 2·gen (cards) and 2·gen−1 (the gap below);
  subtrees pack with per-row hulls, pedigree rows and collaterals slide outwards through an `Occupancy` with holes.
  Collaterals only on the pedigree's outer edge, otherwise they'd sit between a couple. No 'collapse' edges are
  emitted (stubs only), so the "no edge through a card" test holds. Desktop opens the tree at Extended,
  phones at Immediate (useTreeParams).
- (2026-11-14) The owner asked: **no subagents until they say so.** Do the work directly.
- (2026-11-14) Left-to-right trees: familyLayout runs in row space with a `Geo` (card w/h swapped, `RIGHT`) and
  transposes at the end; `geo`/`STEP`/`HALF`/`ROW_GAP` are module state set per call, reset in `finally`. Node keys
  are the same in both directions, so switching animates (FLIP).
