# Working on Lineage

This project is tracked through four files — keep them current:

1. **PLAN.md** — roadmap and backlog. Tick items as they ship; add new ideas to the backlog.
2. **STATE.md** — what is done and *how it was verified*. Update at the end of every session.
3. **MEMORY.md** — decisions, conventions and gotchas. Read before coding; append what you learn.
4. **README.md** — user-facing overview and how to run.

Workflow per session: read STATE.md + MEMORY.md → pick the next item from PLAN.md →
implement → `npm test` and `npm run build` → check the UI in a browser (phone and desktop widths)
→ update STATE/PLAN/MEMORY → commit.
