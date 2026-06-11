# Fables — Session Protocol

This repo is built in daily Claude Code sessions against a 2,000-feature plan (two tiers in FEATURES.md).

## On session start

1. Read `FEATURES.md` → **Execution Protocol** section, then find the first unchecked `- [ ]` feature. Work resumes there. Do not re-plan or re-architect; the plan is the plan.
2. Run `pnpm install && pnpm test` (once the workspace exists) to confirm a green baseline before writing code.

## While working

- Target throughput: ~200–300 features per session/day. Use **parallel agent teams**:
  split the day's groups across 2–3 subagents working on disjoint packages/directories
  (e.g. one on `packages/forge-*`, one on `apps/server`, one on `apps/web`), then merge,
  run the full suite, check boxes, and commit. Never give two agents the same files.
- Features are implemented in order within each agent's assigned lane.
- After Tier 1 (F1000), continue straight into Tier 2 epics (F1001–F2000) in order.
- One group of 10 features = one commit: `feat(day-N): FXXX–FYYY <group name>`.
- Check boxes in `FEATURES.md` in the same commit as the implementation.
- Push directly to `main` every 2–3 commits (explicit standing instruction from the user, 2026-06-11).
- Keep `pnpm test`, `pnpm typecheck`, and `pnpm build` green at every commit.

## On session end (or when stopping early)

1. Update the **Status** line in `FEATURES.md` (last completed, next up).
2. Write/update `docs/devlog/day-NN.md`: what shipped, decisions made, anything deferred.
3. Final push. Never leave unpushed work — the container is ephemeral.

## Keeping the user informed

- The devlog + FEATURES.md status line are the canonical progress record.
- Send a push notification (PushNotification tool) at session milestones: session start summary, every ~25 features, and a session-end report with the feature count and what to say to resume tomorrow.

## Architecture (do not drift from this)

- pnpm monorepo: `apps/server` (Fastify + better-sqlite3), `apps/web` (Vite + React PWA),
  `packages/core`, `packages/forge-dsl`, `packages/forge-vm`, `packages/sync`, `packages/ui`.
- TypeScript strict everywhere. Vitest for tests. No secrets in repo. Data lives in `~/.fables`.
- Deployment target: user's local machine, served over Tailscale (`tailscale serve`), used as an iPhone PWA.
