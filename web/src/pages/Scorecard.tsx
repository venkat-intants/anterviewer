// Scorecard — full-screen results page (outside AppShell).
// Route: /scorecard/:scorecardId
// Redesigned on feat/ui-redesign-v2 — matches Landing/Login/Dashboard visual language.
// Uses: shadcn/ui Card/Badge/Button/Progress/Skeleton/Separator, recharts RadarChart,
// framer-motion, toast for errors, design tokens (bg-primary, bg-muted, border).

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  LayoutDashboard,
  History,
  ChevronDown,
  Info,
} from 'lucide-react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { getScorecard } from '@/api/scorecard';
import type { ScoreBreakdown, ImprovementItem } from '@/api/scorecard';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';

// ── Animation variants ─────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

// ── Constants ──────────────────────────────────────────────────────────────────

// Dimension labels are now translated via t() inside the component.
// This constant is kept as a type-safe key map only.
const DIMENSION_LABEL_KEYS: Record<keyof ScoreBreakdown, string> = {
  communication: 'scorecard.dimensionCommunication',
  technical: 'scorecard.dimensionTechnical',
  problem_solving: 'scorecard.dimensionProblemSolving',
  confidence: 'scorecard.dimensionConfidence',
};

const DIMENSION_ORDER: Array<keyof ScoreBreakdown> = [
  'communication',
  'technical',
  'problem_solving',
  'confidence',
];

// ── Score helpers ──────────────────────────────────────────────────────────────

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score >= 8) return 'default';
  if (score >= 6) return 'secondary';
  return 'outline';
}

function scoreLabelKey(score: number): string {
  if (score >= 8) return 'scorecard.labelExcellent';
  if (score >= 6) return 'scorecard.labelGood';
  if (score >= 4) return 'scorecard.labelFair';
  return 'scorecard.labelNeedsWork';
}

function compositeColorClass(score: number): string {
  if (score >= 8) return 'text-green-600';
  if (score >= 6) return 'text-primary';
  if (score >= 4) return 'text-amber-500';
  return 'text-destructive';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ErrorState() {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 flex items-center justify-center px-4">
      <div
        role="alert"
        className="rounded-2xl border border-border bg-card shadow-sm p-8 max-w-md w-full text-center space-y-4"
      >
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 mx-auto">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold text-foreground">{t('scorecard.notAvailableTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('scorecard.notAvailableDesc')}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/history">{t('scorecard.backToHistory')}</Link>
        </Button>
      </div>
    </main>
  );
}

function ScoreBarRow({
  label,
  score,
  rationale,
}: {
  label: string;
  score: number;
  rationale?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pct = Math.round((score / 10) * 100);
  const panelId = `rationale-${label.replace(/\s+/g, '-').toLowerCase()}`;
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
          'transition-colors hover:bg-muted/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {label}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </span>
        <Badge variant={scoreVariant(score)} className="text-xs tabular-nums">
          {score} / 10
        </Badge>
      </button>

      <Progress value={pct} className="h-2" aria-label={`${label}: ${score} out of 10`} />

      {/* Rationale panel */}
      {open && (
        <div
          id={panelId}
          className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
        >
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            {t('scorecard.whyThisScore')}
          </p>
          <p className="text-sm leading-relaxed text-foreground">
            {hasRationale ? rationale : t('scorecard.rationaleUnavailable')}
          </p>
        </div>
      )}
    </div>
  );
}

interface RadarDataPoint {
  dimension: string;
  score: number;
  fullMark: number;
}

function DimensionRadar({ scores }: { scores: ScoreBreakdown }) {
  const { t } = useTranslation();
  const data: RadarDataPoint[] = DIMENSION_ORDER.map((key) => ({
    dimension: t(DIMENSION_LABEL_KEYS[key]).replace(' Knowledge', '').replace(' Solving', '\nSolving'),
    score: scores[key],
    fullMark: 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: 12,
          }}
          formatter={(value) => [`${Number(value ?? 0)} / 10`, 'Score']}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function StrengthItem({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5">
      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </li>
  );
}

function ImprovementCard({ item }: { item: ImprovementItem }) {
  return (
    <li className="flex gap-2.5">
      <TrendingUp className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm text-foreground leading-relaxed">
        <span className="font-semibold">{item.area}:</span>{' '}
        <span className="text-muted-foreground">{item.suggestion}</span>
      </p>
    </li>
  );
}

// ── Skeleton placeholder ───────────────────────────────────────────────────────

function ScorecardSkeleton() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 py-10 px-4">
      {/* Screen-reader status announcement — keeps the existing test contract */}
      <span
        role="status"
        aria-label="Loading scorecard"
        aria-live="polite"
        className="sr-only"
      />
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48 rounded mx-auto" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </main>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Scorecard() {
  const { t } = useTranslation();
  const { scorecardId } = useParams<{ scorecardId: string }>();
  const { accessToken } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['scorecard', scorecardId],
    queryFn: () => {
      if (!scorecardId || !accessToken) {
        throw new Error('Missing scorecard ID or access token');
      }
      return getScorecard(scorecardId, accessToken);
    },
    enabled: Boolean(scorecardId) && Boolean(accessToken),
    staleTime: 10 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  // Fire error toast once per distinct error transition — never on every render.
  useEffect(() => {
    if (isError) {
      toast.error('Could not load scorecard. Please try again.');
    }
  }, [isError]);

  if (isLoading) return <ScorecardSkeleton />;
  if (isError || !data) return <ErrorState />;

  const compositePct = Math.round((data.composite_score / 10) * 100);
  const colorClass = compositeColorClass(data.composite_score);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 py-10 px-4">
      {/* Subtle background orbs */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[40rem] w-[80rem] rounded-full bg-primary/4 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-violet-500/4 blur-2xl" />
      </div>

      {/* Page header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-2xl mx-auto mb-8"
      >
        {/* Back nav */}
        <nav className="flex items-center gap-3 mb-6" aria-label="Breadcrumb">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground -ml-2">
            <Link to="/history">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('nav.history')}
            </Link>
          </Button>
          <Separator orientation="vertical" className="h-4" />
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
            <Link to="/dashboard">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              {t('nav.dashboard')}
            </Link>
          </Button>
        </nav>

        <div className="text-center">
          <Badge variant="secondary" className="mb-3 gap-1.5 px-3 py-1 text-xs">
            <History className="h-3 w-3" aria-hidden="true" />
            {t('scorecard.badge')}
          </Badge>
          <h1 className="text-3xl font-bold text-foreground">{t('scorecard.title')}</h1>
        </div>
      </motion.header>

      {/* Content */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={stagger}
        className="max-w-2xl mx-auto space-y-5"
      >
        {/* Composite score card */}
        <motion.div variants={fadeUp}>
          <Card className="shadow-sm overflow-hidden">
            <CardContent className="pt-8 pb-6 text-center space-y-4">
              <h2
                id="composite-heading"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {t('scorecard.overallScore')}
              </h2>

              <div
                className={cn('text-6xl font-extrabold leading-none tabular-nums', colorClass)}
                aria-label={`Overall score: ${data.composite_score.toFixed(1)} out of 10`}
              >
                {data.composite_score.toFixed(1)}
              </div>
              <p className="text-sm text-muted-foreground">{t('scorecard.outOf10')}</p>

              <div className="mx-auto max-w-xs">
                <Progress
                  value={compositePct}
                  className="h-3"
                  aria-valuenow={data.composite_score}
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-label="Overall score progress"
                />
              </div>

              <Badge variant={scoreVariant(data.composite_score)} className="gap-1">
                {t(scoreLabelKey(data.composite_score))}
              </Badge>
            </CardContent>
          </Card>
        </motion.div>

        {/* Score breakdown — bar rows + radar chart */}
        <motion.div variants={fadeUp}>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('scorecard.scoreBreakdown')}</CardTitle>
              <p className="text-xs text-muted-foreground">{t('scorecard.tapForDetail')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Radar chart */}
              <DimensionRadar scores={data.scores} />

              <Separator />

              {/* Bar rows — each is clickable to reveal its rationale */}
              <div className="space-y-4">
                {DIMENSION_ORDER.map((key) => (
                  <ScoreBarRow
                    key={key}
                    label={t(DIMENSION_LABEL_KEYS[key])}
                    score={data.scores[key]}
                    rationale={data.rationale?.[key]}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Strengths */}
        {data.strengths.length > 0 && (
          <motion.div variants={fadeUp}>
            <Card className="shadow-sm border-green-200/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-green-100">
                    <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                  </span>
                  {t('scorecard.keyStrengths')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5" aria-label="Key strengths list">
                  {data.strengths.map((strength, idx) => (
                    <StrengthItem key={idx} text={strength} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Areas for improvement */}
        {data.improvements.length > 0 && (
          <motion.div variants={fadeUp}>
            <Card className="shadow-sm border-amber-200/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-amber-100">
                    <TrendingUp className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  </span>
                  {t('scorecard.areasForImprovement')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3" aria-label="Areas for improvement list">
                  {data.improvements.map((item, idx) => (
                    <ImprovementCard key={idx} item={item} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Summary */}
        <motion.div variants={fadeUp}>
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('scorecard.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Download PDF button */}
        {data.report_pdf_url && (
          <motion.div variants={fadeUp} className="flex justify-center pb-4">
            <Button asChild size="lg" className="gap-2 shadow-md shadow-primary/20">
              <a href={data.report_pdf_url} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('scorecard.downloadPdf')}
              </a>
            </Button>
          </motion.div>
        )}
      </motion.div>
    </main>
  );
}
