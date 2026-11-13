# Lineage

**Remember the people in your life — and trace your family back through the generations.**

Lineage is a private, local-first app for people who find it hard to keep track of who's who.
Save anything about a person, link people together, and see how everyone is connected —
with a dedicated section for your own family tree and ancestors.

## Features

- **People** — name, nickname, other names, phones, emails, place of origin, current address,
  what they look like, how you know them, work, education, birthday, photo, tags, notes, and any
  custom detail (gotra, blood group, kids' names…). Search looks through every field.
- **Import contacts** — from a vCard (.vcf) or CSV exported by Android, iPhone, Google or Outlook,
  or straight from the phone's contacts in Chrome on Android. Duplicates are matched by phone /
  email / name and only fill in gaps.
- **GEDCOM import & export** — bring a tree in from other genealogy apps or export yours (GEDCOM
  5.5.1). Export defaults to *Family tree only (safe to share)*, with no contacts, notes or street
  addresses. *Everything (private backup)* is optional. Re-importing the same file adds duplicates.
- **Merge duplicates** — combine two profiles of the same person. You see a preview first, and
  the dropped copy's name is kept as an other name.
- **Relationships** — family (parent, spouse, sibling; biological, adoptive, step, foster,
  divorced…) and social (close friend, friend, colleague, classmate, neighbour, acquaintance).
- **Connections view** — every person's page lists everyone connected to them, closest first:
  immediate family → extended family → close friends → friends → colleagues → classmates →
  acquaintances → neighbours → *same neighbourhood → same city → same home town → same college →
  same workplace* (the last five are found automatically).
- **My Family** — your lineage, family only (friends are never included):
  - interactive tree (ancestors above, siblings beside, descendants below); tap to move around,
    "Add father / Add mother" placeholders to keep growing it upward
  - every relative with a precise label and path — *First cousin once removed · Father's brother's
    son's daughter*, *Aunt (by marriage)*, *Father-in-law*, *Half-sister*, paternal/maternal side
  - Hindi or Telugu family terms if you want them (Settings → Family terms): *Uncle · Chacha*,
    *Dadi · Grandmother* on tree cards
  - father's line and mother's line, stats (relatives, generations, earliest ancestor)
  - the same views work for anyone ("Family tree" on any profile)
- **Remember** — flash-card practice (face and clues → recall the name), upcoming birthdays, and
  a list of people whose profiles need details.
- **Private** — data lives only in the browser's IndexedDB on your device. JSON backup/restore in
  Settings. Installable as an app (PWA) and works offline. Light & dark mode.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (kinship engine, family terms, contacts, GEDCOM, database)
npm run build      # static site in dist/ — host anywhere
npm run verify     # tests + build + browser smoke test (needs Playwright + Chromium)
npm run qa         # exploratory browser flows (import, merge, GEDCOM, backup/restore…)
```

On a phone: open the hosted site and choose **Add to Home screen**.
Live: **https://ravikirankalal.github.io/Lineage/**, deployed from `master` by
`.github/workflows/deploy.yml` (repo Settings → Pages → Source must be *GitHub Actions*).

Want to look around first? Settings → **Try a sample family** (only offered while the app is empty).

## Project docs

| File | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | Goals, architecture, phased roadmap, backlog |
| [STATE.md](STATE.md) | What's done, what's verified, what's next |
| [MEMORY.md](MEMORY.md) | Decisions, conventions, gotchas — read before changing code |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI-assisted sessions |
| [AGENTS.md](AGENTS.md) | Subagent fleet: roster, routing, shared commands, fleet log |
