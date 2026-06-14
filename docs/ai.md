# AI in Fables

AI in Fables is **local-first, optional, and honest**. Every feature works without
AI; when a model is available it adds assistance, and it always tells you when it
can't help rather than guessing. Nothing about your vault leaves your machine
unless you explicitly turn on a cloud backend and consent to egress.

## Backends

Fables routes every AI feature through one **runtime** that picks the first
available backend:

- **Ollama (local, default)** — talks to a local Ollama server. No data leaves
  your machine. Install a model (e.g. `llama3.1:8b`) and you're set.
- **Claude (cloud, opt-in)** — only becomes available once you add an API key in
  AI settings. Off by default. See "Trust & privacy" below.

If no backend is available, every AI action simply reports "unavailable" and the
UI hides it — Fables never breaks because AI is absent.

## What the features do

| Area                     | Features                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ask your vault (RAG)** | Grounded, cited answers from your notes; honest "no good sources" refusal; conversation memory; optional Q&A-history notes; follow-up suggestions.                                  |
| **Note intelligence**    | Summarize, auto-tag, title; rewrite (tighten/expand/tone); outline messy notes; structure meeting notes into actions+decisions; weekly review from a journal; link suggestions.     |
| **Story co-writer**      | Next-beat suggestions, choice drafting, scene prose from an outline, style capture, consistency checks vs your facts, branch-gap analysis, provenance markers on AI-drafted source. |
| **Character & dialogue** | Entity-grounded dialogue, voice cards, dialogue polish, in-voice NPC interviews, transcript→fact extraction, relationship dynamics, world-consistent names, arc tracking.           |
| **Command surface**      | Custom user-defined actions (prompt + scope), multi-step workflows, a local usage meter, and a bulk-action confirmation guard.                                                      |

Every suggestion is **advisory**: AI never edits your work directly. Applying a
suggestion is a normal, undoable edit you make — so AI contributions are always
attributable to your own action.

## Trust & privacy

- **Kill switch.** One toggle in AI settings turns _all_ AI off, instantly and
  across restarts.
- **Per-feature toggles.** Enable only the areas you want.
- **Per-notebook exclusions.** Mark notebooks as off-limits; their notes never
  feed any AI operation, local or cloud.
- **Secret content is invisible.** Encrypted/vault content is never sent to a
  model — it's filtered out before any prompt is built.
- **Egress consent (cloud).** The cloud backend won't send anything until you've
  explicitly consented. Creative tasks can prefer the cloud when enabled; the
  data-use explainer shows exactly what each feature sees.
- **Local usage meter.** Token usage is tracked on-device, per feature, per
  month — never synced.

## Guardrails

- **Grounding.** RAG answers cite sources by `[n]`; a citation tripwire flags
  answers whose citations don't hold up against the retrieved notes.
- **Graceful degradation.** Under a weak or misbehaving model, structured tasks
  return a clean failure instead of crashing, and the UI shows calm, actionable
  language (see the failure taxonomy).
- **Latency budgets.** Each feature has a budget; slow calls degrade to a
  "still working / try a faster model" path rather than hanging.

## For developers

- Adapters implement `LanguageModelAdapter` (`apps/server/src/ai/adapter.ts`).
- Prompts live in the versioned template library (`apps/server/src/ai/templates.ts`).
- Features call the task router (`runTextTask` / `runStructuredTask`), which picks
  a model by the task's speed class and re-asks once on a schema failure.
- Settings, guardrails, the cloud policy, and the eval harness are independent,
  unit-tested modules under `apps/server/src/ai/`.
