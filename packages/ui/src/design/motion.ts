/**
 * Spring-physics motion + accessibility policy (Epic 21, F2009, F2022).
 *
 * A deterministic spring solver (the maths behind the unified motion layer) and
 * a motion-policy resolver that bows to `prefers-reduced-motion` and an
 * eco/performance mode — beauty that never costs accessibility or battery. Pure:
 * the CSS/JS animation layer reads these numbers; nothing here touches the DOM.
 */

export interface SpringConfig {
  /** Stiffness (higher = snappier). */
  stiffness?: number;
  /** Damping (higher = less oscillation). */
  damping?: number;
  /** Mass. */
  mass?: number;
}

export interface SpringState {
  value: number;
  velocity: number;
}

const DEFAULTS = { stiffness: 170, damping: 26, mass: 1 };

/**
 * Advance a spring one timestep toward `target` (semi-implicit Euler). Returns
 * the new value + velocity; integrate repeatedly to animate. `dt` in seconds.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  config: SpringConfig = {},
): SpringState {
  const k = config.stiffness ?? DEFAULTS.stiffness;
  const c = config.damping ?? DEFAULTS.damping;
  const m = config.mass ?? DEFAULTS.mass;

  const springForce = -k * (state.value - target);
  const dampingForce = -c * state.velocity;
  const acceleration = (springForce + dampingForce) / m;

  const velocity = state.velocity + acceleration * dt;
  const value = state.value + velocity * dt;
  return { value, velocity };
}

/** A spring is settled when it's near the target and nearly still. */
export function isSettled(
  state: SpringState,
  target: number,
  epsilon = 0.01,
  velocityEpsilon = 0.01,
): boolean {
  return Math.abs(state.value - target) < epsilon && Math.abs(state.velocity) < velocityEpsilon;
}

/**
 * Integrate a spring to rest, returning the value at each frame (capped). Useful
 * for pre-baking a keyframe track or testing the curve.
 */
export function springKeyframes(
  from: number,
  target: number,
  config: SpringConfig = {},
  opts: { fps?: number; maxFrames?: number } = {},
): number[] {
  const fps = opts.fps ?? 60;
  const maxFrames = opts.maxFrames ?? 600;
  const dt = 1 / fps;
  let state: SpringState = { value: from, velocity: 0 };
  const frames: number[] = [state.value];
  for (let i = 0; i < maxFrames; i += 1) {
    state = stepSpring(state, target, dt, config);
    frames.push(state.value);
    if (isSettled(state, target)) break;
  }
  // Snap the final frame exactly to target.
  frames[frames.length - 1] = target;
  return frames;
}

export type MotionLevel = 'full' | 'reduced' | 'none';

export interface MotionInputs {
  /** The user's OS `prefers-reduced-motion` setting. */
  prefersReducedMotion?: boolean;
  /** The app's eco/performance mode (dials motion + shaders down). */
  ecoMode?: boolean;
  /** An explicit user override. */
  override?: MotionLevel;
}

/**
 * Resolve the effective motion level (F2022). `prefers-reduced-motion` always
 * wins unless the user explicitly overrides up; eco mode caps at 'reduced'.
 */
export function resolveMotionLevel(inputs: MotionInputs = {}): MotionLevel {
  if (inputs.override !== undefined) return inputs.override;
  if (inputs.prefersReducedMotion) return 'none';
  if (inputs.ecoMode) return 'reduced';
  return 'full';
}

export interface MotionBudget {
  level: MotionLevel;
  /** Multiplier applied to durations (1 = normal, 0 = instant). */
  durationScale: number;
  /** Whether GPU shader effects should run (F2014–F2018, F2022 eco). */
  shaders: boolean;
  /** Whether parallax / scroll choreography runs. */
  parallax: boolean;
}

/** Translate a motion level into a concrete budget the render layer reads. */
export function motionBudget(inputs: MotionInputs = {}): MotionBudget {
  const level = resolveMotionLevel(inputs);
  switch (level) {
    case 'none':
      return { level, durationScale: 0, shaders: false, parallax: false };
    case 'reduced':
      return { level, durationScale: 0.5, shaders: false, parallax: false };
    case 'full':
      return { level, durationScale: 1, shaders: !inputs.ecoMode, parallax: true };
  }
}
