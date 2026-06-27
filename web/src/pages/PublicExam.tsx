// PublicExam — applicant exam-taking page (HR workflow Phase 2).
//
// PUBLIC, no login. The magic-link token comes from the URL #fragment (never sent
// to the server in the URL) and is forwarded as the X-Exam-Token header by the
// publicExam API client. No app shell — a clean, focused full-screen experience.
//
// SECURITY: token MUST come from window.location.hash — NOT useParams.
// Design mockup used useParams; that has been deliberately rejected here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ListChecks,
  Languages,
  ShieldCheck,
} from '@/design/components/icons';
import {
  getPublicExam,
  startExam,
  submitExam,
  type ExamResult,
} from '@/api/publicExam';
import { cn } from '@/lib/utils';
import { AuroraField } from '@/design/components/AuroraField';
import { GlassCard, Pill, StatusTag } from '@/design/components/primitives';
import CodingTaking from '@/pages/exam/CodingTaking';

function fmt(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type Phase = 'intro' | 'taking' | 'result';

// ── Full-page dark centred layout (shared by loading / error / result states) ──
function PageWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-midnight px-6 py-12 font-sans text-foreground">
      <AuroraField />
      {/* Logo mark */}
      <div className="absolute left-6 top-6 z-10 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#112d72,#a887dc)]">
          <span className="h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="text-[15px] font-semibold text-foreground">Anterview</span>
      </div>
      <div className="relative z-10 flex w-full max-w-[520px] flex-col items-center gap-4 text-center">
        {children}
      </div>
    </div>
  );
}

export default function PublicExam() {
  const { t } = useTranslation();

  // SECURITY: token from #fragment — never from a path param.
  const [token] = useState(() => window.location.hash.replace(/^#/, '').trim());
  const [consent, setConsent] = useState(false);

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

  // Auto-submit when the clock hits zero (MCQ only — the coding take owns its own
  // countdown + submit, since its payload is source code, not answer indices).
  useEffect(() => {
    if (
      phase === 'taking' &&
      examQ.data?.kind !== 'coding' &&
      remaining !== null &&
      remaining <= 0
    )
      doSubmit();
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
      <PageWrap>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-[rgba(255,183,100,0.15)] text-amber-glow">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('publicExam.invalidTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {t('publicExam.invalidDesc')}
        </p>
      </PageWrap>
    );
  }

  if (examQ.isLoading || !examQ.data) {
    return (
      <PageWrap>
        <Loader2 className="h-8 w-8 animate-spin text-electric" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t('publicExam.loading')}</p>
      </PageWrap>
    );
  }

  const exam = examQ.data;

  // ── Already completed (single-shot / no retake) ──
  if (phase !== 'result' && exam.already_submitted && !exam.allow_retake) {
    return (
      <PageWrap>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-[rgba(39,201,63,0.15)] text-vivid-mint">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('publicExam.completedTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {t('publicExam.completedDesc')}
        </p>
      </PageWrap>
    );
  }

  // ── Result ──
  if (phase === 'result' && result) {
    return (
      <PageWrap>
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className="w-full"
        >
          <GlassCard className="flex flex-col items-center gap-4 p-8 text-center">
            <span
              className={cn(
                'inline-flex h-16 w-16 items-center justify-center rounded-3xl',
                result.passed
                  ? 'bg-[rgba(39,201,63,0.15)] text-vivid-mint'
                  : 'bg-[rgba(230,113,79,0.15)] text-ember',
              )}
            >
              {result.passed ? (
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              ) : (
                <XCircle className="h-8 w-8" aria-hidden="true" />
              )}
            </span>
            <h1 className="text-heading font-semibold tracking-heading text-foreground">
              {result.score_percent}%
            </h1>
            <p className="text-body-sm text-muted-foreground">
              {t('publicExam.points', { raw: result.score_raw, max: result.score_max })}
              {result.status === 'expired' ? t('publicExam.submittedAtLimit') : ''}
            </p>
            <StatusTag tone={result.passed ? 'forest' : 'ember'} dot>
              {result.passed ? t('publicExam.passed') : t('publicExam.notThisTime')}
            </StatusTag>
            <p className="max-w-sm text-body-sm text-muted-foreground">
              {t('publicExam.resultThanks')}
            </p>
          </GlassCard>
        </motion.div>
      </PageWrap>
    );
  }

  // ── Intro ──
  if (phase === 'intro') {
    const facts = [
      {
        icon: ListChecks,
        label: t('publicExam.factQuestions'),
        value: t('publicExam.questionsCount', { count: exam.total_questions }),
      },
      ...(exam.time_limit_seconds
        ? [
            {
              icon: Clock,
              label: t('publicExam.factDuration'),
              value: t('publicExam.minutes', {
                count: Math.round(exam.time_limit_seconds / 60),
              }),
            },
          ]
        : []),
      {
        icon: Languages,
        label: t('publicExam.factLanguage'),
        value: 'EN · हि · తె',
      },
    ];

    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-midnight px-6 py-12 font-sans text-foreground">
        <AuroraField />
        <div className="relative z-10 w-full max-w-[520px]">
          {/* Logo */}
          <div className="mb-6 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#112d72,#a887dc)]">
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <span className="text-[15px] font-semibold text-foreground">Anterview</span>
          </div>

          <GlassCard className="p-8">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <StatusTag tone="forest" dot>
                {t('publicExam.liveExam')}
              </StatusTag>
              <span className="font-mono text-[11px] text-fog">
                #{token.slice(0, 10)}
              </span>
            </div>

            <h1 className="mt-4 text-[26px] font-semibold tracking-[-0.8px] text-foreground">
              {exam.title}
            </h1>

            {exam.description && (
              <p className="mt-1.5 text-body-sm text-muted-foreground">{exam.description}</p>
            )}

            {/* Fact grid */}
            <div
              className={cn(
                'mt-6 grid gap-3',
                facts.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              {facts.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.label}
                    className="rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-4"
                  >
                    <Icon size={16} className="text-electric" aria-hidden="true" />
                    <div className="mt-2 text-[11px] uppercase tracking-[0.5px] text-fog">
                      {f.label}
                    </div>
                    <div className="mt-0.5 text-[13.5px] font-medium text-foreground">
                      {f.value}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Timer warning */}
            {exam.time_limit_seconds && (
              <p className="mt-4 text-caption text-amber-glow">{t('publicExam.timerNote')}</p>
            )}

            {/* DPDP consent */}
            <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-4 text-[12.5px] text-mist">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-none accent-electric"
              />
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="flex-none text-vivid-mint" aria-hidden="true" />
                {t('publicExam.consentLabel')}
              </span>
            </label>

            <Pill
              className="mt-6 w-full py-3.5"
              disabled={!consent || startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : null}
              {t('publicExam.startExam')}
            </Pill>

            {startMut.isError && (
              <p className="mt-3 text-center text-body-sm text-ember">
                {startMut.error instanceof Error
                  ? startMut.error.message
                  : t('publicExam.couldNotStart')}
              </p>
            )}
          </GlassCard>
        </div>
      </div>
    );
  }

  // ── Taking: coding round (self-contained editor + run + submit) ──
  if (exam.kind === 'coding') {
    return (
      <CodingTaking
        token={token}
        exam={exam}
        attemptId={attemptId ?? ''}
        deadline={deadline}
        onResult={(r) => {
          setResult(r);
          setPhase('result');
        }}
      />
    );
  }

  // ── Taking: MCQ ──
  return (
    <div className="min-h-screen bg-midnight font-sans">
      {/* Sticky bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.08] bg-obsidian/80 px-4 py-3 backdrop-blur-xl">
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
              remaining <= 30
                ? 'bg-[rgba(230,113,79,0.15)] text-ember'
                : 'bg-white/[0.06] text-foreground',
            )}
            aria-live="polite"
            aria-label={t('publicExam.timeRemaining', { time: fmt(remaining) })}
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
            transition={{ delay: i * 0.04 }}
          >
            <GlassCard className="rounded-[16px] p-6 transition-colors hover:border-electric/30">
              <p className="text-body font-medium text-foreground">
                {i + 1}. {q.prompt}
              </p>
              <div className="mt-4 space-y-2" role="radiogroup" aria-label={q.prompt}>
                {q.options.map((opt, oi) => {
                  const checked = answers[q.id] === oi;
                  return (
                    <label
                      key={oi}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-2.5 text-body-sm transition-colors',
                        checked
                          ? 'border-electric/60 bg-electric/10 text-foreground'
                          : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:bg-white/[0.03]',
                      )}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={checked}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                        className="h-4 w-4 accent-electric"
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            </GlassCard>
          </motion.div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-muted-foreground">
            {answeredCount < questions.length
              ? t('publicExam.unanswered', { count: questions.length - answeredCount })
              : t('publicExam.allAnswered')}
          </p>
          <Pill
            onClick={doSubmit}
            disabled={submitMut.isPending}
          >
            {submitMut.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : null}
            {t('publicExam.submitExam')}
          </Pill>
        </div>
        {submitMut.isError && (
          <p className="text-right text-body-sm text-ember">
            {submitMut.error instanceof Error
              ? submitMut.error.message
              : t('publicExam.submitFailed')}
          </p>
        )}
      </div>
    </div>
  );
}
