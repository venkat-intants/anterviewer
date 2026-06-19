// useProctoring — client-side proctoring / malpractice detection (Phase B).
//
// Runs entirely in the browser. Two independent signal sources:
//   1. MediaPipe FaceLandmarker on the candidate's own camera frames (~2 fps):
//        - face_absent     (0 faces in view)
//        - multiple_faces  (>1 face)
//        - gaze_away       (head turned away from the screen, debounced)
//      Ranged conditions are debounced (must persist MIN_MS) to cut noise, and
//      emitted as {started_at, ended_at} so the backend can score by duration.
//   2. Browser events (cheap + ~99.9% reliable, no ML):
//        - tab_blur        (candidate switched tab/window)
//        - copy / paste    (clipboard use)
//        - fullscreen_exit (left fullscreen, if it was active)
//
// Events are batched and POSTed to interview_core. The raw camera frames NEVER
// leave the device — only derived events. Detection is best-effort: any failure
// (model load, camera) is swallowed so it can NEVER break the interview.
//
// NOTE: detection runs on the main thread throttled to ~2 fps for simplicity.
// A Web Worker (OffscreenCanvas) is the next optimisation if CPU becomes a
// concern at scale; the event contract would not change.

import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  postIntegrityEvents,
  type IntegrityEventOut,
  type IntegrityEventType,
} from '@/api/integrity';
import {
  advanceCondition,
  closeOpenConditions as closeOpenConditionsPure,
  freshCondStates,
  isLookingAway,
  pickWarning,
  type GazeThresholds,
  type ProctorCondition,
} from '@/features/interview/proctorLogic';

// ── Tunables ─────────────────────────────────────────────────────────────────
const DETECT_INTERVAL_MS = 500; // ~2 fps
const FLUSH_INTERVAL_MS = 5000; // POST batched events every 5s
const MIN_RANGED_MS = 1200; // a ranged condition must persist this long to count

// Primary "facing away" detection: the head's forward unit vector, taken from
// the third column of MediaPipe's facial transformation (rotation) matrix.
//   forwardX → left/right head turn (yaw),  forwardY → up/down tilt (pitch).
// A value of ~0.30 corresponds to roughly a 17° rotation off-centre. This is
// far more robust to head ROTATION than 2D landmark ratios.
// (yaw/pitch ~0.30 ≈ 17° off-centre) primary head-pose; nose-ratio is the
// fallback; eye-gaze blendshape threshold catches eyes-off-screen with a still
// head. All gathered into one GazeThresholds object passed to isLookingAway().
const GAZE_THRESHOLDS: GazeThresholds = {
  poseYaw: 0.32,
  posePitch: 0.34,
  eyeGaze: 0.55,
  horizLow: 0.36,
  horizHigh: 0.64,
  vertLow: 0.28,
  vertHigh: 0.66,
};

// Real-time candidate nudge: how long a condition must persist before we show an
// on-screen "please look back" warning. Longer than the scoring debounce
// (MIN_RANGED_MS) so we flag briefly but only nag the candidate for sustained
// lapses.
const WARN_MS = 5000;

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** A sustained-condition warning surfaced to the candidate in real time. */
export type ProctorWarningType = ProctorCondition;

interface UseProctoringArgs {
  sessionId: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
}

export interface UseProctoringReturn {
  /** True once the face model has loaded and detection is live. */
  ready: boolean;
  /** Latest integrity score (0-100) returned by the backend, or null. */
  score: number | null;
  /**
   * The current sustained issue the candidate should be nudged about (active
   * for ≥ WARN_MS), or null. Drives the on-screen "please look back" banner.
   */
  activeWarning: ProctorWarningType | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function useProctoring({
  sessionId,
  videoRef,
  enabled,
}: UseProctoringArgs): UseProctoringReturn {
  const [ready, setReady] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [activeWarning, setActiveWarning] = useState<ProctorWarningType | null>(null);

  // Mutable state kept in refs so the detection loop / listeners are stable.
  const queueRef = useRef<IntegrityEventOut[]>([]);
  const condRef = useRef(freshCondStates());
  // Current warning type, mirrored in a ref so the 2 fps loop only calls
  // setActiveWarning when it actually CHANGES (avoids a re-render every tick).
  const warnRef = useRef<ProctorWarningType | null>(null);

  // Push an instantaneous event.
  const pushInstant = (type: IntegrityEventType) => {
    queueRef.current.push({ type, started_at: nowIso() });
  };

  // Drive a ranged condition's debounced state machine for this tick (pure
  // logic in proctorLogic.advanceCondition — see its unit tests).
  const updateCondition = (name: ProctorCondition, isTrue: boolean, t: number) => {
    const { next, emit } = advanceCondition(name, condRef.current[name], isTrue, t, MIN_RANGED_MS);
    condRef.current[name] = next;
    if (emit) queueRef.current.push(emit);
  };

  // Close any still-open ranged conditions (called on stop).
  const closeOpenConditions = () => {
    const events = closeOpenConditionsPure(condRef.current, Date.now());
    if (events.length) queueRef.current.push(...events);
    condRef.current = freshCondStates();
  };

  const flush = async () => {
    if (queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0, queueRef.current.length);
    const res = await postIntegrityEvents(sessionId, batch);
    if (res && typeof res.integrity_score === 'number') {
      setScore(res.integrity_score);
    }
  };

  // Decide whether to nudge the candidate (highest-priority condition sustained
  // ≥ WARN_MS). Updates React state only on change to avoid a re-render/tick.
  const evaluateWarnings = (t: number) => {
    const next = pickWarning(condRef.current, t, WARN_MS);
    if (next !== warnRef.current) {
      warnRef.current = next;
      setActiveWarning(next);
    }
  };

  const clearWarning = () => {
    warnRef.current = null;
    setActiveWarning(null);
  };

  // ── Browser-event listeners (independent of the camera) ─────────────────────
  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.hidden) pushInstant('tab_blur');
    };
    const onCopy = () => pushInstant('copy');
    const onPaste = () => pushInstant('paste');
    const onFullscreen = () => {
      if (!document.fullscreenElement) pushInstant('fullscreen_exit');
    };

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Heartbeat + periodic flush ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    // Immediate "proctoring is active" heartbeat (empty batch). This marks the
    // session as proctored (score 100, no flags) the moment monitoring starts —
    // so a clean interview shows a real score instead of "not enabled", and the
    // session is marked even if the camera/model never initialises.
    void postIntegrityEvents(sessionId, []).then((res) => {
      if (res && typeof res.integrity_score === 'number') setScore(res.integrity_score);
    });

    const id = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      // Final flush on teardown: close open conditions then send whatever's left.
      closeOpenConditions();
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  // ── MediaPipe face/gaze detection loop ──────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let landmarker: FaceLandmarker | null = null;
    let intervalId: number | undefined;

    const start = async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: 'VIDEO',
          numFaces: 2,
          // Real 3D head orientation — used to detect head ROTATION reliably.
          outputFacialTransformationMatrixes: true,
          // Iris/eye blendshapes — used for true EYE-GAZE direction.
          outputFaceBlendshapes: true,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        setReady(true);

        intervalId = window.setInterval(() => {
          const video = videoRef.current;
          if (!landmarker || !video || video.readyState < 2 || video.videoWidth === 0) {
            return;
          }
          // Two DIFFERENT clocks, deliberately:
          //  - tMono  (performance.now): monotonic ms-since-load, REQUIRED by
          //    MediaPipe's detectForVideo timestamp.
          //  - t      (Date.now): wall-clock epoch ms, used for condition timing
          //    AND for building the event ISO timestamps. Using tMono there
          //    would seed start times at ~1970 and make durations decades long.
          const tMono = performance.now();
          const t = Date.now();
          let result;
          try {
            result = landmarker.detectForVideo(video, tMono);
          } catch {
            return; // transient decode error — skip this frame
          }
          const faces = result.faceLandmarks ?? [];
          const n = faces.length;

          updateCondition('face_absent', n === 0, t);
          updateCondition('multiple_faces', n > 1, t);

          // "Looking away" — evaluable with exactly one face. Gather the raw
          // signals from this frame, then let proctorLogic.isLookingAway decide
          // (head pose primary, nose-ratio fallback, eye-gaze OR-combined).
          let gazeAway = false;
          if (n === 1) {
            // Head pose: 3rd column (indices 8,9) of the column-major rotation
            // matrix is the head's forward axis. Large |x|/|y| ⇒ turned away.
            const matrix = result.facialTransformationMatrixes?.[0]?.data;
            const hasMatrix = !!matrix && matrix.length >= 11;
            const fwdX = hasMatrix ? matrix[8] : null;
            const fwdY = hasMatrix ? matrix[9] : null;

            // Nose-ratio fallback (only used when the matrix is unavailable).
            let horiz: number | null = null;
            let vert: number | null = null;
            if (!hasMatrix) {
              const lm = faces[0];
              const leftX = lm[234]?.x ?? 0;
              const rightX = lm[454]?.x ?? 1;
              const noseX = lm[1]?.x ?? 0.5;
              const topY = lm[10]?.y ?? 0;
              const chinY = lm[152]?.y ?? 1;
              const noseY = lm[1]?.y ?? 0.5;
              horiz = rightX !== leftX ? (noseX - leftX) / (rightX - leftX) : 0.5;
              vert = chinY !== topY ? (noseY - topY) / (chinY - topY) : 0.45;
            }

            // True eye-gaze from iris blendshapes (per-direction, two eyes avgd).
            let eyeMax: number | null = null;
            const shapes = result.faceBlendshapes?.[0]?.categories;
            if (shapes) {
              const bs = (name: string): number =>
                shapes.find((c) => c.categoryName === name)?.score ?? 0;
              const lookLeft = (bs('eyeLookOutLeft') + bs('eyeLookInRight')) / 2;
              const lookRight = (bs('eyeLookOutRight') + bs('eyeLookInLeft')) / 2;
              const lookUp = (bs('eyeLookUpLeft') + bs('eyeLookUpRight')) / 2;
              const lookDown = (bs('eyeLookDownLeft') + bs('eyeLookDownRight')) / 2;
              eyeMax = Math.max(lookLeft, lookRight, lookUp, lookDown);
            }

            gazeAway = isLookingAway({ fwdX, fwdY, eyeMax, horiz, vert }, GAZE_THRESHOLDS);
          }
          updateCondition('gaze_away', gazeAway, t);

          // Real-time candidate nudge for sustained (≥5s) lapses.
          evaluateWarnings(t);
        }, DETECT_INTERVAL_MS);
      } catch {
        // Model failed to load (offline, CDN blocked) — proctoring degrades to
        // browser-event signals only. Never throw into the interview.
        setReady(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      if (landmarker) {
        try {
          landmarker.close();
        } catch {
          /* ignore */
        }
      }
      setReady(false);
      clearWarning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  return { ready, score, activeWarning };
}
