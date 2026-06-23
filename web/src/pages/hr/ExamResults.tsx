// ExamResults — graded attempts for one exam (HR workflow Phase 2).

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { getExam, listAttempts, type AttemptResult } from '@/api/exams';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

function tone(p: number | null): string {
  if (p === null) return 'text-muted-foreground';
  if (p >= 70) return 'text-emerald-600';
  if (p >= 45) return 'text-amber-600';
  return 'text-rose-600';
}

function Row({ a }: { a: AttemptResult }) {
  const inProgress = a.status === 'in_progress' || a.submitted_at === null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3 shadow-card">
      <div className="w-12 shrink-0 text-center">
        <div className={cn('text-xl font-semibold leading-none tracking-tight', tone(a.score_percent))}>
          {a.score_percent ?? '—'}
        </div>
        <div className="text-micro text-muted-foreground">%</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{a.applicant_name}</p>
        <p className="text-xs text-muted-foreground">
          {a.score_raw ?? '—'}/{a.score_max ?? '—'} pts
          {a.attempt_no > 1 ? ` · attempt ${a.attempt_no}` : ''}
          {a.submitted_at ? ` · ${new Date(a.submitted_at).toLocaleString()}` : ''}
        </p>
      </div>
      {inProgress ? (
        <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
          <Clock className="h-3 w-3" aria-hidden="true" /> In progress
        </Badge>
      ) : a.passed ? (
        <Badge variant="success" className="shrink-0 gap-1 text-[11px]">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Passed
        </Badge>
      ) : (
        <Badge variant="destructive" className="shrink-0 gap-1 text-[11px]">
          <XCircle className="h-3 w-3" aria-hidden="true" /> Failed
        </Badge>
      )}
    </div>
  );
}

export default function ExamResults() {
  const { examId = '' } = useParams<{ examId: string }>();
  const { data: exam } = useQuery({ queryKey: ['hr', 'exam', examId], queryFn: () => getExam(examId) });
  const { data: attempts, isLoading } = useQuery({
    queryKey: ['hr', 'exam', examId, 'attempts'],
    queryFn: () => listAttempts(examId),
  });

  const list = attempts ?? [];
  const passed = list.filter((a) => a.passed).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/hr/exams/${examId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to exam
        </Link>
        <h1 className="text-heading font-semibold text-foreground">Results — {exam?.title ?? 'Exam'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {list.length} attempt(s) · {passed} passed · pass ≥ {exam?.pass_threshold ?? '—'}%
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-foreground">Applicant attempts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No attempts yet — assign the exam and share the links.
            </p>
          ) : (
            list.map((a) => <Row key={a.attempt_id} a={a} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
