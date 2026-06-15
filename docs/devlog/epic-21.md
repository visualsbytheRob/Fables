# Epic 21 — New Millennium Polish (F2001–F2022)

The encore: 22 features where beauty is the feature. The brief is Apple-grade
restraint and Pentagram-grade craft — perceptual colour, editorial type, motion
with physics, and tasteful GPU work — all degrading gracefully and bowing to
`prefers-reduced-motion` and an eco/performance mode.

Most of Epic 21 is, by its nature, rendering: CSS, the View Transitions API,
WebGL/GLSL shaders, variable-font animation. That work lives in the web app. But
underneath the polish sits a **computational design-system core** that is pure,
deterministic and testable — and that's what shipped server-side this session.

## What shipped: the design-system core (`packages/ui/src/design`)

- **OKLCH colour core (F2001)** — `color.ts`. OKLCH → sRGB via the OKLab
  matrices, WCAG relative luminance + contrast ratio, gamut detection, and a
  readable-text picker. Contrast is correct by construction, not by eyeball.
- **Seed-to-system theming (F2002)** — `palette.ts`. One seed colour generates a
  13-tone perceptual ramp (triangular chroma taper so the extremes are true
  black/white), role tokens (surface/text/accent/border), and an `auditRoles`
  pass that proves the text pairings clear WCAG AA. The light/dark/dim triad
  (F2003) and per-notebook accent (F2004) reuse the same generator.
- **Editorial type scale + rhythm (F2005–F2006)** — `typography.ts`. A
  perfect-fourth modular scale with rem + grid-aligned line heights, and a
  baseline-grid engine that snaps every measurement to a 4/8pt grid.
- **Spring physics + motion policy (F2009, F2022)** — `motion.ts`. A
  semi-implicit-Euler spring solver (`stepSpring`, `springKeyframes`,
  `isSettled`) and a `motionBudget` resolver where `prefers-reduced-motion`
  always wins and eco mode dials shaders, parallax and durations down.

17 tests cover the lot; typecheck + lint clean.

## Triaged (with reasons)

The rendering surfaces are marked `[~]` in FEATURES.md, each pointing at the core
that drives it: flash-free theme cross-fade (CSS), accent rippling (CSS),
variable-font animation (font-variation-settings + the spring layer), fine
typesetting (`text-wrap`/hanging punctuation), view transitions (browser API),
staggered reveals / scroll choreography / micro-interactions (DOM over the spring
tokens), the WebGL/GLSL showpieces (GPU, gated by `motionBudget.shaders`), the
icon-morph system, elevation/shadows/film-grain, and skeletons. Every one has its
computational seam shipped: the colours it uses, the springs it animates with,
and the accessibility/eco budget that throttles it.

## Closing thought

Epic 21 is where the system stops being only correct and starts being
_considered_. The honest server-side contribution is the maths that makes the
beauty trustworthy — colour you can prove is legible, motion you can prove will
settle, and a budget that puts accessibility and battery first. The pixels are
the web app's to paint; the rules they obey are here, and tested.
