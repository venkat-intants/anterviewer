// InterviewComplete — shown after the interview session ends.
//
// Polls for the scorecard linked to this session:
//   1. If the sessionId is known, calls listSessions to find the scorecard_id.
//   2. Once scorecard_id is found, redirects to /scorecard/:id.
//   3. After SCORECARD_POLL_TIMEOUT_MS, stops polling and shows a timeout state
//      with a manual "Check scorecard" link and a back-to-dashboard CTA.
//
// The "preparing…" skeleton is shown while polling is in flight.
// All layout uses AppShell design tokens (bg-background, border, etc.).

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, LayoutDashboard, History, ArrowRight, RefreshCw, XCircle } from 'lucide-react';
import { listSessions } from '@/api/sessions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How often to re-poll for the scorecard (ms) */
const POLL_INTERVAL_MS = 3_000;

/** After this long with no scorecard, stop polling and show the timeout card */
const SCORECARD_POLL_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationState {
  message?: string;
  /** True when the candidate clicked "End session" before the normal completion event. */
  endedEarly?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InterviewComplete() {
  const { t } = useTranslation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as LocationState | null;
  const message = state?.message ?? t('interviewComplete.defaultMessage');
  const endedEarly = state?.endedEarly === true;

  // ── Polling state ──────────────────────────────────────────────────────────
  // When endedEarly is true, skip polling entirely — no scorecard will arrive
  // for the short session (or at least we should not spin for 90 s waiting).
  const [pollingActive, setPollingActive] = useState(!endedEarly);
  const [hasTimedOut, setHasTimedOut] = useState(false);
  const startTimeRef = useRef(Date.now());

  // Poll listSessions to find this session's scorecard_id (normal completion path only)
  const { data: sessionsData } = useQuery({
    queryKey: ['sessions', 'complete-poll', sessionId],
    queryFn: () => listSessions({ page: 1, perPage: 20 }),
    enabled: !endedEarly && pollingActive && !!sessionId,
    refetchInterval: pollingActive ? POLL_INTERVAL_MS : false,
    staleTime: 0,
    retry: false,
  });

  // Find our session in the list
  const thisSession = sessionsData?.items.find((s) => s.session_id === sessionId);
  const scorecardId = thisSession?.scorecard_id ?? null;

  // Redirect when the scorecard_id arrives
  useEffect(() => {
    if (!scorecardId) return;
    setPollingActive(false);
    void navigate(`/scorecard/${scorecardId}`, { replace: true });
  }, [scorecardId, navigate]);

  // Timeout: stop polling after SCORECARD_POLL_TIMEOUT_MS
  useEffect(() => {
    if (!pollingActive) return;
    const remaining = SCORECARD_POLL_TIMEOUT_MS - (Date.now() - startTimeRef.current);
    const t = setTimeout(() => {
      setPollingActive(false);
      setHasTimedOut(true);
    }, Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [pollingActive]);

  const isPreparing = !endedEarly && pollingActive && !scorecardId;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* ── Icon — early-exit variant uses a different colour ──────────── */}
          <div className="flex justify-center mb-6">
            {endedEarly ? (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-50 border border-amber-200 shadow-card">
                <XCircle className="h-10 w-10 text-amber-600" aria-hidden="true" />
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 shadow-card">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden="true" />
              </div>
            )}
          </div>

          <h1 className="text-heading font-semibold text-foreground text-center">
            {endedEarly ? t('interviewComplete.titleEarly') : t('interviewComplete.title')}
          </h1>
          <p className="mt-2 text-body-sm text-muted-foreground text-center leading-relaxed">
            {message}
          </p>

          {sessionId && (
            <p className="mt-1 font-mono text-caption text-muted-foreground/70 text-center break-all">
              {t('interviewComplete.sessionLabel', { id: sessionId })}
            </p>
          )}

          <div className="mt-8 space-y-3">
            {/* ── Early-exit notice (no scorecard polling) ───────────────── */}
            {endedEarly && (
              <Card
                className="rounded-2xl border-border shadow-card"
                data-testid="early-exit-card"
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col items-center gap-2 py-1 text-center" aria-live="polite">
                    <p className="text-body-sm font-medium text-foreground">
                      {t('interviewComplete.earlyExitTitle')}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {t('interviewComplete.earlyExitDesc')}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Scorecard section (normal completion path only) ────────── */}
            {!endedEarly && (
              <Card
                className={cn(
                  'rounded-2xl border transition-colors shadow-card',
                  isPreparing && 'border-primary/30 bg-muted',
                  hasTimedOut && 'border-border bg-card',
                )}
              >
                <CardContent className="pt-4 pb-4">
                  {isPreparing && (
                    <div className="flex flex-col items-center gap-3 py-2" aria-live="polite">
                      <div className="flex items-center gap-2 text-body-sm font-medium text-primary">
                        <span
                          className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                          aria-hidden="true"
                        />
                        {t('interviewComplete.preparingScorecard')}
                      </div>
                      <div className="w-full space-y-2">
                        <Skeleton className="h-3 w-3/4 mx-auto rounded" />
                        <Skeleton className="h-3 w-1/2 mx-auto rounded" />
                      </div>
                      <p className="text-caption text-muted-foreground text-center">
                        {t('interviewComplete.scorecardDesc')}
                      </p>
                    </div>
                  )}

                  {hasTimedOut && (
                    <div className="flex flex-col items-center gap-3 py-2 text-center" aria-live="polite">
                      <Clock className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                      <div>
                        <p className="text-body-sm font-medium text-foreground">{t('interviewComplete.scorecardTimeout')}</p>
                        <p className="mt-1 text-caption text-muted-foreground">
                          {t('interviewComplete.scorecardTimeoutDesc')}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          startTimeRef.current = Date.now();
                          setHasTimedOut(false);
                          setPollingActive(true);
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('interviewComplete.checkAgain')}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Navigation actions ─────────────────────────────────────── */}
            <Button
              asChild
              className="w-full gap-2"
              size="lg"
            >
              <Link to="/dashboard">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                {t('interviewComplete.backToDashboard')}
              </Link>
            </Button>

            <div className="grid grid-cols-2 gap-3">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to="/history">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('interviewComplete.history')}
                </Link>
              </Button>

              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link to="/start">
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('interviewComplete.newInterview')}
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
