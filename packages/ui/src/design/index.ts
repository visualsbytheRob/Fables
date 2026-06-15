/**
 * Design-system computational core (Epic 21).
 *
 * The pure, testable foundation under the visual polish: perceptual colour,
 * seed-to-system theming, the editorial type scale + baseline rhythm, and the
 * spring/motion + accessibility policy. The CSS/WebGL/React layers render these
 * tokens; everything here is framework-free maths.
 */

export {
  oklchToHex,
  oklchToRgb,
  rgbToHex,
  hexToRgb,
  inGamut,
  relativeLuminance,
  contrastRatio,
  contrastLevel,
  readableText,
  type Oklch,
  type Rgb,
  type ContrastLevel,
} from './color.js';

export {
  tonalRamp,
  rolesFor,
  auditRoles,
  seedToSystem,
  accentRamp,
  TONES,
  type Tone,
  type TonalRamp,
  type RoleColors,
  type ThemeMode,
  type PaletteCheck,
  type SystemTheme,
} from './palette.js';

export {
  RATIOS,
  scaleStep,
  snapToGrid,
  lineHeightFor,
  typeScale,
  rhythmUnits,
  type RatioName,
  type TypeStep,
  type TypeScaleOptions,
} from './typography.js';

export {
  stepSpring,
  isSettled,
  springKeyframes,
  resolveMotionLevel,
  motionBudget,
  type SpringConfig,
  type SpringState,
  type MotionLevel,
  type MotionInputs,
  type MotionBudget,
} from './motion.js';
