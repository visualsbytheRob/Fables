# Design System Core

The computational foundation of Fables' visual polish (Epic 21), in
`packages/ui/src/design` and exported as `import { design } from '@fables/ui'`.
Pure, framework-free maths — the CSS/WebGL/React layers render these tokens.

## Colour (`design.*`, F2001)

OKLCH is the source of truth, so palettes are perceptually uniform.

```ts
import { design } from '@fables/ui';

design.oklchToHex({ l: 0.6, c: 0.15, h: 250 }); // → '#....'
design.contrastRatio('#1a1a1a', '#ffffff'); // → ~17
design.contrastLevel(17); // → 'AAA'
design.readableText('#3b82f6'); // → '#ffffff' | '#000000'
design.inGamut({ l: 0.5, c: 0.5, h: 0 }); // → false (clipped)
```

## Theming (F2002–F2004)

One seed colour generates the whole system, with contrast guaranteed:

```ts
const system = design.seedToSystem('#3b82f6');
// system.ramp[0..100]  — a 13-tone perceptual ramp (0 = black, 100 = white)
// system.light / .dark / .dim — role tokens (surface/text/accent/border)

design.auditRoles(system.light); // → contrast checks; .passesAA per pairing
design.accentRamp('#ef4444'); // a per-notebook accent ramp
```

## Typography & rhythm (F2005–F2006)

```ts
design.scaleStep(2); // perfect-fourth step (px)
design.typeScale(-1, 4); // full scale with rem + grid line heights
design.snapToGrid(17); // → 20 (4pt grid)
design.lineHeightFor(16); // grid-aligned line height ≥ 1.2×
```

## Motion (F2009, F2022)

A spring solver and an accessibility-first motion budget:

```ts
design.springKeyframes(0, 100); // pre-baked spring track, ends exactly at 100

design.resolveMotionLevel({ prefersReducedMotion: true }); // → 'none'
design.motionBudget({ ecoMode: true });
// → { level: 'reduced', durationScale: 0.5, shaders: false, parallax: false }
```

`prefers-reduced-motion` always wins; eco mode caps motion at `reduced` and
turns shaders/parallax off — accessibility and battery first.

## Why a pure core

Defining these as maths means the beauty is _trustworthy_: contrast you can
prove is legible, springs you can prove will settle, and a budget that throttles
the GPU when the user or the battery asks. The rendering is the web app's job;
the rules it obeys live here and are unit-tested.
