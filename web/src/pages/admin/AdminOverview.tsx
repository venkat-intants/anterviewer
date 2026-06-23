// AdminOverview — admin KPI tile page.
// Route: /admin/overview (inside AdminRoute + AppShell)
// Tiles: total candidates, total/completed interviews, completion rate,
//        avg composite score, avg duration, today / 7d / 30d counts.
// Charts: daily trends line chart + score distribution bar chart.

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import {
  Users,
  ClipboardList,
  CheckCircle2,
  TrendingUp,
  Clock,
  CalendarDays,
  AlertCircle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { getOverview, getTrends, getScoreDistribution } from '@/api/admin';
import type { TrendItem, ScoreBucket } from '@/api/admin';
import { toast } from '@/lib/toast';
import { formatDuration } from '@/lib/formatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Animation variants ─────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtScore(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function fmtDurationSecs(seconds: number | null): string {
  if (seconds === null) return '—';
  return formatDuration(Math.round(seconds));
}

// ── Stat tile ──────────────────────────────────────────────────────────────────

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  loading?: boolean;
  accent?: string;
}

function StatTile({ icon, label, value, sub, loading, accent }: StatTileProps) {
  return (
    <Card className={cn('transition-shadow hover:shadow-card-hover', accent)}>
      <CardContent className="pt-6 pb-5 flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted-foreground font-medium uppercase tracking-wide mb-1.5">
            {label}
          </p>
          {loading ? (
            <Skeleton className="h-8 w-20 rounded" />
          ) : (
            <p className="text-heading font-semibold text-foreground leading-none tabular-nums">{value}</p>
          )}
          {sub && !loading && (
            <p className="mt-1.5 text-caption text-muted-foreground">{sub}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Trend line chart ───────────────────────────────────────────────────────────

function TrendsChart({ items }: { items: TrendItem[] }) {
  // Format date labels to "DD MMM"
  const data = items.map((item) => ({
    ...item,
    label: new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#707070', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#707070', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: '#e8e8ed' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e8e8ed',
            borderRadius: '10px',
            fontSize: 12,
            color: '#1d1d1f',
          }}
          formatter={(value, name) => {
            if (name === 'interview_count') return [value ?? 0, 'Interviews'];
            return [`${Number(value ?? 0)} / 10`, 'Avg Score'];
          }}
        />
        <Line
          type="monotone"
          dataKey="interview_count"
          stroke="#0071e3"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#0071e3', stroke: '#ffffff' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Score distribution bar chart ───────────────────────────────────────────────

function DistributionChart({ buckets }: { buckets: ScoreBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={buckets} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#707070', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: '#707070', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: 'rgb(60 131 246 / 0.06)' }}
          contentStyle={{
            background: '#ffffff',
            border: '1px solid #e8e8ed',
            borderRadius: '10px',
            fontSize: 12,
            color: '#1d1d1f',
          }}
          formatter={(value) => [value ?? 0, 'Interviews']}
        />
        <Bar
          dataKey="count"
          fill="#0071e3"
          fillOpacity={0.85}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Chart skeleton ─────────────────────────────────────────────────────────────

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

// ── AdminOverview page ─────────────────────────────────────────────────────────

export default function AdminOverview() {
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    error: overviewErr,
  } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getOverview,
    staleTime: 2 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const { data: trendsData, isLoading: trendsLoading } = useQuery({
    queryKey: ['admin', 'trends'],
    queryFn: () => getTrends(),
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const { data: distData, isLoading: distLoading } = useQuery({
    queryKey: ['admin', 'score-distribution'],
    queryFn: getScoreDistribution,
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  useEffect(() => {
    if (overviewError) {
      toast.error(
        overviewErr instanceof Error ? overviewErr.message : 'Failed to load overview data.',
      );
    }
  }, [overviewError, overviewErr]);

  const loading = overviewLoading;

  if (overviewError && !loading) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center py-24 gap-4 text-center"
      >
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>
        <p className="font-semibold text-foreground">Failed to load overview</p>
        <p className="text-body-sm text-muted-foreground">
          {overviewErr instanceof Error ? overviewErr.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-8">
      {/* Page heading */}
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform Overview</h1>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Aggregate KPIs across all candidates and interview sessions.
        </p>
      </motion.div>

      {/* KPI tiles — primary */}
      <motion.div
        variants={fadeUp}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="overview-tiles"
      >
        <StatTile
          icon={<Users className="h-5 w-5" />}
          label="Total Candidates"
          value={loading ? null : (overview?.total_candidates ?? 0).toLocaleString()}
          loading={loading}
        />
        <StatTile
          icon={<ClipboardList className="h-5 w-5" />}
          label="Total Interviews"
          value={loading ? null : (overview?.total_interviews ?? 0).toLocaleString()}
          loading={loading}
        />
        <StatTile
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Completed"
          value={loading ? null : (overview?.completed_interviews ?? 0).toLocaleString()}
          sub={loading ? undefined : `${fmtPct(overview?.completion_rate ?? 0)} completion rate`}
          loading={loading}
        />
        <StatTile
          icon={<TrendingUp className="h-5 w-5" />}
          label="Avg Composite Score"
          value={loading ? null : fmtScore(overview?.avg_composite_score ?? null)}
          sub="out of 10"
          loading={loading}
        />
        <StatTile
          icon={<Clock className="h-5 w-5" />}
          label="Avg Duration"
          value={loading ? null : fmtDurationSecs(overview?.avg_duration_seconds ?? null)}
          loading={loading}
        />
        <StatTile
          icon={<CalendarDays className="h-5 w-5" />}
          label="Activity"
          value={
            loading ? null : (
              <span className="text-heading">
                <span className="font-semibold">{overview?.interviews_today ?? 0}</span>
                <span className="text-body-sm text-muted-foreground font-normal"> today</span>
              </span>
            )
          }
          sub={
            loading
              ? undefined
              : `${overview?.interviews_last_7d ?? 0} last 7d · ${overview?.interviews_last_30d ?? 0} last 30d`
          }
          loading={loading}
        />
      </motion.div>

      {/* Charts row */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily trends */}
        <Card className="shadow-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Daily Interview Volume (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <ChartSkeleton height={200} />
            ) : trendsData && trendsData.items.length > 0 ? (
              <TrendsChart items={trendsData.items} />
            ) : (
              <div className="flex items-center justify-center h-[200px] text-body-sm text-muted-foreground">
                No trend data available.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Score distribution */}
        <Card className="shadow-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <ChartSkeleton height={180} />
            ) : distData ? (
              <>
                <DistributionChart buckets={distData.buckets} />
                {/* Per-axis averages row */}
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-caption text-muted-foreground">
                  <span>Communication avg: <strong className="text-foreground font-semibold">{fmtScore(distData.avg_communication)}</strong></span>
                  <span>Technical avg: <strong className="text-foreground font-semibold">{fmtScore(distData.avg_technical)}</strong></span>
                  <span>Problem Solving avg: <strong className="text-foreground font-semibold">{fmtScore(distData.avg_problem_solving)}</strong></span>
                  <span>Confidence avg: <strong className="text-foreground font-semibold">{fmtScore(distData.avg_confidence)}</strong></span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[180px] text-body-sm text-muted-foreground">
                No distribution data available.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
