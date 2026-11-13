# State

_Last updated: 2026-11-13_

## Status: v0.1 — phases 1–8 built; first fleet review/QA pass fixed

| Area | State | Verified by |
| --- | --- | --- |
| Data model, Dexie DB, backup/restore | ✅ done | `db.test.ts` (18 tests: patch-only updates, `ensureRelationship`, cycle rejection, single isMe, backup normalisation/version check); `npm run qa` flow 5 (backup → delete all → restore) |
| People list / search / filters / profile / edit | ✅ done | `npm run smoke` (phone + desktop screenshots); `npm run qa` flows 4 (edit, unlink, delete) and 6 (dark mode, very long name) |
| Add relationship sheet (family + social, inline create) | ✅ done | `npm run qa` flows 1–2 (self, parents via ghost cards, brother, wife + son "Also <wife>'s son"); smoke adds a relation |
| Kinship engine (blood, in-law, step, half, foster, sides, paths) | ✅ done | `kinship.test.ts` (7) + `kinship-step.test.ts` (15) |
| Connections view incl. implicit circles | ✅ done | smoke screenshots (profile) |
| My Family: tree, relatives, lines, stats | ✅ done | smoke screenshots; `npm run qa` "friend never appears in My Family" |
| Lineage for any person (`/people/:id/tree`) | ✅ done | manual |
| Contacts import: vCard, CSV, Contact Picker | ✅ done | `contacts.test.ts` (15 tests: dedupe strength, in-file dedupe, merge rules); `npm run qa` flow 3 (vcf + csv, duplicates matched); picker untested (needs Android Chrome) |
| Remember: recall practice, birthdays, thin profiles | ✅ done | smoke screenshots |
| PWA manifest + service worker, dark mode | ✅ done | build; qa flow 6 (dark mode) |
| GitHub Pages workflow | ✅ added | not yet run (Pages must be enabled) |
| Agent fleet (`.claude/agents/`, AGENTS.md), smoke + QA scripts | ✅ done | first fleet run, see AGENTS.md → Fleet log |

`npm test` → 55 passing across 4 files (db 18, contacts 15, kinship-step 15, kinship 7).
`npm run build` → clean. `npm run smoke` and `npm run qa` → passed at HEAD (`399d50c`).

## Known limitations
- Data is per-browser/per-device; no sync yet (use backup files to move data).
- Tree shows focus person's siblings & spouses but not siblings' families — tap a sibling to recentre.
- Very wide families (many children per generation) make a wide tree; zoom out or use the Relatives tab.
- Half-relationships are only detected for siblings (not half-uncles/half-cousins).
- A parent viewing their child's *explicit* step/half sibling sees "Relative".
- Explicit step/half sibling edges are not transitive (A–B, B–C doesn't make A–C).
- Foster siblings show as "Relative".
- An explicit half-sibling's ancestors are not reachable as blood relatives.
- `planImport` is O(n²); very large contact files (many thousands) will be slow.
- The Contact Picker API only exists in Chrome on Android; elsewhere use a .vcf export.

## Next up (see PLAN.md backlog)
1. GEDCOM import/export
2. Merge two people
3. Regional kinship terms (chacha / mama / bua / mausi …)
4. Optional encrypted sync
