# State

_Last updated: 2026-11-13_

## Status: v0.3 (unmerged branch) — phases 1–10 built; third fleet round (Google sign-in, cloud sync, family sharing, server-side authorization) security-reviewed and QA'd on emulators

| Area | State | Verified by |
| --- | --- | --- |
| Data model, Dexie DB, backup/restore | ✅ done | `db.test.ts` (patch-only updates, `ensureRelationship`, cycle rejection, single isMe, backup normalisation/version check); `npm run qa` flow 5 (backup → delete all → restore) |
| People list / search / filters / profile / edit | ✅ done | `npm run smoke` (phone + desktop screenshots); `npm run qa` flows 4 (edit, unlink, delete) and 6 (dark mode, very long name) |
| Add relationship sheet (family + social, inline create) | ✅ done | `npm run qa` flows 1–2 (self, parents via ghost cards, brother, wife + son "Also <wife>'s son"); smoke adds a relation |
| Merge duplicates (`mergePeople` / `previewMerge`, `MergeSheet`) | ✅ done | `db.test.ts` (keep's values win, otherNames, subtypes kept, contradictory links removed, cycle rejection, direct-relation warning); `npm run qa` merge flow |
| Kinship engine (blood, in-law, step, half, foster, sides, paths) | ✅ done | `kinship.test.ts` (8), `kinship-step.test.ts` (18), `kinship-gaps.test.ts` (12: path-text instead of "Relative", half-sibling extension, foster siblings, `relativesOf` equal to per-target `kinship()`) |
| Hindi/Telugu family terms (`kinshipTerms.ts`, Settings "Family terms", `KinLabel`, tree cards) | ✅ done (known gaps below) | `kinship-terms.test.ts` (88, incl. batch `regionalTermsFor` equal to `regionalTerm` on fixture and random families); `npm run qa` family-terms flow (term-first tree cards) |
| GEDCOM 5.5.1 import/export ("Import & export" page) | ✅ done | `gedcom.test.ts` (67: parse, export, round trip, privacy modes, ASSO/RELA siblings, approximate dates, `_LINEAGE_ME`); `npm run qa` GEDCOM round-trip flow (incl. export privacy, restored "me") |
| Performance (500 people) | ✅ done | regional terms ~240 ms → 1.5 ms, `relativesOf` ~260 ms → 12 ms (agent-measured); equality tests guard correctness |
| Connections view incl. implicit circles | ✅ done | smoke screenshots (profile) |
| My Family: tree, relatives, lines, stats | ✅ done | smoke screenshots; `npm run qa` "friend never appears in My Family" |
| Lineage for any person (`/people/:id/tree`) | ✅ done | manual |
| Contacts import: vCard, CSV, Contact Picker | ✅ done | `contacts.test.ts` (16: dedupe strength, in-file dedupe, merge rules); `npm run qa` flow 3 (vcf + csv, duplicates matched); picker untested (needs Android Chrome) |
| Remember section | 🗑️ removed 2026-11-14 at the owner's request (birthdays strip and *Needs details* filter remain on People) | — |
| PWA manifest + service worker, dark mode | ✅ done | build; qa flow 6 (dark mode) |
| Google sign-in, account card, sign-out (never deletes cloud data) | ✅ done (emulator) | `npm run qa:cloud` (8 flows, Auth + Firestore emulators); not yet exercised against the real project lineage-d575c |
| Sync: Dexie v2 (relationship updatedAt, tombstones, meta), per-space DBs, `sync.ts` (LWW, scopes, watermarks, resync prune) | ✅ done | `sync.test.ts`, `migration.test.ts`, `db.test.ts` (fake remote); `npm run qa:cloud` (two devices, one account) |
| Family sharing: `/sharing`, invites (editor/viewer, shows sender), space switcher, read-only mode for viewers | ✅ done (emulator) | `npm run qa:cloud` (invite, join, viewer read-only, friends never shared, member removal → family copy removed) |
| Authorization (`firestore.rules`: deny-by-default, roles, validated writes, single-use invites) | ✅ done | `npm run test:rules` (43, Firestore emulator); security review: 3 high, 2 medium, 4 low, all fixed |
| Account isolation (another account's local data is never uploaded) | ✅ done | `npm run qa:cloud`; security review (account-switch race fixed) |
| Firebase Hosting + `firebase-deploy.yml` | ✅ live at https://lineage-d575c.web.app (the only host; GitHub Pages retired 2026-11-14) | deploy runs verified via GitHub Actions; site checked to serve the current build |
| Agent fleet (`.claude/agents/`, AGENTS.md), smoke + QA scripts | ✅ done | three fleet rounds, see AGENTS.md → Fleet log |

`npm test` → 284 passing across 9 files (adds `sync.test.ts` and `migration.test.ts`).
`npm run test:rules` → 43 passing (Firestore emulator, port 8180).
`npm run smoke`, `npm run qa` (10 flows) and `npm run qa:cloud` (8/8 flows) → passed at HEAD
(`81a1ad2`), as reported by the main session.

## Known limitations
- Without sign-in, data is per-browser/per-device (use backup files or GEDCOM to move data).
- Cloud features are verified on emulators only; the first real sign-in happens after merge.
- Accepted by design: members of a shared family see a family person's full record (phones,
  address, notes); there is no shared/private split for family notes yet.
- Last-write-wins on client clocks, so a device with a wrong clock can win or lose edits.
- A record stamped with a far-future `updatedAt` before the rules fix stays frozen (rules now
  require `updatedAt` ≤ now + 5 min and monotonic).
- Regional ("Telugu") terms in a shared space are computed from the owner's "me".
- Removing a member is best-effort on their devices: a device that never comes online keeps its copy.
- Re-importing a GEDCOM file adds duplicates (no matching against existing people yet); use Merge to clean up.
- Regional terms missing for great-grandparents, grand-uncles/aunts, Telugu younger cross-cousin,
  parallel nephew/niece, and step/foster relatives (English label only).
- Long English labels ("Great-grandfather") can be cramped on narrow tree cards.
- Tree shows focus person's siblings & spouses but not siblings' families — tap a sibling to recentre.
- Very wide families (many children per generation) make a wide tree; zoom out or use the Relatives tab.
- Half-relationships are only detected for siblings (not half-uncles/half-cousins).
- Explicit step edges and chains of two half edges are not transitive (only half + full sibling extends).
- An explicit half-sibling's ancestors are not reachable as blood relatives.
- The Contact Picker API only exists in Chrome on Android; elsewhere use a .vcf export.

## Next up (see PLAN.md backlog)
1. Merge this branch; check the first real Google sign-in, sync and invite on https://lineage-d575c.web.app
  
2. Split family notes into shared and private
3. Server-time stamps instead of client clocks; an invite cap per space
4. GEDCOM re-import that matches existing people

## Phase 11 status (2026-11-14)
- Shipped: mobile-first tree UI (pinch/pan, Fit, Centre on me, tap-card sheet, Find in tree with path
  highlight, URL state, FLIP, save image/print, Relatives sub-groups + Show in tree), Connections map
  (List | Map on person pages), batch labels, great-aunt-by-marriage fix, Remember tab removed.
  Verified by: 329 unit tests, smoke, qa (10 flows), qa:cloud (8/8), and ui-builder screenshot passes on
  the 140-person family at 390x844 touch and 1280x860, light and dark.
- Layout engine shipped (`src/lib/familyLayout.ts`, behind `layoutFamily`): family-unit hourglass, a separate
  child bar per marriage (step-parents and half-siblings drawn correctly), Half/Step badges, focus-independent
  sibling order, levels Immediate / Extended / Everyone, "+" to expand a card (siblings' families, an outer
  ancestor's siblings, parents past the top), stubs for cousin marriages / pedigree collapse.
  Verified by: 337 unit tests (incl. no-overlap and no-edge-through-card checks for every person × level in
  three generated 140-person families, < 30 ms on 1,000 people; measured ~2 ms), smoke, qa (10 flows),
  and screenshots of a remarriage family at 1400x900 and 390x844, including expand/collapse in the browser.
- Everyone also shows the parents and ancestors of everyone who married in (spouse, siblings'/children's/cousins'
  spouses, step-parents); in other levels their card has "+" to show the parents. In-law families slide to the
  nearest free space, so their lines can be long in a dense tree.
- Full-screen button on the tree (top of the zoom controls): covers the page above the phone tabs and below
  sheets, and asks the browser for real full screen where allowed; Esc or the button exits. Checked in the browser
  at 1400x900 and 390x844 (fills the screen, sheets open on top, Esc closes a sheet first, scroll restored).
- Tree direction: generations top to bottom or left to right (`orient`, URL `dir=`), a toggle beside the level picker;
  portrait screens open left to right. Same engine run with the card's axes swapped, then transposed. On a 390x600
  phone box, Fit shows cards larger on average (Immediate 0.59→0.66, Extended 0.51→0.61, Everyone 0.47→0.49 zoom,
  140-person family, every focus). No-overlap tests run in both directions.
- Cross layout (`src/lib/crossLayout.ts`, `orient: 'cross'`, the owner's design; default on portrait phones):
  father's side left, mother's side right (each step out one generation older, father's parents above mother's),
  every person's brothers above and sisters below them, the middle split into siblings | children | spouses with
  children between their parents. Layout button cycles cross → top-down → left-right. Tested: rule positions,
  levels/expand, and no-overlap / no-line-through-card for every person × level of generated families.
  Cousins (Extended+): a column between the siblings and each parent, every cousin level with their own parent;
  the parent's line goes over the top. Grandchildren and further: extra columns between the children and the
  spouses, each level with their parent; a spouse's line reaches a child through the gap above the child's rows.
  Not in the cross view yet: uncles'/aunts' spouses, in-laws' parents, parents' other partners, children's spouses. Wide families need panning: about 7 card columns at Extended.
- Generation bands (`src/lib/generationBands.ts`): soft stripes behind each generation (rows top-to-bottom,
  columns left-to-right and cross; the cross layout's two sides get a band each), labelled relative to the focus
  (Parents, Grandparents, Your generation, Children, 2× great-…). Four tints so neighbours always differ; light and
  dark checked at 390x844 and 1400x900. Fit and print include them. Tests: every card lies in its own generation's
  band and bands never overlap (top-to-bottom, left-to-right).
- Cross layout background (owner's request): three regions instead of generation stripes: Father's side (blue) |
  Siblings & descendants (grey) | Mother's side (pink), each titled, with a title per card column (Grandparents,
  Parents, Cousins, You & siblings · spouses, Children, Grandchildren). `TreeLayout.regions` from crossLayout.
- Cross layout spouses (owner's request): each spouse directly below their partner in the siblings' column, joined
  by a short marriage line; the couple's children (next column) hang from the middle of that line. A later partner
  sits below the earlier partner's children, joined by a line round the left of the column.
- Cross layout without children (owner's request): children and grandchildren are no longer drawn in the cross
  view; the middle is one column (you & siblings, each spouse below). Regions: Father's side | Siblings & spouses |
  Mother's side. Descendants remain in the top-to-bottom and left-to-right layouts.
- Cross layout cousins (owner's request): no separate cousins column; cousins share the focus's column (children
  of the parents' brothers at the top, of their sisters at the bottom), each level with their own parent, who sits
  above/below the father or mother. Middle region titled "Your generation".
- Cross layout parents' lines: both parents sit level with the focus; the father's line reaches the siblings via
  a bracket on the LEFT of their column, the mother's via one on the RIGHT, both straight across at the parent's
  row (cousins sit level with their own parents, so that row is always free). Nothing goes overhead. Tested.
- Cross layout side columns (owner's request): like the middle, every person in the father's/mother's columns has
  their spouse directly below with a marriage line: uncles'/aunts' spouses, a parent's other partner (step-parent),
  and ancestor couples (husband above wife; a loop on the outer side when siblings sit between them). Rows are
  reserved so cousins stay level with their parents. Tested.
- Cross layout lineage (owner's rule): above the parents, each side follows the grandfather's line. A grandmother
  (and every wife further up) married into the line: she sits right below her husband with a marriage line and her
  own ancestors aren't drawn. The mother's own ancestors still form the mother's side. Tested at every level.
  Every couple stacked in a column (ancestors, uncles/aunts with spouses, a parent with a step-parent) sends ONE
  line to their children from the middle of their marriage line; the focus's own parents (on opposite sides) send
  theirs from their cards. Half-siblings via a step-parent get their own bracket. Tested.
  A cousin whose other parent isn't recorded joins the uncle/aunt couple's single line (edge from the recorded
  parent only), so a family never shows two lines; a child with a different recorded other parent keeps its own.
  Parent lines also reach people linked to the family only as a brother/sister (parents inferred through the
  explicit full/untyped sibling link, as kinship already does), e.g. a great-uncle added as "brother of".
- No "Brother"/"Sister" when adding someone (owner's request, to keep it simple): a sibling is added as a son
  or daughter of the parents ("Also <other parent>'s son" links both). Existing/imported sibling links still work.
  QA flows 1 and 6 updated to add the brother as a son.
- Main vs secondary cards (owner's rule): when someone appears twice, the card in their birth family (joined
  to their parents) is the main card; the card beside their spouse is a secondary "Also shown elsewhere" stub that
  can't expand to their ancestors. Cross layout makes spouse cards last; the other layouts re-run with that
  partner slot reserved when needed. Tested in all three layouts (a cousin married to a sister).
- Known limits: an ancestor's siblings
  are only drawn on the outer edge of the pedigree (father's father's line, mother's mother's line).
