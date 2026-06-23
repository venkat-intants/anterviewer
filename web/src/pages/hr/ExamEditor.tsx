// ExamEditor — author questions, tune settings, publish, and assign (HR Phase 2).

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  Copy,
  Send,
  Ban,
  Lock,
  BarChart3,
  Loader2,
} from 'lucide-react';
import {
  getExam,
  updateExam,
  addQuestion,
  deleteQuestion,
  listAssignments,
  assignExam,
  revokeAssignment,
  type AssignResult,
} from '@/api/exams';
import { listApplicants } from '@/api/applicants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const inputCls =
  'w-full rounded-[9px] border border-border bg-secondary px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

export default function ExamEditor() {
  const { examId = '' } = useParams<{ examId: string }>();
  const qc = useQueryClient();
  const examKey = ['hr', 'exam', examId];

  const { data: exam, isLoading } = useQuery({ queryKey: examKey, queryFn: () => getExam(examId) });
  const { data: applicants } = useQuery({
    queryKey: ['hr', 'applicants'],
    queryFn: () => listApplicants(),
  });
  const { data: assignments } = useQuery({
    queryKey: ['hr', 'exam', examId, 'assignments'],
    queryFn: () => listAssignments(examId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: examKey });
    void qc.invalidateQueries({ queryKey: ['hr', 'exams'] });
  };

  // ── Question composer state ──
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [points, setPoints] = useState('1');

  // ── Assign state ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minted, setMinted] = useState<AssignResult[]>([]);

  const locked = (exam?.attempt_count ?? 0) > 0;

  const publishMut = useMutation({
    mutationFn: (status: 'draft' | 'published') => updateExam(examId, { status }),
    onSuccess: () => refresh(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });

  const thresholdMut = useMutation({
    mutationFn: (pass_threshold: number) => updateExam(examId, { pass_threshold }),
    onSuccess: () => {
      toast.success('Saved');
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const addMut = useMutation({
    mutationFn: () =>
      addQuestion(examId, {
        prompt: prompt.trim(),
        options: options.map((o) => o.trim()),
        correct_index: correctIdx,
        points: Number(points) || 1,
      }),
    onSuccess: () => {
      setPrompt('');
      setOptions(['', '']);
      setCorrectIdx(0);
      setPoints('1');
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Add failed'),
  });

  const delMut = useMutation({
    mutationFn: (qid: string) => deleteQuestion(examId, qid),
    onSuccess: () => refresh(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const assignMut = useMutation({
    mutationFn: () => assignExam(examId, [...selected]),
    onSuccess: (res) => {
      setMinted(res);
      setSelected(new Set());
      toast.success(`${res.length} link(s) created`);
      void qc.invalidateQueries({ queryKey: ['hr', 'exam', examId, 'assignments'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Assign failed'),
  });

  const revokeMut = useMutation({
    mutationFn: (aid: string) => revokeAssignment(examId, aid),
    onSuccess: () => {
      toast.success('Link revoked');
      void qc.invalidateQueries({ queryKey: ['hr', 'exam', examId, 'assignments'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Revoke failed'),
  });

  function submitQuestion(ev: React.FormEvent) {
    ev.preventDefault();
    if (!prompt.trim()) return toast.error('Question prompt is required.');
    const filled = options.map((o) => o.trim());
    if (filled.some((o) => !o)) return toast.error('All option fields must be filled.');
    if (correctIdx >= filled.length) return toast.error('Pick the correct answer.');
    addMut.mutate();
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  if (isLoading || !exam) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-3xl" />
      </div>
    );
  }

  const isPublished = exam.status === 'published';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/hr/exams"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All exams
          </Link>
          <h1 className="truncate text-subheading font-semibold text-foreground">{exam.title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to={`/hr/exams/${examId}/results`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> Results
            </Button>
          </Link>
          <Button
            size="sm"
            variant={isPublished ? 'outline' : 'default'}
            disabled={publishMut.isPending}
            onClick={() => publishMut.mutate(isPublished ? 'draft' : 'published')}
          >
            {isPublished ? 'Unpublish' : 'Publish'}
          </Button>
        </div>
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-600">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          This exam has attempts — questions are locked to keep grading fair.
        </div>
      )}

      {/* Settings */}
      <Card className="transition-shadow hover:shadow-card-hover">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Settings</CardTitle>
          <CardDescription>
            Status: <Badge variant="outline">{exam.status}</Badge> · pass ≥ {exam.pass_threshold}% ·{' '}
            {exam.time_limit_seconds ? `${Math.round(exam.time_limit_seconds / 60)} min` : 'untimed'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-end gap-2 text-sm">
            <span className="flex-1">
              <span className="mb-1 block text-xs text-muted-foreground">Pass threshold %</span>
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={exam.pass_threshold}
                className={inputCls}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== exam.pass_threshold && v >= 0 && v <= 100) thresholdMut.mutate(v);
                }}
                aria-label="Pass threshold"
              />
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Questions */}
      <Card className="transition-shadow hover:shadow-card-hover">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Questions ({exam.questions.length})</CardTitle>
          <CardDescription>One correct option per question. Worth the listed points.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exam.questions.map((q, i) => (
            <div key={q.id} className="rounded-xl border border-border bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {i + 1}. {q.prompt}{' '}
                  <span className="text-xs font-normal text-muted-foreground">({q.points} pt)</span>
                </p>
                {!locked && (
                  <button
                    type="button"
                    aria-label="Delete question"
                    className="shrink-0 text-muted-foreground hover:text-rose-600"
                    onClick={() => delMut.mutate(q.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {q.options.map((opt, oi) => (
                  <li
                    key={oi}
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      oi === q.correct_index ? 'font-medium text-emerald-600' : 'text-muted-foreground',
                    )}
                  >
                    {oi === q.correct_index ? (
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {opt}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {!locked && (
            <form onSubmit={submitQuestion} className="space-y-2 rounded-xl border border-dashed border-border bg-muted/40 p-3">
              <Input
                placeholder="Question prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="Question prompt"
              />
              <div className="space-y-1.5">
                {options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={correctIdx === oi}
                      onChange={() => setCorrectIdx(oi)}
                      className="h-4 w-4 accent-primary"
                      aria-label={`Mark option ${oi + 1} correct`}
                    />
                    <input
                      className={inputCls}
                      placeholder={`Option ${oi + 1}`}
                      value={opt}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((o, j) => (j === oi ? e.target.value : o)))
                      }
                      aria-label={`Option ${oi + 1}`}
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        aria-label="Remove option"
                        className="shrink-0 text-muted-foreground hover:text-rose-600"
                        onClick={() => {
                          setOptions((prev) => prev.filter((_, j) => j !== oi));
                          setCorrectIdx((c) => (c >= oi && c > 0 ? c - 1 : c));
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {options.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => setOptions((prev) => [...prev, ''])}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add option
                  </Button>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  Points
                  <input
                    type="number"
                    min={1}
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    className="w-16 rounded-[9px] border border-border bg-secondary px-2 py-1 text-sm text-foreground"
                    aria-label="Points"
                  />
                </label>
                <Button type="submit" size="sm" disabled={addMut.isPending} className="gap-1.5">
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add question
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Assign */}
      <Card className="transition-shadow hover:shadow-card-hover">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Assign &amp; share links</CardTitle>
          <CardDescription>
            {isPublished
              ? 'Pick applicants and generate a private link each can use to take the exam.'
              : 'Publish the exam first, then assign it to applicants.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPublished && (
            <>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-muted/40 p-2">
                {(applicants ?? []).length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No applicants yet — add them under Applicants.
                  </p>
                ) : (
                  (applicants ?? []).map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(a.id);
                            else next.delete(a.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="truncate">{a.full_name}</span>
                    </label>
                  ))
                )}
              </div>
              <Button
                size="sm"
                disabled={assignMut.isPending || selected.size === 0}
                onClick={() => assignMut.mutate()}
                className="gap-1.5"
              >
                {assignMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Generate links ({selected.size})
              </Button>

              {minted.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
                  <p className="text-xs font-medium text-emerald-700">
                    Share each link with the applicant — copy now (shown once):
                  </p>
                  {minted.map((m) => (
                    <div key={m.assignment_id} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 truncate font-medium text-foreground">{m.applicant_name}</span>
                      <input readOnly value={m.magic_link} className="min-w-0 flex-1 rounded-[9px] border border-border bg-secondary px-2 py-1 text-muted-foreground" />
                      <button
                        type="button"
                        aria-label="Copy link"
                        className="shrink-0 text-emerald-600 hover:text-emerald-800"
                        onClick={() => void copyLink(m.magic_link)}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(assignments ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Assigned</p>
              {(assignments ?? []).map((a) => (
                <div key={a.assignment_id} className="flex items-center gap-2 text-sm text-foreground">
                  <span className="min-w-0 flex-1 truncate">{a.applicant_name}</span>
                  <Badge variant="outline" className="text-[11px]">{a.status}</Badge>
                  {a.status === 'invited' && (
                    <button
                      type="button"
                      aria-label="Revoke link"
                      className="shrink-0 text-muted-foreground hover:text-rose-600"
                      onClick={() => revokeMut.mutate(a.assignment_id)}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
