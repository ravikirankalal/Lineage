# State

_Last updated: 2026-11-13_

## Status: v0.2 (unmerged branch) — phases 1–9 built; second fleet round (merge, family terms, GEDCOM, kinship gaps) reviewed and QA'd

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
| GitHub Pages deploy | ✅ live at https://ravikirankalal.github.io/Lineage/ | reported by the main session; serves `master`, so this round's features appear only after this branch merges |
| Agent fleet (`.claude/agents/`, AGENTS.md), smoke + QA scripts | ✅ done | two fleet rounds, see AGENTS.md → Fleet log |

`npm test` → 243 passing across 7 files (kinship-terms 88, gedcom 67, db 34, kinship-step 18,
contacts 16, kinship-gaps 12, kinship 8).
`npm run smoke` and `npm run qa` (10 flows) → passed at HEAD (`febb665`), as reported by the main session.

## Known limitations
- Data is per-browser/per-device; no sync yet (use backup files or GEDCOM to move data).
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
1. Merge this branch so the live site gets merge, family terms and GEDCOM
2. GEDCOM re-import that matches existing people
3. Regional terms for great-grandparents / grand-uncles; wider tree cards
4. Optional encrypted sync
