# State

_Last updated: 2026-11-13_

## Status: v0.1 — all planned phases (1–7) built and verified

| Area | State | Verified by |
| --- | --- | --- |
| Data model, Dexie DB, backup/restore | ✅ done | build + manual |
| People list / search / filters / profile / edit | ✅ done | Playwright screenshots (phone + desktop) |
| Add relationship sheet (family + social, inline create) | ✅ done | Playwright: add father/mother from tree |
| Kinship engine (blood, in-law, step, half, sides, paths) | ✅ done | `kinship.test.ts` (7 tests) |
| Connections view incl. implicit circles | ✅ done | screenshots |
| My Family: tree, relatives, lines, stats | ✅ done | screenshots |
| Lineage for any person (`/people/:id/tree`) | ✅ done | manual |
| Contacts import: vCard, CSV, Contact Picker | ✅ done | `contacts.test.ts` (7 tests); picker untested (needs Android Chrome) |
| Remember: recall practice, birthdays, thin profiles | ✅ done | screenshots |
| PWA manifest + service worker, dark mode | ✅ done | build |
| GitHub Pages workflow | ✅ added | not yet run (Pages must be enabled) |

`npm test` → 14 passing. `npm run build` → clean.

## Known limitations
- Data is per-browser/per-device; no sync yet (use backup files to move data).
- Tree shows focus person's siblings & spouses but not siblings' families — tap a sibling to recentre.
- Very wide families (many children per generation) make a wide tree; zoom out or use the Relatives tab.
- Half-relationships are only detected for siblings (not half-uncles/half-cousins).
- The Contact Picker API only exists in Chrome on Android; elsewhere use a .vcf export.

## Next up (see PLAN.md backlog)
1. GEDCOM import/export
2. Merge two people
3. Regional kinship terms (chacha / mama / bua / mausi …)
4. Optional encrypted sync
