# Lineage — Plan

> Personal people-memory app with a dedicated family-lineage section.
> This file is the roadmap. `STATE.md` says where we are, `MEMORY.md` records
> decisions and conventions. Update all three at the end of every work session.

## Goals (from the brief)

1. **Remember people** — store anything about a person: name, nickname, phones,
   emails, place of origin, current address, appearance, how we met, work,
   education, birthday, free-form custom facts, photo, tags, notes.
2. **Scan contacts** — bring people in from the phone/address book.
3. **Relationships** — biological (parent/child/sibling/spouse, incl. adoptive
   and step) and social (close friend, friend, acquaintance, colleague,
   classmate, neighbour, other).
4. **Connections view** — on any person, see everyone connected to them,
   ordered by closeness: immediate family → extended family → close friends →
   friends → colleagues/classmates → acquaintances → neighbours → people in the
   same area → same city → same home town → same college → same workplace.
5. **My Family (lineage)** — special section, family only (no friends), for
   tracking ancestors, descendants and every relative, with kinship labels.
6. **Lineage for anyone** — the same tree view works centred on any person.
7. **Modern, simple, very easy UI.**

## Architecture

- **Local-first PWA**: React 19 + TypeScript + Vite, Tailwind CSS, Dexie
  (IndexedDB). Data never leaves the device; JSON backup/restore for safety.
- `HashRouter` + relative `base` so the build runs from any static host
  (GitHub Pages, a phone's home screen, a USB stick).
- Pure domain logic in `src/lib/` (kinship, connections, vCard/CSV parsing)
  with unit tests; UI in `src/pages` and `src/components`.

### Data model (`src/lib/types.ts`)

- `Person` — all profile fields; `isMe` marks the user; nested arrays for
  phones, emails, education, work, custom facts.
- `Relationship` — `{ fromId, toId, type, subtype?, note? }`.
  - `parent`: `fromId` is the parent of `toId` (subtype biological/adoptive/step).
  - `spouse`, `sibling` and all social types are symmetric.
  - Siblings are *also* derived from shared parents; an explicit `sibling`
    edge is only needed when the parents are unknown.
  - Children, grandparents, cousins, in-laws are never stored — they are
    computed.

## Phases

### Phase 1 — Foundation ✅
- [x] Scaffold (Vite, React, TS, Tailwind, Dexie, Vitest)
- [x] Data model + database + backup/restore
- [x] Tracking docs (README, PLAN, STATE, MEMORY, CLAUDE)

### Phase 2 — People ✅
- [x] People list with search (searches every field), filters, sort
- [x] Person profile page with all details
- [x] Create / edit form (sectioned, everything optional except a name)
- [x] Photo upload (resized client-side)
- [x] Delete with relationship cleanup

### Phase 3 — Relationships & connections ✅
- [x] Add relationship dialog with person picker + inline "create new person"
- [x] Kinship engine: blood relatives (any distance, cousins N times removed),
      in-laws, step relations, paternal/maternal side, path description
      ("Father's brother's son")
- [x] Connections view grouped by closeness, incl. implicit groups (same
      area/city/home town/college/workplace)

### Phase 4 — My Family (lineage) ✅
- [x] "This is me" setup
- [x] Interactive family tree (hourglass: ancestors above, descendants below,
      siblings beside), click any card to re-centre; works for any person
- [x] Relatives list grouped by kinship, with side (paternal/maternal)
- [x] Direct paternal and maternal line views
- [x] Stats: relatives known, generations known, earliest ancestor
- [x] Friends are excluded by construction (only family edges are traversed)

### Phase 5 — Contacts import ✅
- [x] vCard (.vcf) import — what Android, iOS and Google Contacts export
- [x] CSV import (Google / Outlook contacts export)
- [x] Contact Picker API on supported phones (Android Chrome)
- [x] Duplicate detection by phone number / email / exact name, review screen

### Phase 6 — Remembering ✅
- [x] "Needs details" list — people with thin profiles
- [x] Recall practice: flashcards showing face/appearance/context, guess who
- [x] Upcoming birthdays on the home screen

### Phase 7 — Polish & ship ✅
- [x] PWA manifest + offline service worker, installable on phone
- [x] Dark mode (follows system)
- [x] GitHub Pages deploy workflow

### Phase 8 — Quality & fleet ✅
- [x] Subagent fleet in `.claude/agents/` + `AGENTS.md` roster and routing
- [x] Browser smoke suite (`npm run smoke`) and `npm run verify`
- [x] Exploratory QA flows (`npm run qa`)
- [x] Whole-codebase review: 12 findings (3 high) fixed
- [x] Data integrity: patch-only relationship updates, `ensureRelationship`, cycle rejection,
      single isMe, backup normalisation + version check
- [x] Import dedupe: strong/possible matches, in-file dedupe, origin merged
- [x] Kinship: sibling subtypes, step-/half-sibling labels, foster not blood,
      earliest ancestor only with a known birth year

### Phase 9 — Second fleet round ✅
- [x] Merge two people into one (`mergePeople` / `previewMerge`, `MergeSheet`): keep's values win,
      dropped names go to otherNames, link subtypes kept, contradictory links removed, cycles
      rejected, warning when the two are directly related
- [x] Regional kinship vocabularies: Hindi/Telugu terms (`kinshipTerms.ts`), Settings
      "Family terms", "Uncle · Chacha" labels, term-first tree cards
- [x] GEDCOM 5.5.1 import/export ("Import & export" page), privacy modes (family tree only /
      everything), "me" preserved, half/step siblings via ASSO/RELA, approximate dates kept approximate
- [x] Kinship gaps: path text instead of "Relative" (covers a parent's view of a child's explicit
      step/half sibling), half-sibling extension through full siblings, foster sibling labels
- [x] Performance: shared `familyPathTree` search — regional terms ~240 ms → 1.5 ms, `relativesOf`
      ~260 ms → 12 ms on 500 people
- [x] Review (7 findings fixed) and QA (5 findings: 3 fixed, 1 warning added, 1 → backlog)
- [x] Site live on GitHub Pages (source: GitHub Actions)

### Backlog / ideas
- [ ] Optional encrypted cloud sync between devices
- [ ] GEDCOM re-import that matches existing people instead of adding duplicates
- [ ] Regional terms for great-grandparents, grand-uncles/aunts (plus Telugu younger cross-cousin,
      parallel nephew/niece, step/foster)
- [ ] Wider tree cards so "Great-grandfather" fits
- [ ] Move `likelyDuplicates` from `MergeSheet.tsx` to `src/lib` (and test it)
- [ ] Multiple photos per person, photo-based recall
- [ ] Map view of where people live / come from
- [ ] Reminders (birthdays, "haven't talked in a while")
- [ ] Kinship: transitive step edges / chained half edges, half-sibling's ancestors as blood,
      half-uncles/half-cousins
- [x] Faster `planImport`: indexed matching, 5000 contacts in ~30 ms (was ~3 s)
