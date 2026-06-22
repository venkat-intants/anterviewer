// PublicExam — applicant exam-taking page (HR workflow Phase 2).
//
// PUBLIC, no login. The magic-link token comes from the URL #fragment (never sent
// to the server in the URL) and is forwarded as the X-Exam-Token header by the
// publicExam API client. No app shell — a clean, focused full-screen experience.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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

function fmt(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type Phase = 'intro' | 'taking' | 'result';

export default function PublicExam() {
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
        <AlertCircle className="h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">This exam link isn&apos;t valid</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The link may have expired, been revoked, or already been used. Please ask your
          recruiter for a fresh link.
        </p>
      </Centered>
    );
  }

  if (examQ.isLoading || !examQ.data) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading your exam…</p>
      </Centered>
    );
  }

  const exam = examQ.data;

  // ── Already completed (single-shot) ──
  if (phase !== 'result' && exam.already_submitted && !exam.allow_retake) {
    return (
      <Centered>
        <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">You&apos;ve already completed this exam</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your response has been recorded. You can close this window — your recruiter will be
          in touch.
        </p>
      </Centered>
    );
  }

  // ── Result ──
  if (phase === 'result' && result) {
    return (
      <Centered>
        {result.passed ? (
          <CheckCircle2 className="h-12 w-12 text-emerald-500" aria-hidden="true" />
        ) : (
          <XCircle className="h-12 w-12 text-rose-500" aria-hidden="true" />
        )}
        <h1 className="text-2xl font-bold text-foreground">{result.score_percent}%</h1>
        <p className="text-sm text-muted-foreground">
          {result.score_raw}/{result.score_max} points
          {result.status === 'expired' ? ' · submitted at time limit' : ''}
        </p>
        <p
          className={cn(
            'rounded-full px-3 py-1 text-sm font-semibold',
            result.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800',
          )}
        >
          {result.passed ? 'You passed' : 'Not this time'}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Thank you for completing the exam. You can close this window now.
        </p>
      </Centered>
    );
  }

  // ── Intro ──
  if (phase === 'intro') {
    return (
      <Centered>
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ClipboardList className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold text-foreground">{exam.title}</h1>
        {exam.description && (
          <p className="max-w-md text-sm text-muted-foreground">{exam.description}</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{exam.total_questions} questions</span>
          {exam.time_limit_seconds && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {Math.round(exam.time_limit_seconds / 60)} min
            </span>
          )}
        </div>
        {exam.time_limit_seconds && (
          <p className="text-xs text-amber-600">
            The timer starts when you begin and the exam auto-submits when it runs out.
          </p>
        )}
        <Button
          size="lg"
          disabled={startMut.isPending}
          onClick={() => startMut.mutate()}
          className="gap-2"
        >
          {startMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          Start exam
        </Button>
        {startMut.isError && (
          <p className="text-sm text-rose-600">
            {startMut.error instanceof Error ? startMut.error.message : 'Could not start.'}
          </p>
        )}
      </Centered>
    );
  }

  // ── Taking ──
  return (
    <div className="min-h-screen bg-background">
      {/* Sticky bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{exam.title}</p>
          <p className="text-xs text-muted-foreground">
            {answeredCount}/{questions.length} answered
          </p>
        </div>
        {remaining !== null && (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium tabular-nums',
              remaining <= 30 ? 'bg-rose-100 text-rose-700' : 'bg-muted text-foreground',
            )}
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            {fmt(remaining)}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        {questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            <p className="text-sm font-medium text-foreground">
              {i + 1}. {q.prompt}
            </p>
            <div className="mt-3 space-y-2">
              {q.options.map((opt, oi) => {
                const checked = answers[q.id] === oi;
                return (
                  <label
                    key={oi}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      checked
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border hover:bg-accent/40',
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
          </motion.div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-xs text-muted-foreground">
            {answeredCount < questions.length
              ? `${questions.length - answeredCount} unanswered`
              : 'All answered'}
          </p>
          <Button onClick={doSubmit} disabled={submitMut.isPending} size="lg" className="gap-2">
            {submitMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
            Submit exam
          </Button>
        </div>
        {submitMut.isError && (
          <p className="text-right text-sm text-rose-600">
            {submitMut.error instanceof Error ? submitMut.error.message : 'Submit failed — try again.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      {children}
    </div>
  );
}
