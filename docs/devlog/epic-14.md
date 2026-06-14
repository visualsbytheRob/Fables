# Epic 14 — AI Co-Writer & Modality Mesh (text capability)

Status as of 2026-06-14: **F1301–F1400 shipped** (RAG, note intelligence, note
transforms, story co-writer, character & dialogue AI, Claude cloud adapter, AI
command surface, evaluation & guardrails, settings & trust). UI panels, eval
datasets, and demo-vault e2e deferred-with-reason (see below). Next: Epic 15
(Importers & Interop, F1401+).

## What shipped

All AI features are built on the **task router** (`runTextTask` /
`runStructuredTask`) over the pluggable **AIRuntime**, which routes to the first
available backend and degrades to `{ available: false }` when none is present
(F1309) — AI is always optional in Fables. Prompts live in a versioned, reviewable
template library (`ai/templates.ts`).

### Vault Q&A — RAG (F1321–F1330)

- `ai/rag.ts`: `ragAnswer` retrieves top-k via the Tier-1 hybrid/semantic search,
  grounds the answer in **full note bodies** (not just snippets), and cites
  sources by `[n]` markers (F1321/F1322). Confidence is a retrieval-coverage
  heuristic (F1325). The **no-good-sources path refuses without calling the
  model** (F1326) — an honest "I don't have that" over a hallucination.
- Conversation memory (F1324), opt-in Q&A-history notes filed under a "Q&A
  History" notebook (F1327), follow-up suggestions (F1328).
- Route: `POST /ai/ask`, `POST /ai/follow-ups`.
- Deferred: F1323 retrieval-tuning **UI** (server scope params shipped), F1329
  eval set (needs a demo-vault fixture + the F1381 harness).

### Note Intelligence (F1331–F1340)

- Summarize / auto-tag / title (F1331–F1333), plus transforms in
  `ai/note-transform.ts`: rewrite (tighten/expand/tone, F1336), outline (F1335),
  meeting structurer → actions+decisions (F1337), weekly review from a journal
  notebook (F1338), and **anti-hallucination link suggestions** that only resolve
  to real candidate notes (F1334).
- F1339 (undoable + attributed) is **structural**: every assist is advisory and
  returns suggestions; applying one is a normal, undoable note edit.

### Story Co-Writer (F1341–F1350)

- `ai/story-cowriter.ts`: beats (F1341), choices (F1342), scene draft (F1343),
  style capture → reusable tone+traits (F1344), consistency check vs supplied
  facts (F1345), branch gap analysis (F1346). Provenance markers wrap AI-drafted
  source so it's visible in the editor (F1348). Routes under `/ai/story/*`.
- Deferred: F1347 co-writer **panel UI** (endpoints shipped).

### Character & Dialogue (F1351–F1360)

- `ai/character-ai.ts`: entity-grounded dialogue (F1351), voice cards (F1352),
  dialogue polish (F1353), in-voice NPC interview with history (F1354), transcript
  → fact extraction (F1355), relationship dynamics (F1356), world-consistent name
  generation (F1357), arc tracker across branches (F1358). Routes under
  `/ai/character/*`.

### Cloud LLM Adapter — Claude (F1361–F1370)

- `ai/claude.ts`: `ClaudeAdapter` implements the same `LanguageModelAdapter`
  contract (F1361). **Opt-in**: unavailable until an API key is configured (F1362).
  One-shot + SSE streaming, retry/backoff on 429/5xx with Retry-After awareness
  (F1366). HTTP client + sleep are injectable → tests hit every path with **zero
  real network calls** (F1370).
- `ai/cloud-policy.ts`: the privacy chokepoint. Key masking + format validation
  (F1362), per-feature routing (creative tasks → cloud when enabled, F1363),
  **egress consent gate** `canSendToCloud` (F1364), per-notebook exclusions
  (F1365), and cache-friendly request shaping (F1368).
- `AIRuntime.generatePreferring(name, req)` implements per-feature routing with a
  safe fallback to first-available.
- `ai/usage-meter.ts` + migration `024-ai-usage`: local, per-feature, per-backend
  monthly token meter (F1367). Routes: `GET /ai/usage`, `GET /ai/cloud/status`.
- Deferred: F1369 side-by-side eval (depends on the F1381 eval-harness CLI);
  F1364's consent **dialog/indicator** are the web layer (the gate itself ships).

### AI Command Surface (F1371–F1380)

- `ai/actions.ts` + migration `025-ai-actions`: user-defined actions (saved
  prompt + scope, template validated at save time so a bad `{{slot}}` is rejected
  early), multi-step workflows over a note (summarize→tag→title…), the bulk abuse
  guard (`assertBulkConfirmed`, F1379), and local action usage metering (F1378).
  Routes under `/ai/actions` + `/ai/workflows/run`.
- Deferred: F1371–F1375 (palette/inline/slash/shortcuts/streaming preview) are the
  **web UI**; server enablers (custom-action run, `generateStream`) shipped.

### Evaluation & Guardrails (F1381–F1390)

- `ai/guardrails.ts`: citation tripwire (F1383, **wired live into `ragAnswer`** as
  `citationsValid`), per-task latency budgets + graceful `withTimeout` (F1384),
  output scope filter (F1385), failure taxonomy + friendly language (F1388).
- `ai/eval.ts`: harness engine — `runEvalSet`, model-comparison report (F1387),
  run-record serializer (F1389). Quality gate (F1382) and the **zero-egress
  privacy assertion** (F1386) are covered by tests.
- Deferred: F1381 CLI wrapper + F1329/F1369/F1389 labeled datasets/longitudinal
  data (need a demo-vault fixture + real local models).

### AI Settings & Trust (F1391–F1400)

- `ai/settings.ts` + migration `026-ai-settings`: a one-row JSON settings doc with
  per-feature toggles (F1391), the **global kill switch** (F1392) — mirrored onto
  `AIRuntime` so flipping it makes every feature unavailable, and persisted so it
  survives restarts — per-notebook AI exclusions (F1394), and the data-use
  explainer (F1393). Routes: `GET`/`PUT /ai/settings`.
- **Secret-content wall (F1395):** `isAiVisible`/`filterAiVisible` exclude any
  field still in at-rest `enc:v1:` form; wired into RAG retrieval so a locked/
  encrypted note can never reach a prompt or be cited — tested end-to-end.
- `docs/ai.md` (F1398): user-facing AI documentation.
- Deferred: F1391/F1396/F1397 UI (settings page, onboarding, local-only badge),
  F1399 full e2e on a demo vault.

## Conventions held

- Every AI module: graceful `{ available: false }`, structured tasks re-ask once
  on schema failure, grounding instructions ("never invent facts").
- Each group ≈ one commit; `pnpm test` / `typecheck` / `lint` green at every
  commit; pushed to `main` continuously.

## Retrospective (F1400)

**What went well.** The Tier-1 task-router + template-library foundation paid off:
every one of ~70 features this epic is the same small shape — render a versioned
template, route by speed class, re-ask once on schema failure, return a graceful
`{ available: false }` union. That uniformity made features fast to build and
trivial to test with a mock adapter (zero real model calls in CI). Grounding
discipline (anti-hallucination link/citation checks, the secret-content wall) is
baked into prompts _and_ enforced in code. The Claude adapter slotting behind the
exact same interface as Ollama — with injectable fetch/sleep — got full
retry/stream coverage without a single network call.

**Decisions.** Kept AI strictly advisory (suggestions, never auto-edits) so the
undo/attribution guarantee is structural. Made the kill switch a runtime-level
short-circuit so no feature can bypass it. Filtered encrypted content at retrieval
time rather than trusting callers.

**Deferred, honestly.** Everything web-facing (settings page, co-writer/RAG panels,
inline menus, onboarding, badges) is queued for a dedicated web-UI pass — the
server endpoints + policy all ship and are tested. The eval _datasets_ and
demo-vault e2e need a seeded demo vault + real local models; the harness engine to
run them is done. The Epic 13 **vault keystone** (threading the field codec through
the notes service incl. revisions) remains the one blocker for per-note secrets —
queued for its own focused session.

## Test counts

~2,509 tests green across 211 files at the F1400 checkpoint (was ~2,464 at F1370;
~1,196 features at session start).
