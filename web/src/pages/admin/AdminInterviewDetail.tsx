// AdminInterviewDetail — drill-in detail for one interview session.
// Route: /admin/interviews/:sessionId (inside AdminRoute + AppShell)
// Shows: candidate info, job, timings, status + scorecard (axes, strengths,
//        improvements, summary, PDF link).

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowLeft,
  User,
  Briefcase,
  Globe,
  Clock,
  CalendarDays,
  Download,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { getInterviewDetail } from '@/api/admin';
import type { ScorecardDetail, ProctoringSummary, IntegrityEventItem } from '@/api/admin';
import { toast } from '@/lib/toast';
import { formatDate, formatDuration, statusProps, languageLabel } from '@/lib/formatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtScore(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

function scoreColorClass(score: number): string {
  if (score >= 8) return 'text-emerald-600';
  if (score >= 6) return 'text-primary';
  if (score >= 4) return 'text-amber-600';
  return 'text-destructive';
}

function scoreBadgeVariant(
  score: number,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (score >= 8) return 'default';
  if (score >= 6) return 'secondary';
  return 'outline';
}

// ── Animation ──────────────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Axis definitions ───────────────────────────────────────────────────────────

type AxisKey = 'communication' | 'technical' | 'problem_solving' | 'confidence';

const AXIS_LABELS: Record<AxisKey, string> = {
  communication: 'Communication',
  technical: 'Technical',
  problem_solving: 'Problem Solving',
  confidence: 'Confidence',
};

const AXIS_ORDER: AxisKey[] = ['communication', 'technical', 'problem_solving', 'confidence'];

// ── Radar chart ────────────────────────────────────────────────────────────────

interface RadarDataPoint {
  dimension: string;
  score: number;
  fullMark: number;
}

function ScorecardRadar({ scorecard }: { scorecard: ScorecardDetail }) {
  const data: RadarDataPoint[] = AXIS_ORDER.map((key) => ({
    dimension: AXIS_LABELS[key],
    score: scorecard[key] ?? 0,
    fullMark: 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke="#e8e8ed" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: '#707070', fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e8e8ed',
            borderRadius: '10px',
            fontSize: 12,
            color: '#1d1d1f',
          }}
          formatter={(value) => [`${Number(value ?? 0)} / 10`, 'Score']}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#0071e3"
          fill="#0071e3"
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Score bar row ──────────────────────────────────────────────────────────────

function ScoreBarRow({
  label,
  score,
  rationale,
}: {
  label: string;
  score: number | null;
  rationale?: string;
}) {
  const [open, setOpen] = useState(false);
  if (score === null) return null;
  const pct = Math.round((score / 10) * 100);
  const panelId = `admin-rationale-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const hasRationale = Boolean(rationale && rationale.trim());

  return (
    <div className="space-y-1.5">
      {/* Clickable header — toggles the "why this score" panel */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded-md -mx-1 px-1 py-1 text-left',
          'transition-colors hover:bg-muted/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        )}
      >
        <span className="flex items-center gap-1.5 text-body-sm font-medium text-foreground">
          {label}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </span>
        <Badge variant={scoreBadgeVariant(score)} className="text-xs tabular-nums">
          {fmtScore(score)} / 10
        </Badge>
      </button>

      <Progress
        value={pct}
        className="h-2"
        aria-label={`${label}: ${fmtScore(score)} out of 10`}
      />

      {open && (
        <div id={panelId} className="mt-1 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            Why this score
          </p>
          <p className="text-body-sm leading-relaxed text-muted-foreground">
            {hasRationale
              ? rationale
              : 'A detailed rationale is not available for this scorecard (it was scored before per-aspect explanations were added).'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Integrity (proctoring) panel ─────────────────────────────────────────────

const INTEGRITY_LABELS: Record<string, string> = {
  gaze_away: 'Looked away from screen',
  face_absent: 'Face not visible',
  multiple_faces: 'Multiple faces detected',
  tab_blur: 'Switched tab / window',
  fullscreen_exit: 'Left fullscreen',
  copy: 'Copied text',
  paste: 'Pasted text',
  second_voice: 'Second voice detected',
  devtools_open: 'Developer tools opened',
};

function integrityColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-destructive';
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function IntegrityPanel({
  score,
  summary,
  events,
}: {
  score: number | null | undefined;
  summary: ProctoringSummary | null | undefined;
  events: IntegrityEventItem[] | undefined;
}) {
  const byType = summary?.by_type ?? {};
  const flaggedSeconds = summary?.flagged_seconds ?? {};
  const types = Object.keys(byType);
  const timeline = events ?? [];

  return (
    <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
      <CardHeader className="pb-3">
        <CardTitle className="text-subheading font-semibold text-foreground flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] bg-primary/10">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          </span>
          Interview Integrity
        </CardTitle>
        <p className="text-caption text-muted-foreground">
          AI-assisted flagging for human review — not an automated decision. Webcam
          signals are approximate; review the flags in context.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {score === null || score === undefined ? (
          <p className="text-body-sm text-muted-foreground">
            Proctoring was not enabled for this session.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className={cn('text-heading-lg font-semibold tabular-nums', integrityColor(score))}>
                {score}
              </span>
              <span className="text-body-sm text-muted-foreground">/ 100 integrity</span>
            </div>

            {types.length === 0 ? (
              <p className="text-body-sm text-emerald-600">No integrity flags were raised. ✓</p>
            ) : (
              <ul className="space-y-2" aria-label="Integrity flags">
                {types.map((t) => (
                  <li key={t} className="flex items-center justify-between gap-2 text-body-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                      {INTEGRITY_LABELS[t] ?? t}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {byType[t]}×
                      {flaggedSeconds[t] ? ` · ${flaggedSeconds[t]}s` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Time-ordered event timeline (most recent first) */}
            {timeline.length > 0 && (
              <div className="pt-1">
                <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                  Event timeline
                </p>
                <ul className="space-y-1 max-h-64 overflow-y-auto" aria-label="Integrity event timeline">
                  {timeline.map((ev, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-caption"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className="tabular-nums text-muted-foreground">{fmtClock(ev.started_at)}</span>
                        {INTEGRITY_LABELS[ev.event_type] ?? ev.event_type}
                      </span>
                      {ev.duration_seconds != null && (
                        <span className="tabular-nums text-muted-foreground">{ev.duration_seconds}s</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Detail meta row ────────────────────────────────────────────────────────────

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-body-sm">
      <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-secondary text-foreground shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-caption text-muted-foreground font-medium">{label}</p>
        <p className="text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48 rounded" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

// ── AdminInterviewDetail page ──────────────────────────────────────────────────

export default function AdminInterviewDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'interview', sessionId],
    queryFn: () => {
      if (!sessionId) throw new Error('Missing session ID');
      return getInterviewDetail(sessionId);
    },
    enabled: Boolean(sessionId),
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load interview detail.',
      );
    }
  }, [isError, error]);

  if (isLoading) {
    return (
      <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-6">
        <motion.div variants={fadeUp}>
          <Skeleton className="h-9 w-48 rounded" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <DetailSkeleton />
        </motion.div>
      </motion.div>
    );
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center py-24 gap-4 text-center"
      >
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <p className="font-semibold text-foreground">Interview not found</p>
        <p className="text-body-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'The session could not be loaded.'}
        </p>
        <Button variant="outline" onClick={() => void navigate('/admin/interviews')}>
          Back to Interviews
        </Button>
      </div>
    );
  }

  const { label: statusLabel, variant: statusVariant } = statusProps(data.status);
  const sc = data.scorecard;

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-6">
      {/* Back nav */}
      <motion.div variants={fadeUp}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate('/admin/interviews')}
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
          aria-label="Back to interview list"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Interviews
        </Button>
      </motion.div>

      {/* Page heading */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-foreground">
            {data.candidate_name ?? data.candidate_email}
          </h1>
          <p className="mt-1.5 text-body-sm text-muted-foreground">{data.candidate_email}</p>
        </div>
        <Badge variant={statusVariant} className="text-sm px-3 py-1">
          {statusLabel}
        </Badge>
      </motion.div>

      {/* Session metadata card */}
      <motion.div variants={fadeUp}>
        <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
          <CardHeader className="pb-3">
            <CardTitle className="text-subheading font-semibold text-foreground">Session Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetaRow
              icon={<Briefcase className="h-4 w-4" />}
              label="Role"
              value={data.job_title ?? '—'}
            />
            <MetaRow
              icon={<Globe className="h-4 w-4" />}
              label="Language"
              value={languageLabel(data.language)}
            />
            <MetaRow
              icon={<Clock className="h-4 w-4" />}
              label="Duration"
              value={formatDuration(data.duration_seconds)}
            />
            <MetaRow
              icon={<CalendarDays className="h-4 w-4" />}
              label="Started"
              value={data.started_at ? formatDate(data.started_at) : '—'}
            />
            <MetaRow
              icon={<CalendarDays className="h-4 w-4" />}
              label="Completed"
              value={data.completed_at ? formatDate(data.completed_at) : '—'}
            />
            <MetaRow
              icon={<User className="h-4 w-4" />}
              label="Preferred Language"
              value={
                data.candidate_preferred_language
                  ? languageLabel(data.candidate_preferred_language)
                  : '—'
              }
            />
          </CardContent>
        </Card>
      </motion.div>

      {/* Scorecard */}
      {sc ? (
        <>
          {/* Composite score */}
          <motion.div variants={fadeUp}>
            <Card className="rounded-2xl bg-muted ring-1 ring-primary/10 shadow-elevated">
              <CardContent className="pt-8 pb-6 text-center space-y-4">
                <h2 className="text-caption font-semibold uppercase tracking-widest text-muted-foreground">
                  Overall Score
                </h2>
                <div
                  className={`text-display font-semibold leading-none tabular-nums ${sc.composite_score === null ? 'text-muted-foreground' : scoreColorClass(sc.composite_score)}`}
                  aria-label={`Overall score: ${fmtScore(sc.composite_score)} out of 10`}
                >
                  {fmtScore(sc.composite_score)}
                </div>
                <p className="text-body-sm text-muted-foreground">out of 10</p>
                <Progress
                  value={Math.round(((sc.composite_score ?? 0) / 10) * 100)}
                  className="mx-auto max-w-xs h-3"
                  aria-valuenow={sc.composite_score ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-label="Overall score progress"
                />
              </CardContent>
            </Card>
          </motion.div>

          {/* Score breakdown */}
          <motion.div variants={fadeUp}>
            <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
              <CardHeader className="pb-2">
                <CardTitle className="text-subheading font-semibold text-foreground">Score Breakdown</CardTitle>
                <p className="text-caption text-muted-foreground">
                  Click any aspect to see why it got this score.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ScorecardRadar scorecard={sc} />
                <Separator />
                <div className="space-y-4">
                  {AXIS_ORDER.map((key) => (
                    <ScoreBarRow
                      key={key}
                      label={AXIS_LABELS[key]}
                      score={sc[key]}
                      rationale={sc.rationale?.[key]}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Strengths */}
          {sc.strengths && sc.strengths.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
                <CardHeader className="pb-3">
                  <CardTitle className="text-subheading font-semibold text-foreground flex items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] bg-primary/10">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    </span>
                    Key Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5" aria-label="Key strengths">
                    {sc.strengths.map((s, idx) => (
                      <li key={idx} className="flex gap-2.5">
                        <CheckCircle2
                          className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <p className="text-body-sm text-muted-foreground leading-relaxed">{s}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Improvements */}
          {sc.improvements && sc.improvements.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
                <CardHeader className="pb-3">
                  <CardTitle className="text-subheading font-semibold text-foreground flex items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] bg-primary/10">
                      <TrendingUp className="h-4 w-4 text-amber-600" aria-hidden="true" />
                    </span>
                    Areas for Improvement
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2.5" aria-label="Areas for improvement">
                    {sc.improvements.map((item, idx) => (
                      <li key={idx} className="flex gap-2.5">
                        <TrendingUp
                          className="h-4 w-4 text-amber-600 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <p className="text-body-sm text-muted-foreground leading-relaxed">
                          <span className="font-semibold text-foreground">{item.area}:</span>{' '}
                          <span className="text-muted-foreground">{item.suggestion}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Summary */}
          {sc.summary && (
            <motion.div variants={fadeUp}>
              <Card className="rounded-2xl transition-shadow hover:shadow-card-hover">
                <CardHeader className="pb-3">
                  <CardTitle className="text-subheading font-semibold text-foreground">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-body-sm text-muted-foreground leading-relaxed">{sc.summary}</p>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* PDF download placeholder (admin_ops does not currently generate PDFs
              for admin use — PDF link would come from feedback_billing if wired) */}
          <motion.div variants={fadeUp} className="pb-4 text-center">
            <Button variant="outline" size="sm" disabled className="gap-2 opacity-60 cursor-not-allowed">
              <Download className="h-4 w-4" aria-hidden="true" />
              PDF Report (via feedback_billing)
            </Button>
            <p className="mt-1.5 text-caption text-muted-foreground">
              Full PDF is generated by feedback_billing — link when available.
            </p>
          </motion.div>
        </>
      ) : (
        <motion.div variants={fadeUp}>
          <Card className="rounded-2xl">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <TrendingUp className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
              </div>
              <p className="font-semibold text-foreground">No scorecard yet</p>
              <p className="text-body-sm text-muted-foreground">
                This session has not been scored. Scoring happens when the session completes.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Integrity / proctoring panel — shown regardless of scorecard presence */}
      <motion.div variants={fadeUp}>
        <IntegrityPanel
          score={data.integrity_score}
          summary={data.proctoring_summary}
          events={data.integrity_events}
        />
      </motion.div>
    </motion.div>
  );
}
