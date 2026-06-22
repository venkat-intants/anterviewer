// Exams — HR MCQ exam list + create (HR workflow Phase 2).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ClipboardList, Plus, ChevronRight, FileQuestion, Users2 } from 'lucide-react';
import { listExams, createExam, type ExamSummary } from '@/api/exams';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

function statusBadge(s: string): { label: string; cls: string } {
  switch (s) {
    case 'published':
      return { label: 'Published', cls: 'bg-emerald-100 text-emerald-800' };
    case 'closed':
      return { label: 'Closed', cls: 'bg-zinc-200 text-zinc-700' };
    default:
      return { label: 'Draft', cls: 'bg-amber-100 text-amber-800' };
  }
}

function ExamRow({ e }: { e: ExamSummary }) {
  const navigate = useNavigate();
  const badge = statusBadge(e.status);
  return (
    <button
      type="button"
      onClick={() => navigate(`/hr/exams/${e.id}`)}
      className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{e.title}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', badge.cls)}>
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileQuestion className="h-3.5 w-3.5" aria-hidden="true" /> {e.question_count} questions
            </span>
            <span className="flex items-center gap-1">
              <Users2 className="h-3.5 w-3.5" aria-hidden="true" /> {e.attempt_count} attempts
            </span>
            <span>pass ≥ {e.pass_threshold}%</span>
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </button>
  );
}

export default function Exams() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [threshold, setThreshold] = useState('60');
  const [minutes, setMinutes] = useState('');
  const [allowRetake, setAllowRetake] = useState(false);

  const { data: exams, isLoading } = useQuery({
    queryKey: ['hr', 'exams'],
    queryFn: () => listExams(),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createExam({
        title: title.trim(),
        pass_threshold: Number(threshold) || 60,
        time_limit_seconds: minutes.trim() ? Math.max(1, Number(minutes)) * 60 : null,
        allow_retake: allowRetake,
      }),
    onSuccess: (e) => {
      toast.success('Exam created — add questions next');
      setTitle('');
      setMinutes('');
      void qc.invalidateQueries({ queryKey: ['hr', 'exams'] });
      navigate(`/hr/exams/${e.id}`);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!title.trim()) return toast.error('Give the exam a title.');
    createMut.mutate();
  }

  const list = exams ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MCQ exams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Author a timed multiple-choice exam, set a pass threshold, share a link, and
          auto-grade applicants.
        </p>
      </div>

      {/* Create */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            New exam
          </CardTitle>
          <CardDescription>Create the exam, then add questions and publish.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              placeholder="Exam title (e.g. Python Fundamentals Screening)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Exam title"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Pass threshold %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  aria-label="Pass threshold percent"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Time limit (min)</span>
                <input
                  type="number"
                  min={1}
                  placeholder="none"
                  className={inputCls}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  aria-label="Time limit minutes"
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowRetake}
                  onChange={(e) => setAllowRetake(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span>Allow retake</span>
              </label>
            </div>
            <Button type="submit" disabled={createMut.isPending} className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {createMut.isPending ? 'Creating…' : 'Create exam'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Your exams ({list.length})
        </h2>
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No exams yet — create one above.
          </p>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
            className="space-y-2"
          >
            {list.map((e) => (
              <motion.div
                key={e.id}
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              >
                <ExamRow e={e} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
