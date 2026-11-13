# Agent fleet

Lineage is developed with a small fleet of specialised Claude Code subagents. Their definitions
are in `.claude/agents/`. Claude Code loads them automatically, so you can name one in a request
("have the qa-tester check the import flow") or let the main session delegate.

## Roster

| Agent | Owns | Edits code? | Use it when |
| --- | --- | --- | --- |
| `kinship-engineer` | `src/lib/kinship.ts`, `tree.ts`, `connections.ts` + tests | yes | relationship labels, tree layout, connection grouping |
| `ui-builder` | `src/pages`, `src/components`, `src/index.css` | yes | new screens, forms, polish, responsive/dark-mode fixes |
| `import-specialist` | `src/lib/contacts.ts`, backup format, `ImportPage` | yes | contacts formats, dedupe/merge, GEDCOM |
| `data-steward` | `src/lib/types.ts`, `src/lib/db.ts` | yes | any schema/field change, Dexie migrations, integrity rules |
| `code-reviewer` | — | no (read-only) | after non-trivial changes; whole-codebase audits |
| `qa-tester` | `scripts/` test scripts only | no app code | before shipping; after UI changes; exploratory testing |
| `docs-keeper` | `STATE.md`, `PLAN.md`, `MEMORY.md`, `README.md`, `AGENTS.md` | docs only | end of every session; after agent reports |

## Routing a task

```
feature request
  ├─ touches stored fields/schema? ──► data-steward first (migration plan)
  ├─ derivation / labels / layout? ──► kinship-engineer
  ├─ import / export formats?      ──► import-specialist
  └─ screens / interaction?        ──► ui-builder
then, in parallel:  code-reviewer (diff)  +  qa-tester (browser)
fix confirmed findings with the owning agent
finally:            docs-keeper  (STATE / PLAN / MEMORY)
```

## Rules for the fleet
- **One owner per file area.** Parallel agents work on separate areas. If two tasks need the
  same files, run them one after the other, or give each agent its own worktree
  (`isolation: worktree`).
- **Every implementer verifies its own work**: `npm test`, `npx tsc -b`, and for UI
  `npm run build && npm run smoke`, plus looking at the screenshots.
- **Reviewers and QA don't fix.** They report confirmed findings, and the owning agent fixes them.
- **Agents report, the main session decides.** Agent reports are inputs. The coordinating
  session checks them (e.g. re-runs `npm run verify`) before committing.
- **Nothing leaves the device.** No agent adds network calls, analytics, or real personal data
  to fixtures.
- Only the main session commits and pushes.

## Shared commands

| Command | What it does |
| --- | --- |
| `npm test` | Vitest unit tests (domain logic, parsers) |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run smoke` | Serves `dist/`, drives main flows in Chromium at phone + desktop sizes, screenshots to `smoke-output/`, fails on any page/console error |
| `npm run verify` | Tests, build and smoke, in order |
| `npm run qa` | Exploratory browser flows written by qa-tester (`scripts/qa-flows.mjs`) |

`npm run smoke` needs Playwright with Chromium. It is pre-installed in Claude Code cloud
sessions. Locally, run `npm i -D playwright && npx playwright install chromium`.

## Adding an agent
Create `.claude/agents/<name>.md` with `name`, `description` (say *when* to use it) and
`tools` frontmatter, then a system prompt covering: owned files, invariants, workflow,
verification, and report format. Add it to the roster above.

## Fleet log

**2026-11-13: first run.** code-reviewer audited `src/` and found 12 issues (3 high). qa-tester
ran 7 exploratory flows (`npm run qa`) and found no app bugs. It did find a smoke-script orphan-server
bug and an "arbitrary earliest ancestor" UX nit, and both were fixed. Four fixers then ran in parallel
on separate areas: data-steward (patch-only updates, `ensureRelationship`, cycle rejection, backup
checks), import-specialist (strong/possible dedupe, in-file dedupe), ui-builder (subtype-aware helper
links, one transaction per add) and kinship-engineer (sibling subtypes, foster, step/half labels).
Result: 55 tests passing; smoke and qa pass.
Follow-up review of the fixes: 2 more findings (re-linking reset subtypes → fixed directly; `planImport` O(n²) → import-specialist, 100× faster). Final: 56 tests, smoke + qa pass.
