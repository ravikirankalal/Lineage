# Working on Lineage

## Tracking files (keep them current)
1. **PLAN.md**: roadmap and backlog. Tick items as they ship. Add new ideas to the backlog.
2. **STATE.md**: what is done and *how it was verified*. Update at the end of every session.
3. **MEMORY.md**: decisions, conventions and gotchas. Read before coding. Append what you learn.
4. **README.md**: user-facing overview and how to run.
5. **AGENTS.md**: the subagent fleet: who owns what, routing, and fleet rules.

## Use the fleet
Delegate to the subagents in `.claude/agents/` (see AGENTS.md):
- Route implementation to the owning agent (`kinship-engineer`, `ui-builder`,
  `import-specialist`, `data-steward`). Run independent tasks in parallel when they touch
  different file areas.
- After non-trivial changes, run `code-reviewer` and `qa-tester` in parallel.
- Finish with `docs-keeper`.
- Do small one-file fixes directly. Spawning an agent for a trivial edit costs more than it saves.

## Session workflow
Read STATE.md + MEMORY.md → pick the next PLAN.md item → delegate or implement →
`npm run verify` (tests, build, browser smoke) → update docs → commit.
