// HRPipeline — single-table hiring funnel: resume → exam → interview → decision
// (HR workflow Phase 4). One row per applicant; HR makes the hire/reject call
// inline. Paginated, read-only aggregate from data_gateway. Field names + the
// POST decision verb match the frozen backend contract.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Star,
  BarChart3,
  ClipboardCheck,
  Video,
  Loader2,
} from 'lucide-react';
import {
  getPipeline,
  setApplicantDecision,
  type PipelineRow as Row,
  type PipelineStage,
  type ApplicantDecision,
} from '@/api/pipeline';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import HrAnalyticsPanel from './HRAnalytics';

const PAGE_SIZE = 50;

function scoreTone(n: number | null): string {
  if (n === null) return 'text-muted-foreground';
  if (n >= 70) return 'text-emerald-600';
  if (n >= 45) return 'text-amber-600';
  return 'text-rose-600';
}

function recBadge(rec: string | null): { label: string; cls: string } {
  switch (rec) {
    case 'strong_fit':
      return { label: 'Strong fit', cls: 'bg-emerald-100 text-emerald-800' };
    case 'weak_fit':
      return { label: 'Weak fit', cls: 'bg-rose-100 text-rose-800' };
    case 'moderate_fit':
      return { label: 'Moderate fit', cls: 'bg-amber-100 text-amber-800' };
    default:
      return { label: 'Unscored', cls: 'bg-muted text-muted-foreground' };
  }
}

function interviewBadge(s: string | null): { label: string; cls: string } {
  switch (s) {
    case 'completed':
      return { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800' };
    case 'consumed':
      return { label: 'In progress', cls: 'bg-sky-100 text-sky-800' };
    case 'revoked':
      return { label: 'Revoked', cls: 'bg-rose-100 text-rose-800' };
    case 'expired':
      return { label: 'Expired', cls: 'bg-zinc-200 text-zinc-700' };
    case 'invited':
      return { label: 'Invited', cls: 'bg-amber-100 text-amber-800' };
    default:
      return { label: 'Not invited', cls: 'bg-muted text-muted-foreground' };
  }
}

function statusPill(s: Row['status']): { label: string; cls: string } | null {
  switch (s) {
    case 'hired':
      return { label: 'Hired', cls: 'bg-emerald-100 text-emerald-800' };
    case 'rejected':
      return { label: 'Rejected', cls: 'bg-rose-100 text-rose-800' };
    case 'interviewed':
      return { label: 'Interviewed', cls: 'bg-amber-100 text-amber-800' };
    default:
      return null;
  }
}

const STAGE_TABS: { value: PipelineStage; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'exam_passed', label: 'Exam passed' },
  { value: 'interviewed', label: 'Interviewed' },
  { value: 'decided', label: 'Decided' },
];

function StageScore({
  value,
  tone,
  unit,
}: {
  value: number | string | null;
  tone: string;
  unit: string;
}) {
  return (
    <div className="w-12 shrink-0 text-center">
      <div className={cn('text-base font-bold leading-none', tone)}>{value ?? '—'}</div>
      <div className="text-[10px] text-muted-foreground">{unit}</div>
    </div>
  );
}

function PipelineRow({ a }: { a: Row }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState('');

  const decideMut = useMutation({
    mutationFn: (decision: ApplicantDecision) =>
      setApplicantDecision(a.applicant_id, decision, rationale),
    onSuccess: (_res, decision) => {
      toast.success(decision === 'hired' ? 'Applicant hired' : 'Applicant rejected');
      void qc.invalidateQueries({ queryKey: ['hr', 'pipeline'] });
      void qc.invalidateQueries({ queryKey: ['hr', 'analytics'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Decision failed'),
  });

  const rec = recBadge(a.ats_recommendation);
  const iv = interviewBadge(a.interview_status);
  const pill = statusPill(a.status);
  const canHire = a.status === 'shortlisted' || a.status === 'interviewed';
  const canReject = a.status === 'new' || a.status === 'shortlisted' || a.status === 'interviewed';

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-3">
        <StageScore value={a.ats_overall} tone={scoreTone(a.ats_overall)} unit="ATS" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{a.full_name}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', rec.cls)}>
              {rec.label}
            </span>
            {a.status === 'shortlisted' && (
              <Badge variant="default" className="gap-1 text-[11px]">
                <Star className="h-3 w-3" aria-hidden="true" /> Shortlisted
              </Badge>
            )}
            {pill && (
              <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', pill.cls)}>
                {pill.label}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {a.target_job_title} · {a.target_level}
          </p>
        </div>

        {/* Exam */}
        <div className="hidden items-center gap-1 sm:flex">
          <StageScore value={a.best_exam_percent} tone={scoreTone(a.best_exam_percent)} unit="exam %" />
          {a.exam_passed === true && (
            <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          )}
        </div>

        {/* Interview */}
        <div className="hidden items-center gap-1.5 md:flex">
          <StageScore
            value={a.interview_score !== null ? a.interview_score.toFixed(1) : null}
            tone={a.interview_score !== null ? 'text-emerald-600' : 'text-muted-foreground'}
            unit="/10"
          />
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', iv.cls)}>{iv.label}</span>
        </div>

        {/* Decision actions */}
        <div className="flex shrink-0 items-center gap-1">
          {canHire && (
            <Button
              variant="ghost"
              size="sm"
              className="text-emerald-700 hover:bg-emerald-50"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate('hired')}
              aria-label="Hire"
            >
              {decideMut.isPending && decideMut.variables === 'hired' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
          {canReject && (
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-700 hover:bg-rose-50"
              disabled={decideMut.isPending}
              onClick={() => decideMut.mutate('rejected')}
              aria-label="Reject"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle details"
            aria-expanded={open}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <span className="w-20 shrink-0 text-muted-foreground">ATS</span>
              <span className="font-medium">{a.ats_overall ?? '—'}/100</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', rec.cls)}>
                {rec.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-20 shrink-0 text-muted-foreground">Exam</span>
              <span className="font-medium">{a.best_exam_percent ?? '—'}%</span>
              <span className="text-muted-foreground">
                {a.total_exam_attempts > 0
                  ? `${a.total_exam_attempts} attempt${a.total_exam_attempts === 1 ? '' : 's'} · ${
                      a.exam_passed ? 'passed' : 'not passed'
                    }`
                  : 'no exam'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <span className="w-20 shrink-0 text-muted-foreground">Interview</span>
              <span className="font-medium">
                {a.interview_score !== null ? `${a.interview_score.toFixed(1)}/10` : '—'}
              </span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', iv.cls)}>
                {iv.label}
              </span>
              {a.scorecard_id && (
                <Link to={`/scorecard/${a.scorecard_id}`}>
                  <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]">
                    <BarChart3 className="h-3 w-3" aria-hidden="true" /> Scorecard
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {(canHire || canReject) && (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="block text-xs font-semibold text-foreground">
                Hire decision
                <span className="ml-1 font-normal text-muted-foreground">
                  (rationale optional, logged for audit)
                </span>
              </label>
              <textarea
                className="min-h-[40px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Why this decision? (optional)…"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                aria-label="Decision rationale"
              />
              <div className="flex gap-2">
                {canHire && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={decideMut.isPending}
                    onClick={() => decideMut.mutate('hired')}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Hire
                  </Button>
                )}
                {canReject && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-rose-700"
                    disabled={decideMut.isPending}
                    onClick={() => decideMut.mutate('rejected')}
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HRPipeline() {
  const [stage, setStage] = useState<PipelineStage>('all');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'pipeline', stage, offset],
    queryFn: () => getPipeline({ stage, limit: PAGE_SIZE, offset }),
  });

  const items = data?.items ?? [];
  const count = data?.count ?? 0;

  function pickStage(s: PipelineStage) {
    setStage(s);
    setOffset(0);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <TrendingUp className="h-6 w-6 text-primary" aria-hidden="true" />
          Hiring pipeline
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every candidate, end to end — resume → exam → interview → decision. Hire or reject
          shortlisted and interviewed candidates.
        </p>
      </div>

      <HrAnalyticsPanel />

      <div className="flex flex-wrap gap-1.5">
        {STAGE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => pickStage(t.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              stage === t.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Video className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Candidates ({count})
        </h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {stage === 'all'
              ? 'No candidates yet — screen resumes to start the pipeline.'
              : 'No candidates at this stage.'}
          </p>
        ) : (
          <>
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
              className="space-y-2"
            >
              {items.map((a) => (
                <motion.div
                  key={a.applicant_id}
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                >
                  <PipelineRow a={a} />
                </motion.div>
              ))}
            </motion.div>

            {count > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-2 text-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, count)} of {count}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= count}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
