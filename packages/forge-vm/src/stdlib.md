# Forge stdlib reference

<!-- Generated from the registry in `stdlib.ts` (`generateStdlibDoc()`). Do not edit by hand. -->

All randomness is drawn from the seeded story PRNG: identical seeds and
choices replay identically. Functions never throw — invalid arguments
produce story-visible error values.

## Math

| Function | Description |
| --- | --- |
| `FLOOR(x)` | Largest integer ≤ x. |
| `CEILING(x)` | Smallest integer ≥ x. |
| `ABS(x)` | Absolute value of x. |
| `MIN(a, b)` | Smaller of a and b. |
| `MAX(a, b)` | Larger of a and b. |
| `CLAMP(x, lo, hi)` | x clamped into the range [lo, hi]. |

## Randomness & dice

| Function | Description |
| --- | --- |
| `RANDOM(min, max)` | Uniform random integer in [min, max], inclusive, from the seeded story PRNG. |
| `DICE(count, sides[, modifier])` | Roll `count` dice with `sides` faces and sum them, plus an optional modifier. |
| `ROLL("NdS+M")` | Roll a dice expression string such as `"d20"`, `"3d6"`, or `"3d6+2"`. |

## Strings

| Function | Description |
| --- | --- |
| `UPPER(s)` | Uppercase a string. |
| `LOWER(s)` | Lowercase a string. |
| `CONTAINS(s, sub)` | True when string s contains substring sub. |
| `LENGTH(s)` | Length of a string (or element count of a list). |

## Lists

| Function | Description |
| --- | --- |
| `COUNT(list)` | Number of elements in a list. |
| `LIST_MIN(list)` | Smallest numeric element of a list (errors on empty/non-numeric lists). |
| `LIST_MAX(list)` | Largest numeric element of a list (errors on empty/non-numeric lists). |
| `RANDOM_FROM(list)` | A uniformly random element of the list, drawn from the story PRNG. |
| `INTERSECTION(a, b)` | Elements present in both lists, in the order of the first. |

## Story state

| Function | Description |
| --- | --- |
| `TURNS()` | Number of choices taken so far this playthrough. |
| `VISITED("knot")` | Visit count of a knot, stitch, or label by name (0 when never visited). |
| `TARGET("knot.stitch")` | A divert-target value for the named knot/stitch/label; store it in a variable and `-> that_variable` later. |

## Effects (host-dispatched)

Effects are opaque commands interpreted by the host player. They are
sandboxed (only the registry below plus host-registered external
functions are reachable), audited per playthrough, and a failing effect
yields an error value instead of crashing the story.

| Effect | Description |
| --- | --- |
| `PLAY_AUDIO("track")` | Ask the host player to play an audio cue. |
| `SET_THEME("theme")` | Ask the host player to switch its visual theme. |
| `VIBRATE([ms])` | Ask the host device to vibrate (mobile haptics). |
| `PAUSE(ms)` | Ask the host player to pause dramatically before continuing. |
| `JOURNAL("entry text") / @journal(entry text)` | Write a journal/note entry into the knowledge base from story flow. |
| `ENTITY_SET("entity", "field", value)` | Mutate a knowledge-base entity field (e.g. hero health) via the host. |
