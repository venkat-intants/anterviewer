// Interview — LiveKit voice + video interview page.
//
// Flow:
//   1. Interview renders InterviewIntro (full-screen intro / consent video).
//   2. Candidate clicks "Begin interview" or "Skip" → introDone becomes true.
//   3. Interview renders LiveKitInterview which auto-connects to the LiveKit room.
//      The user gesture from step 2 satisfies browser autoplay policies for the
//      avatar video and mic permission prompt.
//
// sessionId is read from the URL param (:sessionId).
// If the route is reached without a sessionId (shouldn't happen in normal flow)
// the page renders a graceful "missing session" error rather than crashing.

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import InterviewIntro from '@/components/InterviewIntro';
import LiveKitInterview from '@/features/interview/LiveKitInterview';
import { postConsent } from '@/api/consent';
import type { Language } from '@/types/interview';

// Language preference written to localStorage by StartInterview / JobsList
// before createSession is called. Resolved once at page mount.
const LANGUAGE_STORAGE_KEY = 'intants:interview-language';

function resolveLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'en' || stored === 'hi' || stored === 'te') return stored;
  return 'en';
}

export default function Interview() {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [introDone, setIntroDone] = useState(false);
  // Phase A — whether the candidate consented to their camera in the intro.
  const [cameraConsented, setCameraConsented] = useState(false);

  // Resolved once at mount — language cannot change mid-session.
  const [sessionLanguage] = useState<Language>(resolveLanguage);

  // Intro complete: persist the camera-consent decision (best-effort — a ledger
  // failure must never block the interview) and advance to the live session.
  function handleIntroDone(consented: boolean) {
    setCameraConsented(consented);
    if (consented) {
      void postConsent(undefined, 'video_capture').catch(() => {
        // Non-fatal: the DPDP video_capture row failed to write. We still honour
        // the candidate's in-session choice; the ledger write can be retried.
      });
    }
    setIntroDone(true);
  }

  // Guard: sessionId must be present — the route definition guarantees it
  // but we handle the defensive case explicitly.
  if (!sessionId) {
    return (
      <main className="h-screen flex items-center justify-center bg-background px-4">
        <p className="text-body-sm text-mist">{t('interviewPage.missingSession')}</p>
      </main>
    );
  }

  if (!introDone) {
    return (
      <InterviewIntro
        language={sessionLanguage}
        onDone={handleIntroDone}
      />
    );
  }

  return <LiveKitInterview sessionId={sessionId} cameraConsented={cameraConsented} />;
}
