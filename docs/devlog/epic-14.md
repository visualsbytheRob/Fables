# Epic 14 — AI Co-Writer & Modality Mesh (text capability)

Status as of 2026-06-14: **F1301–F1370 shipped** (RAG, note intelligence, note
transforms, story co-writer, character & dialogue AI, Claude cloud adapter).
Continuing into F1371+ (AI command surface).

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

## Conventions held

- Every AI module: graceful `{ available: false }`, structured tasks re-ask once
  on schema failure, grounding instructions ("never invent facts").
- Each group ≈ one commit; `pnpm test` / `typecheck` / `lint` green at every
  commit; pushed to `main` continuously.

## Test counts

~2,464 tests green across 207 files at the F1370 checkpoint.
