// InterviewIntro — full-screen intro video gate shown before the voice-first
// interview session begins.
//
// Because browser autoplay-with-audio requires a user gesture, we show a
// "Begin interview" button. Clicking it calls video.play() (gesture-backed,
// so audio is allowed) and hides the button. A "Skip" link bypasses the video
// entirely. Both paths call onDone() to hand control back to Interview.
//
// Graceful fallback: if the video fails to load or decode (e.g. missing clip),
// onDone() is called immediately so a broken asset NEVER blocks the interview.

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../types/interview';

interface InterviewIntroProps {
  language: Language;
  /** Called when the intro completes. cameraConsented reflects the checkbox. */
  onDone: (cameraConsented: boolean) => void;
}

export default function InterviewIntro({ language, onDone }: InterviewIntroProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Whether the user has tapped "Begin interview" — hides the CTA once started.
  const [started, setStarted] = useState(false);
  // Phase A — explicit opt-in for the candidate camera (DPDP video_capture).
  // Default ON so the 1:1 video experience is the norm, but the candidate can
  // untick it; an unticked box → audio-only, exactly the previous behaviour.
  const [cameraConsent, setCameraConsent] = useState(true);
  // Read the latest checkbox value inside event-driven safeDone calls.
  const cameraConsentRef = useRef(cameraConsent);
  cameraConsentRef.current = cameraConsent;
  // Guard: prevent onDone being called more than once if multiple events fire.
  const doneCalledRef = useRef(false);

  const safeDone = useCallback(() => {
    if (doneCalledRef.current) return;
    doneCalledRef.current = true;
    onDone(cameraConsentRef.current);
  }, [onDone]);

  function handleBegin() {
    setStarted(true);
    videoRef.current?.play().catch(() => {
      // If play() rejects (e.g. jsdom or permission policy), the video won't
      // play but the UI stays in "started" state. onEnded or onError will
      // still fire if appropriate; otherwise the candidate can click "Skip".
    });
  }

  // Src: default to English if the language is not one of the known clips.
  const validLang: Language = language === 'hi' || language === 'te' ? language : 'en';
  const videoSrc = `/intro/intro_${validLang}.mp4`;

  return (
    <div
      className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-900 to-violet-900 relative overflow-hidden"
      data-testid="interview-intro"
    >
      {/* Background glow — decorative */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-indigo-800/40 to-violet-800/40 pointer-events-none"
        aria-hidden="true"
      />

      {/* Video player */}
      <div className="relative z-10 w-full max-w-2xl px-4 flex flex-col items-center gap-6">
        {/* Header */}
        <div className="text-center">
          <span className="text-sm font-semibold text-indigo-300 tracking-wider uppercase">
            {t('interviewIntro.brand')}
          </span>
          <h1 className="mt-1 text-2xl font-bold text-white">{t('interviewIntro.meetTitle')}</h1>
        </div>

        {/* Video container */}
        <div className="w-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-black">
          {/*
           * onError: video 404, decode failure, or codec unsupported — call
           *   onDone so a broken clip never blocks the interview.
           * onEnded: natural end of video playback — transition to the session.
           * playsInline: required on iOS to prevent fullscreen hijack.
           * preload="auto": buffer eagerly so playback starts without delay
           *   after the user gesture.
           */}
          <video
            ref={videoRef}
            src={videoSrc}
            playsInline
            preload="auto"
            onEnded={safeDone}
            onError={safeDone}
            aria-label="AI interviewer introduction video"
            className="w-full aspect-video object-cover"
            data-testid="intro-video"
          />
        </div>

        {/* Camera consent — Phase A (DPDP video_capture) */}
        <label className="flex items-start gap-3 w-full max-w-md rounded-xl bg-white/5 border border-white/10 px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={cameraConsent}
            onChange={(e) => setCameraConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent accent-indigo-500"
            data-testid="camera-consent-checkbox"
          />
          <span className="text-sm text-indigo-100 leading-snug">
            {t('interviewIntro.cameraConsent')}
          </span>
        </label>

        {/* CTA buttons */}
        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
          {!started && (
            <button
              type="button"
              onClick={handleBegin}
              aria-label={t('interviewIntro.beginLabel')}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 active:bg-indigo-600 text-white font-semibold px-6 py-3.5 text-base shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 focus:ring-offset-indigo-900"
              data-testid="begin-button"
            >
              {t('interviewIntro.beginButton')}
              {/* Play triangle */}
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={safeDone}
            aria-label={t('interviewIntro.skipLabel')}
            className="text-sm text-indigo-300 hover:text-white underline underline-offset-2 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 focus:ring-offset-indigo-900 rounded"
            data-testid="skip-button"
          >
            {t('interviewIntro.skipButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
