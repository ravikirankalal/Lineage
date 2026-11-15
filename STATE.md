# State

_Last updated: 2026-11-15_

## Status: cloud only (2026-11-15) — sign-in required; the tree lives in Firestore, read live and written directly; no device copy, sync, offline editing, contacts import, GEDCOM or backups

| Area | State | Verified by |
| --- | --- | --- |
| Cloud-only data layer: `store.ts` (live snapshot, transactions, one batch per change), `firestoreBackend.ts` (live listeners; owner reads all, members `scope == 'family'`; writes scope 'family'; owner deletes, editors soft-delete), `db.ts` helpers over it | ✅ done | `db.test.ts` (36, on an in-memory backend: batching, no partial writes, offline/viewer/signed-out refusal, merge, clean-ups); `npm run smoke` and `npm run qa` on the Auth + Firestore emulators (data survives reload; sharing flow 10: viewer read-only, editor change reaches owner and viewer live) |
| Sign-in required (gate before any data), offline bar and read-only while offline, sign-out back to the sign-in screen | ✅ done | `npm run smoke` (sign-in screen first, no app before sign-in, sign-out hides the family) |
| Removed: Dexie and sync, contacts import (vCard/CSV/picker/Google), GEDCOM, JSON backups, Import page, offline service worker (sw.js now unregisters itself), old on-device copies (deleted at startup) | ✅ done | `tsc -b`; smoke checks Import/backup/sync are gone |
| Clean-ups of older data: non-family links and imported contacts that never became family are deleted (owner, own family) | ✅ done | `db.test.ts` "clean-ups of older data"; `npm run qa` flow 11 (seeded emulator account: unlinked contacts deleted in the cloud, linked contacts and hand-added people kept). Dry run on a backup of the owner's real data: 1,742 to delete, 87 kept |
| People list / search / filters / profile / edit | ✅ done | `npm run smoke` (phone + desktop screenshots); `npm run qa` flows 4 (edit, unlink, delete) and 6 (dark mode, very long name) |
| Contacts as suggestions in the add sheet (2026-11-15): "Suggest from my Google contacts" (contacts.readonly via re-auth popup of the same user, downloaded once per visit into memory, never stored) and "Pick from phone contacts" (Contact Picker API, Android Chrome). Matches by name, nickname or digits; people already in the tree (same phone or full name) are left out; a picked contact becomes a hand-added person with its phones/emails | ✅ done (Google part not testable on the emulators) | `contactSuggest.test.ts` (4: mapping, matching, already-in-tree, person); smoke (fictitious contacts via emulator-only `__lineageTestContacts`: suggested, in-tree one hidden); QA flow 2 (son added from a suggestion keeps the phone and gets the wife as mother). Real Google popup/People API: not run here |
| Add relationship sheet (family only, inline create). Son/Daughter need the **other parent** (2026-11-15): prefilled with the spouse (former spouses offered too), or anyone in the tree, or a new name; adding the child is blocked until it's chosen; "is <name>'s spouse" adds the marriage for a non-spouse | ✅ done | smoke (other parent prefilled with the wife); `npm run qa` all flows: 1–2 (prefilled with Lata / Meena), 7 (no spouse: Add is disabled until a new other parent is typed) |
| Merge duplicates (`mergePeople` / `previewMerge`, `MergeSheet`) | ✅ done | `db.test.ts` (keep's values win, otherNames, subtypes kept, contradictory links removed, cycle rejection, direct-relation warning); `npm run qa` merge flow |
| Kinship engine (blood, in-law, step, half, foster, sides, paths) | ✅ done | `kinship.test.ts` (8), `kinship-step.test.ts` (18), `kinship-gaps.test.ts` (12: path-text instead of "Relative", half-sibling extension, foster siblings, `relativesOf` equal to per-target `kinship()`) |
| Hindi/Telugu family terms (`kinshipTerms.ts`, Settings "Family terms", `KinLabel`, tree cards) | ✅ done (known gaps below) | `kinship-terms.test.ts` (88, incl. batch `regionalTermsFor` equal to `regionalTerm` on fixture and random families); `npm run qa` family-terms flow (term-first tree cards) |
| Performance (500 people) | ✅ done | regional terms ~240 ms → 1.5 ms, `relativesOf` ~260 ms → 12 ms (agent-measured); equality tests guard correctness |
| My Family: a full-screen map of the tree (2026-11-15): no title, stats, Share, Add relative, save or full-screen buttons; only Find, levels, layout and zoom. Add relatives by tapping a card or the Add father/mother placeholders. Stats moved to People → Lines; the phone family switcher to People | ✅ done | `npm run smoke` (none of those buttons or the title; tree fills the screen width and most of its height); `QA_ONLY=main,features` |
| My Family on phones: bottom tabs float over the tree and slide away after 3 s without a touch; panning/zooming keeps them hidden; a tap on the tree only brings them back (doesn't open a card) (`tree/bottomTabs.ts`) | ✅ done | `npm run smoke` phone (tabs hide, tree reaches the bottom, tap shows tabs and opens no sheet); `QA_ONLY=dark,features,cleanup` (phone-size flows) |
| Everyone level: the whole family with nothing folded — cross layout opens every couple's children; no card in any layout shows a +/− (`kidsOpen`, `allOpen` in everyone.ts). Other levels still start folded | ✅ done | `familyLayout.test.ts` "Everyone has no folded cards" (3 generated families × 3 focuses × 3 layouts) and updated cross tests; smoke (no Show/Hide buttons in Everyone); `QA_ONLY=main,features,dark` |
| My Family controls see-through: Find, levels, layout, zoom, banners and phone tabs at 30% white (dark: 30% stone), no blur or shadow, text with a soft halo (`.map-glass` in index.css, only under `.tree-map` / the map's nav) | ✅ done | smoke screenshots (phone and desktop) |
| Second page renamed **Family Tree** (was My Family); the tree opens at **Extended** on every screen (phones used to start at Immediate) | ✅ done | `npm run smoke`; `QA_ONLY=features,dark` |
| People page views: Everyone / Relatives (grouped, sides, search, Show in tree → My Family highlighted) / Lines; old `#/family?tab=relatives|lines` links redirect | ✅ done | `npm run smoke` (relatives labels, Lines, old link redirect, Show in tree opens the highlighted tree); `QA_ONLY=main,features` flows 1 and 8 |
| Family tree for any person (`/people/:id/tree`, tree only) | ✅ done | manual |
| Editors must be in the tree with a phone (Sharing page person picker; `invite`/`setRole` take `personId`; rules `personWithPhone`) | ✅ done | `tests/rules/rules.test.ts` (45 on the emulator: editor invite needs an existing, undeleted person with a phone; viewers need none; invitee can't claim another person); `sharing.test.ts` (3); `npm run verify`, `npm run qa`. Sharing UI not screenshotted (needs Google sign-in) |
| Family only: no friends/colleagues/circles (add sheet family choices only; profile shows Immediate/Extended family; no Map view, no "Friends & others" filter, no "How you know them"; sample family has no friends) | ✅ done | 361 unit tests (`graph.test.ts` "family only": old non-family links and shared places ignored); `npm run smoke` passed (checks profile and add sheet have no non-family sections). `npm run qa` not run (owner's lighter rule) |
| Remember section | 🗑️ removed 2026-11-14 at the owner's request (birthdays strip and *Needs details* filter remain on People) | — |
| Family sharing: `/sharing`, invites (editor/viewer, shows sender), space switcher, read-only mode for viewers | ✅ done (emulator) | `npm run qa` flow 10 (three accounts). |
| Authorization (`firestore.rules`: deny-by-default, roles, validated writes, single-use invites) | ✅ done | `npm run test:rules` (43, Firestore emulator); security review: 3 high, 2 medium, 4 low, all fixed |
| Firebase Hosting + `firebase-deploy.yml` | ✅ live at https://lineage-d575c.web.app (the only host; GitHub Pages retired 2026-11-14) | deploy runs verified via GitHub Actions; site checked to serve the current build |
| Agent fleet (`.claude/agents/`, AGENTS.md), smoke + QA scripts | ✅ done | three fleet rounds, see AGENTS.md → Fleet log |

`npm test` → 205 passing. `npm run test:rules` → 45 passing (Firestore emulator, port 8180).
`npm run smoke` and `npm run qa` (10 flows incl. sharing and the contact clean-up, flow 11) → passed on the Auth + Firestore emulators. Run one group with `QA_ONLY=cleanup` (or main, dark, features, sharing).

## Known limitations
- Lineage needs the internet: nothing is cached, and changes can't be made offline.
- Accepted by design: members of a shared family see a family person's full record (phones,
  address, notes); there is no shared/private split for family notes yet.
- `updatedAt` uses client clocks (rules require it to grow and be ≤ now + 5 min).
- Records an older version kept as 'private' (people never linked to the family) stay visible only
  to the owner until edited; new writes are all 'family'.
- Old soft-deleted records (`deleted: true`) stay in Firestore; the app skips them.
- Regional ("Telugu") terms in a shared space are computed from the owner's "me".
- Regional terms missing for great-grandparents, grand-uncles/aunts, Telugu younger cross-cousin,
  parallel nephew/niece, and step/foster relatives (English label only).
- Long English labels ("Great-grandfather") can be cramped on narrow tree cards.
- Half-relationships are only detected for siblings (not half-uncles/half-cousins).
- Explicit step edges and chains of two half edges are not transitive (only half + full sibling extends).
- An explicit half-sibling's ancestors are not reachable as blood relatives.

## Next up (see PLAN.md backlog)
1. Split family notes into shared and private
2. Server-time stamps instead of client clocks; an invite cap per space
3. Hard-delete old soft-deleted records

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
  Ancestors too: when only one great-grandparent is recorded as the parent and the other is just their spouse
  (sitting right below), the line still starts from the middle of their marriage line, centred like a couple. Tested.
- Cross layout, Everyone (owner's request): no descendants trees (removed by the owner; nobody below your
  generation is drawn in the cross view, nor anyone reached only through them). Below the main tree, a tree for each person who married in and has recorded parents (grandmothers, your spouse, siblings'
  and uncles' spouses), each with its own titled band. Their main card is there; beside the spouse a copy.
  Tested (every person drawn with exactly one main card, unique keys, geometry, titles); screenshot-checked.
- Cross layout: every shown ancestor's brothers and sisters bring their descendants into the main tree, one
  column per generation, each level with their own parent (parents' cousins in the Parents column, second
  cousins in your column). Grandmothers' siblings stay in the grandmother's own tree. Everyone in your
  generation's column (siblings, cousins, second cousins) has their spouses right below them. Tested. Tested with positions
  and lines on all four grandparents; geometry tests pass on generated families.
- Cross layout: each ancestor's brother or sister with children (uncles, aunts, great-uncles, their children…)
  has a +/- button; their children start collapsed at every level and open on tap ("Show/Hide Name's
  children"). Collapsed families stay out of Everyone's extra trees too. Tested (unit + browser click).
- Search highlight: every step of the yellow path has a lit line, including the first step from you to a
  brother or sister (via your parent's line). Tested in all layouts; 0 unlit steps on real data (was 63/216).
- Cross layout: cousins and second cousins share the "your generation" band (same colour) with you and your siblings;
  the side bands start at the parents' columns. Tested; screenshot-checked.
- Cross layout: when second (or further) cousins are drawn, they get their own column if that fits the screen's
  shape better (wide screens); on portrait phones they stay with the first cousins. Tested (positions, lines,
  choice by aspect, aligned trees, geometry on generated families with the column on); checked on real data.
- Cross layout: cousins have their own column per side (father's left, mother's right) beside your column,
  which holds only you, your siblings and spouses; second cousins go with their side. Each side packs its own
  rows. Tested (positions, spouses, column titles, geometry on generated families); checked on real data.
- Everyone's stacked trees: the main card is the birth card (joined to the person's parents) wherever it is drawn,
  e.g. a grandmother whose birth card is in her brother's family tree; the focus always stays main. Tested.
- Cross layout: a grandmother who is also a blood relative (e.g. the other grandfather's sister) has her main
  card in her birth family; the card below her husband is the copy. Tested.
- Everyone's stacked trees are aligned: each tree's own person on the main focus's column, every band out to
  the same left and right edges (tested; screenshot-checked).
- Everyone draws every person in the family in all three layouts: anyone still missing after the layout (and,
  in cross, the descendants and married-in trees) gets a small tree of their own below, titled with how they're
  related. Tested on generated families (each person exactly one main card, valid copies, geometry, unique keys);
  ~100-170 ms for a 1,000-person random family.
- No "Brother"/"Sister" when adding someone (owner's request, to keep it simple): a sibling is added as a son
  or daughter of the parents ("Also <other parent>'s son" links both). Existing/imported sibling links still work.
  QA flows 1 and 6 updated to add the brother as a son.
- Main vs secondary cards (owner's rule): when someone appears twice, the card in their birth family (joined
  to their parents) is the main card; the card beside their spouse is a secondary "Also shown elsewhere" stub that
  can't expand to their ancestors. Cross layout makes spouse cards last; the other layouts re-run with that
  partner slot reserved when needed. Tested in all three layouts (a cousin married to a sister).
- Known limits: an ancestor's siblings
  are only drawn on the outer edge of the pedigree (father's father's line, mother's mother's line).
