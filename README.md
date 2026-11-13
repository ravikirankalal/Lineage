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
npm test           # unit tests (kinship engine, contact parsers)
npm run build      # static site in dist/ — host anywhere
```

On a phone: open the hosted site and choose **Add to Home screen**.
A GitHub Pages workflow (`.github/workflows/deploy.yml`) deploys `main` once Pages is enabled
(repo Settings → Pages → Source: GitHub Actions).

Want to look around first? Settings → **Try a sample family** (only offered while the app is empty).

## Project docs

| File | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | Goals, architecture, phased roadmap, backlog |
| [STATE.md](STATE.md) | What's done, what's verified, what's next |
| [MEMORY.md](MEMORY.md) | Decisions, conventions, gotchas — read before changing code |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI-assisted sessions |
