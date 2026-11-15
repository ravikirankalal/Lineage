# Lineage

**Remember the people in your life — and trace your family back through the generations.**

Lineage is a private family-tree app. Sign in with Google, build your family tree, and share it
with the relatives you choose. The tree lives in your Google account (Firebase), not on the device.

## Features

- **People** — name, nickname, other names, phones, emails, place of origin, current address,
  what they look like, work, education, birthday, photo, tags, notes, and any custom detail
  (gotra, blood group, kids' names…). Search looks through every field.
- **Family only** — adding a son or daughter always asks for the other parent (your spouse is
  filled in), so half- and step-relations are never guessed. Relationships are parent, child and spouse (biological, adoptive, step,
  foster, divorced…). Brothers and sisters are added as children of the parents, so they always
  share them. (Sibling links from older data are still understood.)
- **Contacts as suggestions** — when adding a relative, people from your Google Contacts show up
  as you type (read-only, kept in memory for that visit, never saved), and on Android you can pick
  from the phone's contacts. Only the person you choose is added.
- **Merge duplicates** — combine two profiles of the same person. You see a preview first, and
  the dropped copy's name is kept as an other name.
- **Each person's family** — their page lists immediate family, then extended family.
- **Family Tree** — your family tree as a full-screen map: ancestors above, siblings beside,
  descendants below; drag, zoom, Find, and tap a card to move around or add a relative ("Add father
  / Add mother" placeholders grow it upward). On phones the bottom tabs slide away when you
  stop touching the screen; tap the tree to bring them back. The controls are see-through, and
  *Everyone* shows the whole family with nothing folded; in the cross layout, **Implode**
  collapses it into stacked cards on your row and **Explode** animates it back. "Family tree" on any profile shows theirs (with save
  as image and full screen).
- **People → Relatives / Lines** — next to the full list (Everyone):
  - every relative with a precise label and path — *First cousin once removed · Father's brother's
    son's daughter*, *Aunt (by marriage)*, *Father-in-law*, *Half-sister*, paternal/maternal side
  - Hindi or Telugu family terms if you want them (Settings → Family terms): *Uncle · Chacha*,
    *Dadi · Grandmother* on tree cards
  - father's line and mother's line, with stats (relatives, generations, earliest ancestor)
  - "Show in tree" jumps to Family Tree with the path highlighted
- **Birthdays & gaps** — upcoming birthdays on the People page, and a *Needs details* filter for
  people whose profiles are thin.
- **Sign in with Google (required)** — the tree is read live from your account and every change is
  saved straight to it; changes by relatives you share with appear as they happen. Lineage needs
  the internet: nothing is kept on the device, and nothing can be changed offline.
- **Sharing** — invite relatives by email as viewers, or as editors (an editor must already be in
  your tree with a phone number). Who can read or write what is enforced on the server by
  Firestore security rules. Light & dark mode.

## Android app

`android/` is a Capacitor app: a native shell around the live site (so website updates reach it
without reinstalling), with Android's own Google sign-in and **read-only** access to the phone's
contacts, which show up as suggestions when adding a relative. Package `app.lineage.family`.
Setup and signing: [FIREBASE_SETUP.md › Android app](FIREBASE_SETUP.md#11-android-app). Builds:
`.github/workflows/android-apk.yml` (release **android-latest**), or locally with the Android SDK:
`npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (kinship engine, family terms, layouts, data changes)
npm run build      # static site in dist/
npm run verify     # tests + build + browser smoke test (Firebase emulators; needs Java + Chromium)
npm run qa         # browser flows incl. merge and sharing (Firebase emulators)
npm run test:rules # Firestore security-rules tests (Firebase emulator, needs Java)
```

The app needs Firebase: copy `.env.example` to `.env.local` and follow
[FIREBASE_SETUP.md](FIREBASE_SETUP.md). The smoke and QA checks start their own emulators and
sign in through an emulator-only hook.
Live: **https://lineage-d575c.web.app** (Firebase Hosting), deployed from `master` by
`.github/workflows/firebase-deploy.yml`. (GitHub Pages hosting was retired on 2026-11-14.)

Want to look around first? **Try a sample family** (offered while your tree is empty).

## Project docs

| File | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | Goals, architecture, phased roadmap, backlog |
| [STATE.md](STATE.md) | What's done, what's verified, what's next |
| [MEMORY.md](MEMORY.md) | Decisions, conventions, gotchas — read before changing code |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI-assisted sessions |
| [AGENTS.md](AGENTS.md) | Subagent fleet: roster, routing, shared commands, fleet log |
| [FIREBASE_SETUP.md](FIREBASE_SETUP.md) | One-time Firebase setup for sign-in and sharing |
