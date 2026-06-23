// Scorecard — full-screen results page (outside AppShell).
// Route: /scorecard/:scorecardId
// Premium LIGHT design: muted composite hero, white section cards,
// light-palette radar chart, semantic score-band bars.
// Uses: shadcn/ui Card/Badge/Button/Progress/Skeleton/Separator, recharts RadarChart,
// framer-motion, toast for errors.

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

function scoreVariant(
  score: number,
): 'success' | 'accent' | 'warning' | 'destructive' {
  if (score >= 8) return 'success';
  if (score >= 6) return 'accent';
  if (score >= 4) return 'warning';
  return 'destructive';
}

function scoreLabelKey(score: number): string {
  if (score >= 8) return 'scorecard.labelExcellent';
  if (score >= 6) return 'scorecard.labelGood';
  if (score >= 4) return 'scorecard.labelFair';
  return 'scorecard.labelNeedsWork';
}

// Tinted bar fill per score band — light semantic colors.
// emerald (strong), primary-blue (mid), amber (fair), rose (weak).
function scoreBarClass(score: number): string {
  if (score >= 8) return '[&>div]:bg-emerald-500';
  if (score >= 6) return '[&>div]:bg-primary';
  if (score >= 4) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-destructive';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ErrorState() {
  const { t } = useTranslation();
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div
        role="alert"
        className="rounded-2xl border border-border bg-white shadow-card p-8 max-w-md w-full text-center space-y-5"
      >
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 mx-auto">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <p className="text-body-lg font-semibold text-foreground">
            {t('scorecard.notAvailableTitle')}
          </p>
          <p className="mt-1.5 text-body-sm text-muted-foreground">{t('scorecard.notAvailableDesc')}</p>
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
          'w-full flex items-center justify-between gap-2 rounded-[9px] -mx-1.5 px-1.5 py-1 text-left',
          'transition-colors hover:bg-muted/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
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
        <Badge variant={scoreVariant(score)} className="tabular-nums">
          {score} / 10
        </Badge>
      </button>

      {/* Tinted competency bar — fill color tracks the score band */}
      <Progress
        value={pct}
        className={cn(
          'h-2 bg-border [&>div]:transition-all [&>div]:duration-500',
          scoreBarClass(score),
        )}
        aria-label={`${label}: ${score} out of 10`}
      />

      {/* Rationale panel */}
      {open && (
        <div
          id={panelId}
          className="mt-1.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3"
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            {t('scorecard.whyThisScore')}
          </p>
          <p className="text-body-sm leading-relaxed text-muted-foreground">
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
        <PolarGrid stroke="#e8e8ed" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: '#707070', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: 'rgba(60,131,246,0.15)' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e8e8ed',
            borderRadius: '10px',
            fontSize: 12,
            color: '#1d1d1f',
          }}
          formatter={(value) => [`${Number(value ?? 0)} / 10`, 'Score']}
        />
        {/* Signal-Blue series — the single chromatic accent on light */}
        <Radar
          name="Score"
          dataKey="score"
          stroke="#0071e3"
          fill="#0071e3"
          fillOpacity={0.14}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function StrengthItem({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-body-sm text-muted-foreground leading-relaxed">{text}</p>
    </li>
  );
}

function ImprovementCard({ item }: { item: ImprovementItem }) {
  return (
    <li className="flex gap-2.5">
      <TrendingUp className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-body-sm leading-relaxed">
        <span className="font-semibold text-foreground">{item.area}:</span>{' '}
        <span className="text-muted-foreground">{item.suggestion}</span>
      </p>
    </li>
  );
}

// ── Skeleton placeholder ───────────────────────────────────────────────────────

function ScorecardSkeleton() {
  return (
    <main className="min-h-screen bg-background py-10 px-4">
      {/* Screen-reader status announcement — keeps the existing test contract */}
      <span
        role="status"
        aria-label="Loading scorecard"
        aria-live="polite"
        className="sr-only"
      />
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48 rounded-full mx-auto" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
        <Skeleton className="h-40 w-full rounded-3xl" />
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

  return (
    <main className="min-h-screen bg-background py-10 px-4">
      {/* Page header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-4xl mx-auto mb-8"
      >
        {/* Back nav */}
        <nav className="flex items-center gap-3 mb-6" aria-label="Breadcrumb">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground -ml-2">
            <Link to="/history">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('nav.history')}
            </Link>
          </Button>
          <Separator orientation="vertical" className="h-4 bg-border" />
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
            <Link to="/dashboard">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              {t('nav.dashboard')}
            </Link>
          </Button>
        </nav>

        <div className="text-center">
          <Badge variant="accent" className="mb-4 gap-1.5 px-3 py-1">
            <History className="h-3 w-3" aria-hidden="true" />
            {t('scorecard.badge')}
          </Badge>
          <h1 className="text-heading font-semibold text-foreground">{t('scorecard.title')}</h1>
        </div>
      </motion.header>

      {/* Content */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={stagger}
        className="max-w-4xl mx-auto space-y-5"
      >
        {/* Composite score card — frost-tinted hero surface with a large score */}
        <motion.div variants={fadeUp}>
          <Card className="relative overflow-hidden border-primary/10 bg-muted shadow-elevated ring-1 ring-primary/10">
            {/* Subtle blue halo behind the number */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/8 blur-[80px]"
            />
            <CardContent className="relative pt-10 pb-8 text-center space-y-4">
              <h2
                id="composite-heading"
                className="text-caption font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {t('scorecard.overallScore')}
              </h2>

              <div className="flex items-baseline justify-center gap-1.5">
                <span
                  className="text-display font-semibold leading-none tabular-nums text-foreground"
                  aria-label={`Overall score: ${data.composite_score.toFixed(1)} out of 10`}
                >
                  {data.composite_score.toFixed(1)}
                </span>
                <span className="text-body-lg font-medium text-muted-foreground">
                  {t('scorecard.outOf10')}
                </span>
              </div>

              <div className="mx-auto max-w-xs">
                <Progress
                  value={compositePct}
                  className={cn(
                    'h-3 bg-border [&>div]:transition-all [&>div]:duration-700',
                    scoreBarClass(data.composite_score),
                  )}
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
          <Card className="transition-shadow hover:shadow-card-hover">
            <CardHeader className="pb-2">
              <CardTitle className="text-body-lg font-semibold text-foreground">
                {t('scorecard.scoreBreakdown')}
              </CardTitle>
              <p className="text-caption text-muted-foreground">{t('scorecard.tapForDetail')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Radar chart */}
              <DimensionRadar scores={data.scores} />

              <Separator className="bg-border" />

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
            <Card className="transition-shadow hover:shadow-card-hover">
              <CardHeader className="pb-3">
                <CardTitle className="text-body-lg font-semibold text-foreground flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] bg-emerald-50">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
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
            <Card className="transition-shadow hover:shadow-card-hover">
              <CardHeader className="pb-3">
                <CardTitle className="text-body-lg font-semibold text-foreground flex items-center gap-2.5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[9px] bg-amber-50">
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

        {/* Summary — frost-tinted feature surface for a calm closing read */}
        <motion.div variants={fadeUp}>
          <Card className="bg-muted border-primary/10 ring-1 ring-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-body-lg font-semibold text-foreground">
                {t('scorecard.summary')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-body-sm text-muted-foreground leading-relaxed">{data.summary}</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Download PDF button */}
        {data.report_pdf_url && (
          <motion.div variants={fadeUp} className="flex justify-center pb-4">
            <Button asChild size="lg" className="gap-2">
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
