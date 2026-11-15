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
- (2026-11-14) **Cross layout lineage rule** (owner): above the focus's parents only the father's line continues on
  each side; wives married in (grandmothers etc.) sit below their husband, without their own ancestors.
- (2026-11-14) **Cross Everyone shows everyone** (owner): the main cross tree stays as above, and BELOW it
  `everyone.ts` stacks more trees: (descendants trees were REMOVED at the owner's request: the cross view shows
  nobody below the focus's generation, nor anyone reached only through them) a cross tree for anyone who married in AND has recorded parents (grandmothers, spouse, in-laws). That tree
  holds their main card; the card beside their spouse becomes the "shown elsewhere" copy. Married-in people
  without recorded parents keep ONE card (no copy). Step-families aren't chased (owner didn't ask). Keys are
  prefixed `t<i>/` per extra tree. Other levels are unchanged.
- (2026-11-14) **Cross: ancestors' brothers and sisters with their descendants, by generation** (owner): each
  generation outwards adds its siblings' families as row bands ABOVE (brothers) / BELOW (sisters) everything closer
  (father's side first), shared rows across the layout. A band = the person in their column, partners below, kids
  one column further in (first kid level with the parent), recursively down to the focus's column (there:
  partners below them, as for siblings — owner: every spouse of someone in your generation is in that band; no kids). Line ancestors are centred on their children's group and the row range grows to fit them.
  Grandmothers' siblings stay out of the main tree (owner): only the father's line continues, as before.
- (2026-11-14) **Couples' children collapsed by default** (owner; "for now only ancestors"; since 2026-11-15 NOT in Everyone, see below): in the cross layout
  every ancestor's brother/sister (and their descendants down to the focus's column) with children gets a
  +/- button; children start hidden at EVERY level, the person id in `expanded` (URL `open=`) opens them.
  Line ancestors' children always show. Collapsed people come back as `TreeLayout.hidden`; Everyone's
  catch-all (`everyoneIds` skip) leaves them and anyone reached only through them out. Descendants of the
  focus's generation are NOT handled yet (owner: later).
- (2026-11-14) Everyone `stack()` primary card: focus first, then the first card with a parent line into it (birth
  card) in ANY tree, then a married-in tree's root, then the first main card. (A grandmother's birth card can be in
  her brother's married-in tree, so she gets no tree of her own.)
- (2026-11-14) **Cousins columns** (owner): the cross middle column holds only the focus, siblings and their
  spouses; each side has its own "Cousins" column beside it (x = ±PC) with every cousin of that side (first,
  second, …) and their spouses; parents at ±2·PC, each older generation one further out (`colX`, `gapIn`).
  Each side keeps its own row range (`top`/`bottom` per side), so the sides no longer take turns.
- (2026-11-14) **Second cousins column by screen shape** (owner): `layoutCrossEveryone` lays out with and
  without a "Second cousins" column (between first cousins and parents; `secondCousinsColumn`) and keeps the one
  whose width/height is closer (log ratio) to `opts.aspect` (LineageView: window w/h in 0.25 steps). The column
  only adds width (second cousins stay level with their parents), so it is chosen on wide screens only. Extra
  Everyone trees use the same choice so the columns line up. An explicit `secondCousinsColumn` wins.
- (2026-11-14) **Cousins share your generation's band** (owner): the cross 'middle' region spans the cousins (and
  second cousins) columns of both sides, from `colX(-1,1)+PC/2` to `colX(1,1)-PC/2` (fixed, so stacked trees align),
  with 'Cousins'/'Second cousins' column titles; the father's/mother's regions start at the parents' columns.
- (2026-11-14) Path highlight: `pathEdgeKeys(edges, ids)` lights the lines for each step of relationPath; a
  sibling step has no line of its own, so it lights one shared parent's lines to both (before, ~30% of real steps
  were unlit). TreeEdges takes `lit` keys; LineageView computes them from the ordered path.
- (2026-11-14) **Trees and bands aligned** (owner): `stack()` puts every extra tree's own person at x = 0 (the
  main focus's column), so generation columns line up across trees; every band reaches the same far left/right
  (father's side / only band from the left edge, mother's side / only band to the right edge); in top-to-bottom
  layouts the main tree's stripes are as wide as the trees below.
- (2026-11-14) **Everyone = every person in the family** (owner, repeated): `everyone.ts` `completeEveryone` runs
  for every layout. After the cross-only steps above, while anyone in `familyComponent(focus)` is undrawn, the
  closest one (BFS) gets a small top-to-bottom tree (up 1, down 1; bigger ones made thousands of copies on
  random data), titled "Name · relation". Bands: stripes cover the main tree only; extra trees get titled
  regions. Tested: every person has exactly one main card in all three layouts.
- (2026-11-14) **No Add Brother/Sister** (owner): siblings are added as the parents' children. Keep reading
  existing explicit sibling edges (kinship infers shared parents), but don't offer creating them in the UI.
- (2026-11-14) **Main card rule** (owner): a person shown twice has their MAIN card in the birth family (joined to
  parents); the card beside a spouse is a secondary stub that can't expand to ancestors. familyLayout enforces it
  with a second pass (`reserved` partner slots); crossLayout creates spouse cards last. In crossLayout the rule
  covers every partner card (`partnerNodes`), incl. a wife below her husband on an ancestor line (a grandmother
  who is also a blood relative, e.g. the other grandfather's sister).
- (2026-11-14) **Cross layout** is the owner's own design (asked via questions): father's side LEFT, mother's side
  RIGHT, brothers UP, sisters DOWN (applies to every ancestor's siblings too), middle = siblings | children | spouses
  with children between their parents, grandparents further out. Default on portrait phones. Don't change these
  rules without asking. (Revised by the owner: spouses now sit directly BELOW their partner in the siblings'
  column with a marriage line. Later still: NO children/grandchildren in the cross view at all, and cousins
  share the focus's column, level with their own parent - no separate cousins column.)
- (2026-11-14) Left-to-right trees: familyLayout runs in row space with a `Geo` (card w/h swapped, `RIGHT`) and
  transposes at the end; `geo`/`STEP`/`HALF`/`ROW_GAP` are module state set per call, reset in `finally`. Node keys
  are the same in both directions, so switching animates (FLIP).
- (2026-11-14) Only the owner and editors they choose can edit. An editor invite must carry `personId`, a person in
  the owner's space with a non-empty `phones` list who is not deleted (`personWithPhone` in firestore.rules). The
  invitee copies it to `memberInfo[uid].personId` on join; the rules require it to equal the invite's. Viewer
  invites need no person. Promoting a member to editor asks for the person on the Sharing page; that check is
  client-side only (only the owner can change roles anyway). The Sharing page calls `syncNow()` first, because
  the rules read the cloud copy of the person, and a phone number added a moment ago may not have synced yet.
- (2026-11-14) Lineage is family-only. Nothing creates or shows friend/colleague/classmate/neighbour/acquaintance
  links, implicit circles (same city, school, work) or "how we met". `SocialType`, `howWeMet` and `metOn` stay in
  the types and the backup normaliser, so old databases, backups and synced records still load; their data is kept
  and ignored. `connectionsOf` returns only the 'family' and 'extended' groups. ConnectionsMap and socialGraph were
  deleted.
- (2026-11-14) Checks, the owner's rule: `npm run verify` on every change; `npm run qa` only for changes to
  import/export, editing, merging, backup or data handling (or before a big release); `npm run test:rules` only
  for sharing and permission changes. See CLAUDE.md.
- (2026-11-14) Non-family links are deleted for good: `purgeNonFamilyLinks()` (db.ts) runs from DataProvider as
  soon as any appear (old data, or pulled from an old device), and writes tombstones so the owner's next sync
  soft-deletes them in Firestore. `validRelationship` still accepts the old types (sync must not choke on them);
  only `importBackup` filters them out. The people at the other end of those links are kept.
- (2026-11-14) `scripts/qa-cloud.mjs` relies on the old sample friends (Sandeep, Farhan, …) for its privacy checks.
  It needs rework (e.g. an unlinked person) before it is run again.
- (2026-11-15) The People page shows `inFamilyList` people only: isMe, anyone with a family link, or a non-contact
  source (manual or GEDCOM, which writes 'manual'). Contacts (`source` vcard/csv/picker/google) with no family
  link stay hidden until linked. The add sheet shows family only until you type; then contacts follow family,
  labelled "From your contacts". The merge sheet still searches everyone, so a contact can be merged into a
  relative.

## Cloud only (2026-11-15)
- The owner asked to remove contacts import, sync and offline editing, and to make sign-in required. Dexie, `sync.ts`,
  `firestoreRemote.ts`, contacts import, GEDCOM, JSON backups, the Import page and the offline service worker are gone.
- `src/lib/store.ts` is the data layer: a snapshot (`loaded`, `people`, `rels`) streamed by a `Backend`, plus
  `write((t) => …)`, which runs synchronous steps on a `Tx` (reads see earlier writes) and sends them as ONE batch.
  If a step throws, nothing is sent. `db.ts` keeps the old helper names; `ops.*` are the same steps for composing
  several changes into one batch (AddRelationSheet does this).
- `firestoreBackend.ts`: owners read the whole collection; members must query `scope == 'family'` (rules are not
  filters). Every write uses scope 'family'. The owner deletes documents; editors set `deleted: true` (rules only allow
  owners to delete). Records with `deleted: true` are skipped on read. `updatedAt` = max(now, last seen + 1), because
  the rules need it to grow.
- `canWrite()` refuses while `navigator.onLine` is false and for viewers, so writes never queue in memory. Firestore
  uses its memory cache only. `usePermissions().canEdit` is also false while offline.
- Sign-in gate (`App.tsx` `Gate`): config → auth loading → sign-in screen → tree loading/error → app.
- The owner's own family: on first load, `purgeLooseContacts()` deletes contact-sourced people (vcard/csv/picker/
  google) that are not "me" and have no family link, with their remaining links. Any role: `purgeNonFamilyLinks()` on
  sight. Both are idempotent.
- `main.tsx` deletes the IndexedDB copies older versions kept ('lineage', 'lineage-space-*'); `public/sw.js` is now a
  self-unregistering worker that clears old caches.
- Browser checks (`scripts/emu.mjs`): start Auth + Firestore emulators, build with `VITE_FIREBASE_EMULATORS=1` into
  a temp dir, serve it, and sign in with `window.__lineageTestSignIn(email, name)`, which `auth.ts` defines only in
  emulator builds (the auth emulator accepts an unsigned Google ID token). `REUSE_EMULATORS=1` reuses running ones.
- Tests use `src/lib/__tests__/memoryBackend.ts` (`freshSpace()` → `{ db, backend }`; `db` is a small Dexie-shaped
  view for seeding and checks; `backend.commits` records each batch).
- **Page split (2026-11-15, owner's request):** My Family (`/family`) and `/people/:id/tree` show only the tree
  (`LineageView` has no tabs; `useTreeParams` has no `tab`). Relatives and Lines live on the People page as views
  (`?view=relatives|lines`, centred on "me"; components in `src/components/Relatives.tsx`). "Show in tree" goes to
  `/family?focus=<id>&hl=<id>`. `FamilyPage` redirects old `?tab=relatives|lines` links to `/?view=…`.
- Smoke screenshots of segmented controls can show the previous selection: the buttons have a CSS transition and
  the shot is taken right after the click.
- **My Family is a map (2026-11-15, owner's request):** `/family` renders only `<LineageView map>`; `App` `Shell` drops
  the page padding and width limit on that route (banners keep their padding). `FamilyTree` `map` = edge to edge, no
  save menu, no full-screen button; `useFillHeight` reserves only the phone tab bar (58px). The "Add relative" bar is
  gone from every tree: add from a card's sheet or the ghost cards. Save image / full screen remain on
  `/people/:id/tree`. People links use `/` (not `/people`) so the People nav item stays highlighted.
- **Auto-hiding tabs (2026-11-15, owner's request):** `src/components/tree/bottomTabs.ts`. On `/family`, phones only
  (< md, where the tab bar shows): 3 s with no pointerdown/wheel/key → hidden (`translate-y-full`, `inert`,
  `data-hidden`). Movement never shows them; a click on the tree (not on `[data-no-pan]` overlays) while hidden is
  swallowed and shows them. The listener is added after `usePanZoom`'s, and skips `defaultPrevented` clicks, so a
  drag's trailing click doesn't count. Leaving the page shows them again. In map view the tree is full height and the
  zoom controls move up while the tabs show. Browser tests that tap tree cards on phones after 3 s idle must expect
  the first tap to only show the tabs.
- **Everyone is never folded (2026-11-15, owner):** crossLayout `kidsOpen(id)` = level 'everyone' or opened; used by
  both `bandRows` and `placeBand` (they must agree, or rows overlap). `completeEveryone` ends with `allOpen()`, which
  strips `expandable`/`expanded` from every card, because the stacked extra trees' "+" only pointed at people
  already drawn elsewhere. Extended/Immediate still start folded.
- **See-through map controls (2026-11-15, owner):** add `map-glass` to a control and it turns 30% transparent, without
  blur or shadow, but only inside `.tree-map` (FamilyTree `map`) or on `nav.map-glass` (App's tabs on /family). Dark
  mode is `media`, so the dark rule is a `prefers-color-scheme` media query.
- (2026-11-15, owner) The second page is called **Family Tree** in the UI (route still `/family`; older notes say
  "My Family"). The tree's default level is Extended on every screen (`useTreeParams`); `?level=` still overrides.
  "My family" in the family switcher means your own family space, which is a different thing: keep it.
- **Other parent is required for a new son/daughter (2026-11-15, owner):** `AddRelationSheet` `OtherParentPicker`.
  Prefilled with the first current spouse; former spouses are listed as "(former)"; "Someone else" searches the tree
  or creates a new person (opposite gender). The other parent's link: adoptive/foster copy the chosen subtype, a
  step-child gets `biological` from the other parent (they are the child's own parent). A non-spouse other parent
  gets a `married` spouse link unless "is X's spouse" is unticked. Replaces the old "Also <spouse>'s son" checkbox.
  Adding a parent (Father/Mother) is unchanged.
- **Contacts as suggestions (2026-11-15, owner chose "both"):** `src/lib/contactSuggest.ts` (pure: map, match,
  contact → person) and `src/lib/cloud/googleContacts.ts` (popup re-auth of the same user with
  `contacts.readonly`, People API `connections` fetch, in-memory store `useGoogleContacts`, phone Contact Picker).
  Nothing about contacts is persisted; the token is dropped after the download. A picked contact is created with
  source 'manual' on purpose, so `purgeLooseContacts` never deletes it later. Emulator builds expose
  `window.__lineageTestContacts(list)` to load fictitious contacts; Google itself can't run on the emulators.
  Needs the People API enabled and the scope on the consent screen (FIREBASE_SETUP.md §10).
- **Android app (2026-11-15):** `capacitor.config.ts` uses `server.url` = the live site, so the APK is a shell and
  web deploys update it; rebuild the APK only for android/, plugin or config changes. `src/lib/native.ts`:
  `isNativeApp()`, `ContactsReader` (our Java plugin, READ_CONTACTS only; the community contacts plugin was
  dropped because its permission alias also demands WRITE_CONTACTS). Sign-in in the app can't use the web popup
  (Google blocks embedded browsers): `auth.ts nativeSignIn()` → Credential Manager idToken → Firebase
  `signInWithCredential`; needs `VITE_GOOGLE_WEB_CLIENT_ID` (public) and the Android app + release SHA-1 in
  Firebase. Release key: alias `lineage`, never committed; `LINEAGE_KEYSTORE`/`LINEAGE_KEYSTORE_PASSWORD` env
  (CI secrets `ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`). Losing it means a new SHA-1 and reinstalling.
- Building Android in the cloud container: Maven Central answers Gradle's user agent with 404 here; pass an
  `--init-script` that swaps repo.maven.apache.org for https://maven-central.storage-download.googleapis.com/maven2/
  (don't commit it; CI is fine). Android SDK from dl.google.com (cmdline-tools → platforms;android-36,
  build-tools;36.0.0) into the scratchpad.
- Android versioning: `LINEAGE_VERSION_CODE` env → versionCode and versionName 1.0.N (CI: $((GITHUB_RUN_NUMBER + 1)) in the shell, since workflow expressions have no arithmetic; local
  builds default to 1). Groovy gotcha: write `versionName("1.0." + x)` with parentheses; without them Groovy
  calls `versionName("1.0.")` and adds to its null result ("Value is null").
- (2026-11-15, owner) There is deliberately no way to delete the whole tree: "Delete all data" and `clearAll()` were
  removed. Don't add a bulk delete back without asking. "Try a sample family" stays (owner, empty tree, can edit).
- **Implode (2026-11-15, owner):** button only for level Everyone + orient cross (desktop defaults to "down", so pick
  the cross layout first). Owner wants a flush wall (bricks/containers), never cards hidden behind each other.
  Pure offsets in `src/lib/implode.ts`: per column cards stack CARD.h apart (nearest the focus row stays on it), then
  columns sit CARD.w apart; `useImplode` animates `[data-key]` cards with inline transforms in three timed phases
  (fade lines 250 → stack 650 → slide 550 ms), fits the wall in view, and
  `.tree-edges, .tree-bands` opacity. While not 'open', `.tree-world` has pointer-events none (panning still works).
  A layout change clears the inline styles. Print CSS already forces transforms off.

## App updates (2026-11-15)
- The Android WebView never reloads by itself, so new deploys only reach a running app through `useAppUpdate` (lib/appUpdate.ts): it compares the running `assets/index-*.js` with the one in a fresh, no-store fetch of `./`. Hosting already serves index.html with `no-cache`.
- It's mounted in `App` above `Gate`, so it also runs on the sign-in screen.
- Never auto-reload while editing (`busyEditing`: `/edit` or `/new` route, or any `[role="dialog"]`); show the bar instead.
- Pull to refresh is native-only and off on `/family` (dragging pans the tree). It's passive touch listeners on window, so it never blocks scrolling.
- Implode works per stacked tree: `treeOf(key)` reads Everyone's `t1/`, `t2/` key prefixes; extra trees pack around their `treeRoot` card. Any new way of stacking trees must keep those prefixes and mark the root.
- Android launch: the site is remote, so the WebView is empty until it arrives (black in dark theme). The splash plugin keeps the launch screen up until `hideSplash()` (Gate, once `auth.loading` is false), capped at 10 s by `launchShowDuration`. `hideSplash` swallows errors so APKs without the plugin keep working. Native changes need a new APK; the workflow runs when android/, capacitor.config.ts or package-lock.json change on master.
