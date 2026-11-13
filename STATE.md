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
| Remember: recall practice, birthdays, thin profiles | ✅ done | smoke screenshots |
| PWA manifest + service worker, dark mode | ✅ done | build; qa flow 6 (dark mode) |
| GitHub Pages deploy | ✅ live at https://ravikirankalal.github.io/Lineage/ | reported by the main session; serves `master`, so rounds 2–3 appear only after this branch merges. The Pages build now gets the Firebase web config, so sign-in works there too once merged (ravikirankalal.github.io is an authorized domain) |
| Google sign-in, account card, sign-out (never deletes cloud data) | ✅ done (emulator) | `npm run qa:cloud` (8 flows, Auth + Firestore emulators); not yet exercised against the real project lineage-d575c |
| Sync: Dexie v2 (relationship updatedAt, tombstones, meta), per-space DBs, `sync.ts` (LWW, scopes, watermarks, resync prune) | ✅ done | `sync.test.ts`, `migration.test.ts`, `db.test.ts` (fake remote); `npm run qa:cloud` (two devices, one account) |
| Family sharing: `/sharing`, invites (editor/viewer, shows sender), space switcher, read-only mode for viewers | ✅ done (emulator) | `npm run qa:cloud` (invite, join, viewer read-only, friends never shared, member removal → family copy removed) |
| Authorization (`firestore.rules`: deny-by-default, roles, validated writes, single-use invites) | ✅ done | `npm run test:rules` (43, Firestore emulator); security review: 3 high, 2 medium, 4 low, all fixed |
| Account isolation (another account's local data is never uploaded) | ✅ done | `npm run qa:cloud`; security review (account-switch race fixed) |
| Firebase Hosting + `firebase-deploy.yml` | ⏳ configured, not yet live | project lineage-d575c set up by the owner (reported); goes live at https://lineage-d575c.web.app on merge to `master` |
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
   and on GitHub Pages
2. Split family notes into shared and private
3. Server-time stamps instead of client clocks; an invite cap per space
4. GEDCOM re-import that matches existing people
