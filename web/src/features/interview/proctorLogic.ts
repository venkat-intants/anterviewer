// proctorLogic — pure, dependency-free proctoring decision logic.
//
// Extracted from useProctoring so the tricky bits (the debounced ranged-event
// state machine, the warning selection, and the "looking away" decision) can be
// unit-tested without MediaPipe, timers, the DOM, or the camera. The hook is a
// thin shell that feeds real signals into these functions.
//
// All functions are pure: timestamps come in as epoch-ms (number) and ISO
// strings are derived deterministically from them — no Date.now()/random.

export type ProctorCondition = 'gaze_away' | 'face_absent' | 'multiple_faces';

export interface CondState {
  /** epoch ms the condition first became true (pre-debounce), or null. */
  since: number | null;
  /** ISO start once the condition has been true for >= minRangedMs, else null. */
  openIso: string | null;
}

export interface RangedEventOut {
  type: ProctorCondition;
  started_at: string;
  ended_at: string;
}

export function freshCondStates(): Record<ProctorCondition, CondState> {
  return {
    gaze_away: { since: null, openIso: null },
    face_absent: { since: null, openIso: null },
    multiple_faces: { since: null, openIso: null },
  };
}

/**
 * Advance one condition's debounced state machine by a single tick.
 *
 * - While the condition is true, it "opens" once it has persisted for
 *   `minRangedMs` (recording the original start as ISO).
 * - When it flips to false, an open condition emits a ranged event spanning
 *   [openIso, now]; brief blips that never opened emit nothing.
 *
 * Returns the next state and an event to emit (or null). Pure: `nowMs` drives
 * both timing and the derived ISO timestamps.
 */
export function advanceCondition(
  type: ProctorCondition,
  state: CondState,
  isTrue: boolean,
  nowMs: number,
  minRangedMs: number,
): { next: CondState; emit: RangedEventOut | null } {
  if (isTrue) {
    const since = state.since ?? nowMs;
    const openIso =
      state.openIso ?? (nowMs - since >= minRangedMs ? new Date(since).toISOString() : null);
    return { next: { since, openIso }, emit: null };
  }
  let emit: RangedEventOut | null = null;
  if (state.openIso !== null) {
    emit = { type, started_at: state.openIso, ended_at: new Date(nowMs).toISOString() };
  }
  return { next: { since: null, openIso: null }, emit };
}

/** Close any still-open conditions (session teardown). Returns events to emit. */
export function closeOpenConditions(
  states: Record<ProctorCondition, CondState>,
  nowMs: number,
): RangedEventOut[] {
  const out: RangedEventOut[] = [];
  (Object.keys(states) as ProctorCondition[]).forEach((type) => {
    const st = states[type];
    if (st.openIso !== null) {
      out.push({ type, started_at: st.openIso, ended_at: new Date(nowMs).toISOString() });
    }
  });
  return out;
}

/**
 * The highest-priority condition that has been continuously active for
 * >= warnMs (drives the on-screen candidate nudge), or null.
 * Priority: face absent > multiple faces > looking away.
 */
export function pickWarning(
  states: Record<ProctorCondition, CondState>,
  nowMs: number,
  warnMs: number,
): ProctorCondition | null {
  const sustained = (c: ProctorCondition): boolean => {
    const since = states[c].since;
    return since !== null && nowMs - since >= warnMs;
  };
  if (sustained('face_absent')) return 'face_absent';
  if (sustained('multiple_faces')) return 'multiple_faces';
  if (sustained('gaze_away')) return 'gaze_away';
  return null;
}

export interface GazeThresholds {
  poseYaw: number;
  posePitch: number;
  eyeGaze: number;
  horizLow: number;
  horizHigh: number;
  vertLow: number;
  vertHigh: number;
}

export interface GazeSignals {
  /** Head-pose forward vector (rotation matrix 3rd column), or null if absent. */
  fwdX: number | null;
  fwdY: number | null;
  /** Max eye-blendshape deviation across directions (0-1), or null. */
  eyeMax: number | null;
  /** Nose-position ratio fallback (used only when head pose is unavailable). */
  horiz: number | null;
  vert: number | null;
}

/**
 * Decide whether the candidate is "looking away" from one frame's signals.
 * Head pose is primary; nose-ratio is the fallback when the pose matrix is
 * unavailable; eye-gaze (iris blendshapes) is OR-combined so eyes pointed
 * off-screen count even with a still head.
 */
export function isLookingAway(s: GazeSignals, t: GazeThresholds): boolean {
  let away = false;
  if (s.fwdX !== null && s.fwdY !== null) {
    away = Math.abs(s.fwdX) > t.poseYaw || Math.abs(s.fwdY) > t.posePitch;
  } else if (s.horiz !== null && s.vert !== null) {
    away = s.horiz < t.horizLow || s.horiz > t.horizHigh || s.vert < t.vertLow || s.vert > t.vertHigh;
  }
  if (s.eyeMax !== null) away = away || s.eyeMax > t.eyeGaze;
  return away;
}
