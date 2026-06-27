// CodingTaking — the candidate coding-round take UI (rendered by PublicExam when
// exam.kind === 'coding'). Self-contained: owns the per-question code state, the
// countdown + auto-submit, the "Run samples" action, and the final submit. The
// editor is lazy-loaded so Prism/the editor never touch the main bundle.
//
// SECURITY: only sample tests + their expected output are ever shown — hidden
// tests are graded server-side and never returned here.

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, Clock, Play, CheckCircle2, XCircle } from '@/design/components/icons';
import {
  runCode,
  submitCoding,
  type CodingAnswer,
  type ExamResult,
  type PublicTestResult,
  type TakeExam,
} from '@/api/publicExam';
import { cn } from '@/lib/utils';
import { GlassCard, Pill } from '@/design/components/primitives';

const CodeEditor = lazy(() => import('@/components/CodeEditor'));

const LANG_LABEL: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  go: 'Go',
  csharp: 'C#',
  ruby: 'Ruby',
  rust: 'Rust',
};

function fmt(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  token: string;
  exam: TakeExam;
  attemptId: string;
  deadline: string | null;
  onResult: (r: ExamResult) => void;
}

export default function CodingTaking({ token, exam, attemptId, deadline, onResult }: Props) {
  const questions = useMemo(
    () => [...exam.coding_questions].sort((a, b) => a.position - b.position),
    [exam.coding_questions],
  );

  const [code, setCode] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.starter_code ?? ''])),
  );
  const [lang, setLang] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.allowed_languages[0] ?? 'python'])),
  );
  const [runResults, setRunResults] = useState<Record<string, PublicTestResult[]>>({});
  const [runningQid, setRunningQid] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);

  // Countdown (UX only — the server is the time authority).
  useEffect(() => {
    if (!deadline) return;
    const target = new Date(deadline).getTime();
    const tick = () => setRemaining(Math.round((target - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const submitMut = useMutation({
    mutationFn: () =>
      submitCoding(
        token,
        attemptId,
        Object.fromEntries(
          questions.map((q) => [
            q.id,
            { language: lang[q.id], source: code[q.id] ?? '' } as CodingAnswer,
          ]),
        ),
      ),
    onSuccess: (r) => onResult(r),
    onError: () => {
      submittedRef.current = false;
    },
  });

  const doSubmit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    submitMut.mutate();
  };

  // Auto-submit when the clock hits zero.
  useEffect(() => {
    if (remaining !== null && remaining <= 0) doSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const runMut = useMutation({
    mutationFn: (qid: string) => runCode(token, qid, lang[qid], code[qid] ?? ''),
    onSuccess: (res, qid) => setRunResults((p) => ({ ...p, [qid]: res.results })),
    onSettled: () => setRunningQid(null),
  });

  const runSamples = (qid: string) => {
    setRunningQid(qid);
    runMut.mutate(qid);
  };

  return (
    <div className="min-h-screen bg-midnight font-sans">
      {/* Sticky bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.08] bg-obsidian/80 px-4 py-3 backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-foreground">{exam.title}</p>
          <p className="text-caption text-muted-foreground">
            {questions.length} coding {questions.length === 1 ? 'problem' : 'problems'}
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
          >
            <Clock className="h-4 w-4" aria-hidden="true" />
            {fmt(remaining)}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {questions.map((q, i) => {
          const results = runResults[q.id];
          const isRunning = runMut.isPending && runningQid === q.id;
          return (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <GlassCard className="space-y-4 rounded-[16px] p-6">
                {/* Prompt + points */}
                <div className="flex items-start justify-between gap-3">
                  <p className="whitespace-pre-wrap text-body font-medium text-foreground">
                    {i + 1}. {q.prompt}
                  </p>
                  <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-caption text-muted-foreground">
                    {q.points} pts
                  </span>
                </div>

                {/* Sample tests */}
                {q.sample_tests.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {q.sample_tests.map((s, si) => (
                      <div
                        key={si}
                        className="rounded-[10px] border border-white/[0.08] bg-white/[0.02] p-3 text-caption"
                      >
                        <div className="text-fog">Input</div>
                        <pre className="mt-0.5 whitespace-pre-wrap font-mono text-[12px] text-mist">
                          {s.stdin || '(none)'}
                        </pre>
                        <div className="mt-2 text-fog">Expected output</div>
                        <pre className="mt-0.5 whitespace-pre-wrap font-mono text-[12px] text-mist">
                          {s.expected_output}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}

                {/* Language picker */}
                <div className="flex items-center gap-2">
                  <label className="text-caption text-muted-foreground">Language</label>
                  <select
                    value={lang[q.id]}
                    onChange={(e) => setLang((p) => ({ ...p, [q.id]: e.target.value }))}
                    className="rounded-[8px] border border-white/[0.1] bg-[rgba(28,29,31,0.7)] px-2.5 py-1.5 text-body-sm text-foreground focus:border-electric focus:outline-none"
                  >
                    {q.allowed_languages.map((l) => (
                      <option key={l} value={l}>
                        {LANG_LABEL[l] ?? l}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Editor */}
                <Suspense
                  fallback={
                    <div className="flex h-40 items-center justify-center rounded-[12px] border border-white/[0.08] bg-[#0b0c0e]">
                      <Loader2 className="h-5 w-5 animate-spin text-electric" aria-hidden="true" />
                    </div>
                  }
                >
                  <CodeEditor
                    language={lang[q.id]}
                    value={code[q.id] ?? ''}
                    onChange={(next) => setCode((p) => ({ ...p, [q.id]: next }))}
                    placeholder="Write your solution here…"
                    textareaId={`ce-take-${q.id}`}
                  />
                </Suspense>

                {/* Run + sample results */}
                <div className="flex items-center gap-3">
                  <Pill
                    variant="ghost"
                    onClick={() => runSamples(q.id)}
                    disabled={isRunning}
                    className="gap-1.5"
                  >
                    {isRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play size={14} aria-hidden="true" />
                    )}
                    Run samples
                  </Pill>
                  {results && (
                    <span className="text-caption text-muted-foreground">
                      {results.filter((r) => r.passed).length}/{results.length} sample
                      {results.length === 1 ? '' : 's'} passing
                    </span>
                  )}
                </div>

                {results && results.length > 0 && (
                  <div className="space-y-2">
                    {results.map((r) => (
                      <div
                        key={r.index}
                        className={cn(
                          'rounded-[10px] border p-3 text-caption',
                          r.passed
                            ? 'border-[rgba(39,201,63,0.25)] bg-[rgba(39,201,63,0.05)]'
                            : 'border-[rgba(230,113,79,0.25)] bg-[rgba(230,113,79,0.05)]',
                        )}
                      >
                        <div className="flex items-center gap-1.5 font-medium">
                          {r.passed ? (
                            <CheckCircle2 size={13} className="text-vivid-mint" aria-hidden="true" />
                          ) : (
                            <XCircle size={13} className="text-ember" aria-hidden="true" />
                          )}
                          Sample {r.index + 1}
                          {r.timed_out ? ' · timed out' : ''}
                          {r.error ? ` · ${r.error}` : ''}
                        </div>
                        {!r.passed && (
                          <div className="mt-1.5 grid gap-1 font-mono text-[12px] text-mist sm:grid-cols-2">
                            <div>
                              <span className="text-fog">expected</span>
                              <pre className="whitespace-pre-wrap">{r.expected_output}</pre>
                            </div>
                            <div>
                              <span className="text-fog">got</span>
                              <pre className="whitespace-pre-wrap">{r.actual_output || '(empty)'}</pre>
                            </div>
                            {r.stderr && (
                              <div className="sm:col-span-2">
                                <span className="text-fog">stderr</span>
                                <pre className="whitespace-pre-wrap text-ember">{r.stderr}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            </motion.div>
          );
        })}

        {/* Submit */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-caption text-muted-foreground">
            Hidden tests run on submit. You can submit once.
          </p>
          <Pill onClick={doSubmit} disabled={submitMut.isPending}>
            {submitMut.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : null}
            Submit solution
          </Pill>
        </div>
        {submitMut.isError && (
          <p className="text-right text-body-sm text-ember">
            {submitMut.error instanceof Error ? submitMut.error.message : 'Submit failed'}
          </p>
        )}
        {submitMut.isPending && (
          <p className="text-right text-caption text-muted-foreground">
            Running your code against all test cases — this can take a moment…
          </p>
        )}
      </div>
    </div>
  );
}
