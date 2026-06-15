# Spaced Repetition & Learning with Fables

## Overview

Spaced repetition is a memory technique backed by neuroscience: reviewing information right before you forget it builds lasting, retrievable knowledge far faster than cramming or random studying. Fables uses **FSRS-5** (Free Spaced Repetition Scheduler, version 5), a sophisticated algorithm that learns how difficult each card is for _you_ and schedules reviews at the exact moment your memory is predicted to fade to 90% retention. Your notes become durable memory, and all data lives locally on your device—no cloud, no vendor lock-in.

The FSRS-5 model tracks two hidden variables for each card: **stability** (how many days your memory stays strong) and **difficulty** (how hard the card is to stabilize). After every review, your rating—Again, Hard, Good, or Easy—updates these variables and reschedules the card to the moment when you're most likely to recall it. This replaces arbitrary intervals with a personalized, evidence-based schedule tuned to _your_ learning patterns.

## Making Cards

### Quick Syntax

Write cards directly in your notes using two formats:

**Cloze deletion** (fill-in-the-blank):

```
The capital of France is {{c1::Paris}}.
Multiple clozes in one sentence: {{c1::Mitochondria}} is the {{c2::powerhouse}} of the cell.
```

**Question-and-answer blocks**:

```
Q: What is the derivative of x²?
A: 2x

Q: Name the five Great Lakes.
A: Superior, Michigan, Huron, Erie, Ontario
```

Cards can be up to 10,000 characters; the system extracts both prompt and answer automatically.

### Auto-Generation & Sync

The `/cards/extract` endpoint previews what cards a piece of text will yield _without_ saving them. Use this to refine your phrasing before committing. When you're ready, sync a note to its auto-cards with `/notes/:id/cards/sync`: the system extracts all `{{c*::…}}` clozes and `Q:`/`A:` blocks, creates new cards, and removes cards for blocks you've deleted. Suspended and buried cards are never touched.

### Card States

Each card lives in one of six states:

- **new** — never reviewed yet; capped by your daily intake limit
- **learning** — reviewed within the last day (spacing isn't tight yet)
- **review** — reviewed at least once; on the long-term schedule
- **relearning** — lapsed (you rated _Again_) and being retaught
- **suspended** — explicitly paused; never appears in review
- **buried** — hidden until tomorrow (useful for duplicates or sibling pairs)

## Reviewing

### The Review Queue

The `/review/queue` endpoint gives you the day's due cards, respecting your daily caps. New cards are limited by `dailyNewCap` (default 20/day); review cards by `dailyReviewCap` (default 200/day). The queue is ordered by due date and respects your priority overrides: cards you've marked as important surface first. Suspend cards you don't want to see; bury siblings to space them out.

### Four Ratings

When reviewing a card, you choose one:

- **Again (1)** — you forgot it. The interval resets to 1 day (relearning). Stability is penalized; difficulty increases.
- **Hard (2)** — you got it but it was difficult. Interval grows slowly; difficulty stays similar.
- **Good (3)** — you got it and it felt about right. Interval grows at normal pace.
- **Easy (4)** — you got it instantly. Interval grows fast; difficulty decreases (you're overestimating the challenge).

The `/cards/:id/review` endpoint accepts your rating and reschedules the card using FSRS-5. Pass `requestRetention` (0.7–0.99, default 0.9) to override the global target—lower retention for cards you want to see more often, higher for less frequent but longer intervals.

### Undo, Suspend, Bury

Made a mistake? `/cards/:id/undo` reverts your last rating and restores the card's prior state. You can undo multiple times back through your entire review history.

Suspend cards with `/cards/:id/suspend` to pause them indefinitely; they won't appear in review. Unsuspend at any time to return them to the normal queue.

Bury cards with `/cards/:id/bury` to hide them until tomorrow—perfect for closely related cards (like two translations of the same phrase) where seeing both in one session ruins the challenge.

## Decks

Decks are saved filters with per-deck settings. Create a deck with a name and optional filter (by state, kind, tag, notebook, due date, or full-text query). The `/decks/:id/cards` endpoint shows dynamic membership: every time you query it, cards matching the filter are included, so adding new cards auto-enlists them.

### Dashboard & Forecast

The `/decks/:id/dashboard` endpoint shows how many cards are due today and forecasts the next 90 days: a bar chart of predicted daily workload. Use this to spot learning cliffs and adjust your daily cap or intake pace.

### Shared Decks

Export a deck with `/decks/:id/export` to get a `.fdeck` snapshot—a JSON bundle of the filter and cards. Share it; others import via `/decks/import` and get the cards plus the saved filter for future syncing.

### Custom Study

Ad-hoc filtered study with `/study`: pass a filter (state, kind, tag, notebook, query, etc.) and get a session of matching cards without saving a deck.

## Story-Driven Learning

Fables can turn your due cards into a narrative. The `/review/story` endpoint takes your current queue and generates a "review fable"—a story written in the Fable Forge language that weaves your cards into dialogue, challenges, or narrative branches. When you play the story, you rate cards as usual; Fables reschedules them via the normal FSRS-5 pipeline. This gamifies review without breaking spaced repetition.

Use `/review/mastery` to set a gate: "Are these 10 cards mastered?" The endpoint checks if all selected cards have predicted retrievability ≥ your threshold (default 90%) _right now_, without scheduling them. Useful for quizzes and skill checks.

Sync cards from a story's source text with `/stories/:id/cards/sync`—extract cards from the story itself to practice concepts it covers.

## Insights

All of these are local analytics computed on your device:

- **Retention** (`/learning/insights/retention`) — true retention: what % of your reviews succeeded? (Accounts for again rates across all cards.)
- **Heatmap** (`/learning/insights/heatmap`) — reviews per day over time; spot your peak productivity hours.
- **Forecast** (`/learning/insights/forecast`) — predicted daily review load for the next N days.
- **Difficulty distribution** (`/learning/insights/difficulty`) — histogram of card difficulties (1–10); identify unusually hard material.
- **Leeches** (`/learning/insights/leeches`) — cards you've lapsed ≥3 times; consider rewriting them or burying them.
- **Coverage** (`/learning/insights/coverage`) — knowledge map: how much of your material is new, learning, review, or suspended?
- **Streak** (`/learning/insights/streak`) — current review streak (days without missing a due card).
- **Export** (`/learning/insights/export`) — all insights bundled for offline analysis.

## Habits & Settings

### Global Settings

Access `/learning/settings` to configure:

- **Vacation mode** — set `vacationUntil` to a future date to pause all reviews until then.
- **Daily caps** — `dailyNewCap` (new cards per day) and `dailyReviewCap` (reviews per day) prevent burnout.
- **Max interval** — `maxIntervalDays` caps the longest an interval can grow (default: 36,500 days ≈ 100 years).
- **Target retention** — `requestRetention` (default 0.9 = 90%); lower for lighter learning, higher for denser material.
- **Relearning steps** — `relearningSteps` (in minutes, e.g. [10, 1440]): when you lapse, you see the card again after 10 minutes, then 1 day.
- **Priority overrides** — `priorityOverrides` (a map of card IDs to priority values); higher priorities surface first in a session.
- **Quiet hours** — `quietStart` and `quietEnd` (UTC hours, e.g. 22–7) silence reminders and skip generation during sleep hours.

### Best Review Time

Call `/learning/habits/best-time` to find the hour you review most consistently—your peak productivity time. Use this to set reminders.

### Reminders

The `/learning/habits/reminder` endpoint returns a reminder string (e.g. "10 cards due today!") and your streak count. It respects quiet hours and vacation mode: if either is active, no reminder fires. Use this to power local notifications on your phone.

### Weekly Digest

Post to `/learning/habits/digest` to generate a weekly learning summary: reviews completed, retention %, current streak, new cards added, and forecast for tomorrow. Optionally save the digest as a note in your notebook. Useful for reflection and motivation.

## Coming from Anki

Fables understands Anki's `.apkg` format. Import with `/import/anki` (pass base64-encoded .apkg bytes): cards are imported and their SM-2 scheduling is translated to FSRS-5. Your existing review history and interval structure are preserved as best as possible.

Export back to Anki with `/export/anki`: filter by card kind, state, or quantity, and get a base64 .apkg file. You can migrate to Fables without burning your cards.

## A Quick Start

1. **Write a note** with a couple of Q&A blocks or cloze deletions:

   ```
   Q: What is photosynthesis?
   A: The process by which plants convert light into chemical energy.

   Q: What are the two stages of photosynthesis?
   A: Light-dependent reactions (thylakoid) and light-independent reactions (stroma).
   ```

2. **Sync the note** to cards: POST to `/notes/:id/cards/sync`. The system extracts both cards and marks them as new.

3. **Review** the next day: GET `/review/queue` to fetch your due cards. For each card, POST a rating (1–4) to `/cards/:id/review`. FSRS-5 reschedules based on your response.

4. **Check retention** with `/learning/insights/retention` and your **streak** with `/learning/insights/streak`. Watch the forecast with `/decks/:id/dashboard` if you've set up a deck.

5. **Adjust settings** if needed: increase `dailyNewCap` to study faster, or set quiet hours to protect your mornings.

The system does the rest. Your cards will naturally climb from new → learning → review, with intervals growing months or years long. If you lapse, they drop back to relearning for a day or two, then climb again. It's personalized, local, and owned by you.
