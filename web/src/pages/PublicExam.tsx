// PublicExam — applicant exam-taking page (HR workflow Phase 2).
//
// PUBLIC, no login. The magic-link token comes from the URL #fragment (never sent
// to the server in the URL) and is forwarded as the X-Exam-Token header by the
// publicExam API client. No app shell — a clean, focused full-screen experience.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, XCircle, Clock, ClipboardList } from 'lucide-react';
import {
  getPublicExam,
  startExam,
  submitExam,
  type ExamResult,
} from '@/api/publicExam';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

function fmt(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type Phase = 'intro' | 'taking' | 'result';

export default function PublicExam() {
  const { t } = useTranslation();
  const [token] = useState(() => window.location.hash.replace(/^#/, '').trim());

  const examQ = useQuery({
    queryKey: ['public-exam', token],
    queryFn: () => getPublicExam(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const [phase, setPhase] = useState<Phase>('intro');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);

  const startMut = useMutation({
    mutationFn: () => startExam(token),
    onSuccess: (s) => {
      setAttemptId(s.attempt_id);
      setDeadline(s.deadline);
      setPhase('taking');
    },
  });

  const submitMut = useMutation({
    mutationFn: () => submitExam(token, attemptId ?? '', answers),
    onSuccess: (r) => {
      setResult(r);
      setPhase('result');
    },
    onError: () => {
      submittedRef.current = false; // allow a retry if the network blipped
    },
  });

  const doSubmit = () => {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    submitMut.mutate();
  };

  // Countdown (UX only — the server is the real time authority).
  useEffect(() => {
    if (phase !== 'taking' || !deadline) return;
    const target = new Date(deadline).getTime();
    const tick = () => setRemaining(Math.round((target - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, deadline]);

  // Auto-submit when the clock hits zero.
  useEffect(() => {
    if (phase === 'taking' && remaining !== null && remaining <= 0) doSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase]);

  const questions = useMemo(
    () => [...(examQ.data?.questions ?? [])].sort((a, b) => a.position - b.position),
    [examQ.data],
  );
  const answeredCount = Object.keys(answers).length;

  // ── No token / invalid / expired ──
  if (!token || examQ.isError) {
    return (
      <Centered>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-amber-50 text-amber-600">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('publicExam.invalidTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">{t('publicExam.invalidDesc')}</p>
      </Centered>
    );
  }

  if (examQ.isLoading || !examQ.data) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t('publicExam.loading')}</p>
      </Centered>
    );
  }

  const exam = examQ.data;

  // ── Already completed (single-shot) ──
  if (phase !== 'result' && exam.already_submitted && !exam.allow_retake) {
    return (
      <Centered>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('publicExam.completedTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {t('publicExam.completedDesc')}
        </p>
      </Centered>
    );
  }

  // ── Result ──
  if (phase === 'result' && result) {
    return (
      <Centered>
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className="flex flex-col items-center gap-4"
        >
          <span
            className={cn(
              'inline-flex h-16 w-16 items-center justify-center rounded-3xl',
              result.passed ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
            )}
          >
            {result.passed ? (
              <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
            ) : (
              <XCircle className="h-8 w-8" aria-hidden="true" />
            )}
          </span>
          <h1 className="text-heading-lg font-semibold tracking-heading-lg text-foreground">
            {result.score_percent}%
          </h1>
          <p className="text-body-sm text-muted-foreground">
            {t('publicExam.points', { raw: result.score_raw, max: result.score_max })}
            {result.status === 'expired' ? t('publicExam.submittedAtLimit') : ''}
          </p>
          <Badge variant={result.passed ? 'success' : 'destructive'}>
            {result.passed ? t('publicExam.passed') : t('publicExam.notThisTime')}
          </Badge>
          <p className="max-w-sm text-body-sm text-muted-foreground">
            {t('publicExam.resultThanks')}
          </p>
        </motion.div>
      </Centered>
    );
  }

  // ── Intro ──
  if (phase === 'intro') {
    return (
      <Centered>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="flex w-full max-w-lg flex-col items-center gap-4 p-8 shadow-elevated ring-1 ring-primary/10">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-[9px] bg-secondary text-foreground">
              <ClipboardList className="h-7 w-7" aria-hidden="true" />
            </span>
            <h1 className="text-subheading font-semibold text-foreground">{exam.title}</h1>
            {exam.description && (
              <p className="max-w-md text-body-sm text-muted-foreground">{exam.description}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
              <span>{t('publicExam.questionsCount', { count: exam.total_questions })}</span>
              {exam.time_limit_seconds && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t('publicExam.minutes', { count: Math.round(exam.time_limit_seconds / 60) })}
                </span>
              )}
            </div>
            {exam.time_limit_seconds && (
              <p className="text-caption text-amber-600">{t('publicExam.timerNote')}</p>
            )}
            <Button
              size="lg"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate()}
              className="mt-1 gap-2"
            >
              {startMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
              {t('publicExam.startExam')}
            </Button>
            {startMut.isError && (
              <p className="text-body-sm text-rose-600">
                {startMut.error instanceof Error ? startMut.error.message : t('publicExam.couldNotStart')}
              </p>
            )}
          </Card>
        </motion.div>
      </Centered>
    );
  }

  // ── Taking ──
  return (
    <div className="min-h-screen bg-background">
      {/* Sticky bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-white/80 px-4 py-3 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-foreground">{exam.title}</p>
          <p className="text-caption text-muted-foreground">
            {t('publicExam.answered', { answered: answeredCount, total: questions.length })}
          </p>
        </div>
        {remaining !== null && (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-body-sm font-medium tabular-nums',
              remaining <= 30 ? 'bg-rose-50 text-rose-600' : 'bg-secondary text-foreground',
            )}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            {fmt(remaining)}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        {questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="p-6 transition-shadow hover:shadow-card-hover">
              <p className="text-body font-medium text-foreground">
                {i + 1}. {q.prompt}
              </p>
              <div className="mt-4 space-y-2">
                {q.options.map((opt, oi) => {
                  const checked = answers[q.id] === oi;
                  return (
                    <label
                      key={oi}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-body-sm transition-colors',
                        checked
                          ? 'border-primary/60 bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      )}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={checked}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                        className="h-4 w-4 accent-primary"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-muted-foreground">
            {answeredCount < questions.length
              ? t('publicExam.unanswered', { count: questions.length - answeredCount })
              : t('publicExam.allAnswered')}
          </p>
          <Button onClick={doSubmit} disabled={submitMut.isPending} size="lg" className="gap-2">
            {submitMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
            {t('publicExam.submitExam')}
          </Button>
        </div>
        {submitMut.isError && (
          <p className="text-right text-body-sm text-rose-600">
            {submitMut.error instanceof Error ? submitMut.error.message : t('publicExam.submitFailed')}
          </p>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-3 overflow-hidden bg-background px-6 text-center">
      <div className="relative z-10 flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}
