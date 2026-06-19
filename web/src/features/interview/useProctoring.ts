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

// ── Tunables ─────────────────────────────────────────────────────────────────
const DETECT_INTERVAL_MS = 500; // ~2 fps
const FLUSH_INTERVAL_MS = 5000; // POST batched events every 5s
const MIN_RANGED_MS = 1200; // a ranged condition must persist this long to count

// Primary "facing away" detection: the head's forward unit vector, taken from
// the third column of MediaPipe's facial transformation (rotation) matrix.
//   forwardX → left/right head turn (yaw),  forwardY → up/down tilt (pitch).
// A value of ~0.30 corresponds to roughly a 17° rotation off-centre. This is
// far more robust to head ROTATION than 2D landmark ratios.
const POSE_YAW = 0.32;
const POSE_PITCH = 0.34;

// Fallback (used only if the transformation matrix is unavailable): nose
// position ratio within the face box. Looser, less reliable.
const HORIZ_LOW = 0.36;
const HORIZ_HIGH = 0.64;
const VERT_LOW = 0.28;
const VERT_HIGH = 0.66;

// TRUE eye-gaze (iris) detection via FaceLandmarker blendshapes. The eyeLook*
// scores (0-1) quantify how far the eyes are deviated from centre, INDEPENDENT
// of head pose — so eyes pointed off-screen are caught even with a still head.
// Above this threshold the gaze is considered off-screen.
const EYE_GAZE_THRESH = 0.55;

// Real-time candidate nudge: how long a condition must persist before we show an
// on-screen "please look back" warning. Longer than the scoring debounce
// (MIN_RANGED_MS) so we flag briefly but only nag the candidate for sustained
// lapses.
const WARN_MS = 5000;

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

type Condition = 'gaze_away' | 'face_absent' | 'multiple_faces';

/** A sustained-condition warning surfaced to the candidate in real time. */
export type ProctorWarningType = 'face_absent' | 'gaze_away' | 'multiple_faces';

interface CondState {
  since: number | null; // epoch ms the condition first became true (pre-debounce)
  openIso: string | null; // ISO start once it has passed the debounce
}

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
  const condRef = useRef<Record<Condition, CondState>>({
    gaze_away: { since: null, openIso: null },
    face_absent: { since: null, openIso: null },
    multiple_faces: { since: null, openIso: null },
  });
  // Current warning type, mirrored in a ref so the 2 fps loop only calls
  // setActiveWarning when it actually CHANGES (avoids a re-render every tick).
  const warnRef = useRef<ProctorWarningType | null>(null);

  // Push an instantaneous event.
  const pushInstant = (type: IntegrityEventType) => {
    queueRef.current.push({ type, started_at: nowIso() });
  };

  // Drive a ranged condition's debounced state machine for this tick.
  const updateCondition = (name: Condition, isTrue: boolean, t: number) => {
    const st = condRef.current[name];
    if (isTrue) {
      if (st.since === null) st.since = t;
      if (st.openIso === null && t - st.since >= MIN_RANGED_MS) {
        st.openIso = new Date(st.since).toISOString();
      }
    } else {
      if (st.openIso !== null) {
        queueRef.current.push({
          type: name,
          started_at: st.openIso,
          ended_at: nowIso(),
        });
      }
      st.since = null;
      st.openIso = null;
    }
  };

  // Close any still-open ranged conditions (called on stop).
  const closeOpenConditions = () => {
    (Object.keys(condRef.current) as Condition[]).forEach((name) => {
      const st = condRef.current[name];
      if (st.openIso !== null) {
        queueRef.current.push({
          type: name,
          started_at: st.openIso,
          ended_at: nowIso(),
        });
      }
      st.since = null;
      st.openIso = null;
    });
  };

  const flush = async () => {
    if (queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0, queueRef.current.length);
    const res = await postIntegrityEvents(sessionId, batch);
    if (res && typeof res.integrity_score === 'number') {
      setScore(res.integrity_score);
    }
  };

  // Decide whether to nudge the candidate: the highest-priority condition that
  // has been continuously active for ≥ WARN_MS. Updates React state only on
  // change. Priority: face absent > multiple faces > looking away.
  const evaluateWarnings = (t: number) => {
    const cond = condRef.current;
    const sustained = (c: Condition): boolean => {
      const since = cond[c].since;
      return since !== null && t - since >= WARN_MS;
    };

    let next: ProctorWarningType | null = null;
    if (sustained('face_absent')) next = 'face_absent';
    else if (sustained('multiple_faces')) next = 'multiple_faces';
    else if (sustained('gaze_away')) next = 'gaze_away';

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

          // "Looking away" — evaluable with exactly one face.
          let gazeAway = false;
          if (n === 1) {
            // PRIMARY: 3D head pose from the facial transformation matrix.
            // data is a column-major 4x4; the third column (indices 8,9,10) is
            // the head's forward axis in camera space. Large |x|/|y| ⇒ the head
            // is turned/tilted away from the screen (covers head ROTATION, not
            // just eye gaze — handles "looked away" and "looking down at phone").
            const matrix = result.facialTransformationMatrixes?.[0]?.data;
            if (matrix && matrix.length >= 11) {
              const fwdX = matrix[8];
              const fwdY = matrix[9];
              gazeAway = Math.abs(fwdX) > POSE_YAW || Math.abs(fwdY) > POSE_PITCH;
            } else {
              // FALLBACK: 2D nose-position ratio (matrix unavailable).
              const lm = faces[0];
              const leftX = lm[234]?.x ?? 0;
              const rightX = lm[454]?.x ?? 1;
              const noseX = lm[1]?.x ?? 0.5;
              const topY = lm[10]?.y ?? 0;
              const chinY = lm[152]?.y ?? 1;
              const noseY = lm[1]?.y ?? 0.5;
              const horiz = rightX !== leftX ? (noseX - leftX) / (rightX - leftX) : 0.5;
              const vert = chinY !== topY ? (noseY - topY) / (chinY - topY) : 0.45;
              gazeAway =
                horiz < HORIZ_LOW || horiz > HORIZ_HIGH || vert < VERT_LOW || vert > VERT_HIGH;
            }

            // ALSO: true EYE-GAZE from iris blendshapes — catches eyes pointed
            // off-screen even when the head is still/facing forward. eyeLook*
            // scores are 0-1; we combine the two eyes per direction and flag if
            // any direction is strongly deviated.
            const shapes = result.faceBlendshapes?.[0]?.categories;
            if (shapes) {
              const bs = (name: string): number =>
                shapes.find((c) => c.categoryName === name)?.score ?? 0;
              const lookLeft = (bs('eyeLookOutLeft') + bs('eyeLookInRight')) / 2;
              const lookRight = (bs('eyeLookOutRight') + bs('eyeLookInLeft')) / 2;
              const lookUp = (bs('eyeLookUpLeft') + bs('eyeLookUpRight')) / 2;
              const lookDown = (bs('eyeLookDownLeft') + bs('eyeLookDownRight')) / 2;
              const eyesAway =
                Math.max(lookLeft, lookRight, lookUp, lookDown) > EYE_GAZE_THRESH;
              gazeAway = gazeAway || eyesAway;
            }
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
