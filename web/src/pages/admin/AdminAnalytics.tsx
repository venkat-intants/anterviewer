// AdminAnalytics — by-role bar chart, by-language breakdown, score distribution.
// Route: /admin/analytics (inside AdminRoute + AppShell)

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts';
import { getByRole, getByLanguage, getScoreDistribution } from '@/api/admin';
import { languageLabel } from '@/lib/formatters';
import { toast } from '@/lib/toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtScore(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

// Light categorical palette — Signal-Blue leads, cool secondaries follow.
// Deterministic by index so series colours stay stable across renders.
const PALETTE = [
  '#0071e3', // Signal-Blue (primary series)
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // rose
  '#06b6d4', // cyan
  '#ec4899', // pink
];

// Light tooltip styling for recharts surfaces.
const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid #e8e8ed',
  borderRadius: '10px',
  fontSize: 12,
  color: '#1d1d1f',
} as const;

const GRID_STROKE = '#e8e8ed';
const AXIS_TICK = { fill: '#707070', fontSize: 11 } as const;

// ── Animation ──────────────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Chart skeleton ─────────────────────────────────────────────────────────────

function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

// ── Empty chart state ──────────────────────────────────────────────────────────

function ChartEmpty({ height = 220 }: { height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 text-center"
      style={{ height }}
    >
      <BarChart3 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
      <p className="text-body-sm text-muted-foreground">No data available yet.</p>
    </div>
  );
}

// ── By-role bar chart ──────────────────────────────────────────────────────────

function ByRoleChart({
  data,
}: {
  data: { job_title: string; interview_count: number; avg_composite: number | null }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="job_title"
          width={130}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => {
            if (name === 'interview_count') return [value ?? 0, 'Interviews'];
            return [`${Number(value ?? 0)} / 10`, 'Avg Score'];
          }}
        />
        <Bar dataKey="interview_count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Avg score by role — grouped bar ───────────────────────────────────────────

function ByRoleScoreChart({
  data,
}: {
  data: {
    job_title: string;
    avg_composite: number | null;
    avg_communication: number | null;
    avg_technical: number | null;
    avg_problem_solving: number | null;
    avg_confidence: number | null;
  }[];
}) {
  const chartData = data.map((d) => ({
    name: d.job_title.length > 18 ? d.job_title.slice(0, 16) + '…' : d.job_title,
    Communication: d.avg_communication ?? 0,
    Technical: d.avg_technical ?? 0,
    'Problem Solving': d.avg_problem_solving ?? 0,
    Confidence: d.avg_confidence ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 10]}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [`${Number(value ?? 0).toFixed(2)} / 10`, name]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#707070' }}
        />
        <Bar dataKey="Communication" fill={PALETTE[0]} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
        <Bar dataKey="Technical" fill={PALETTE[1]} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
        <Bar dataKey="Problem Solving" fill={PALETTE[2]} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
        <Bar dataKey="Confidence" fill={PALETTE[3]} fillOpacity={0.8} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── By-language pie chart ──────────────────────────────────────────────────────

function ByLanguagePie({
  data,
}: {
  data: { language: string; interview_count: number; avg_composite: number | null }[];
}) {
  const pieData = data.map((d) => ({
    name: languageLabel(d.language),
    value: d.interview_count,
    avg: d.avg_composite,
  }));

  return (
    <div className="flex flex-col gap-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            outerRadius={80}
            dataKey="value"
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${Math.round((percent ?? 0) * 100)}%`
            }
            labelLine={false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _name, props) => [
              `${Number(value ?? 0)} interviews · avg ${fmtScore((props.payload as { avg?: number | null } | undefined)?.avg ?? null)} / 10`,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend / table */}
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={d.language} className="flex items-center justify-between text-body-sm">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: PALETTE[i % PALETTE.length] }}
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">{languageLabel(d.language)}</span>
            </div>
            <div className="flex items-center gap-4 text-muted-foreground tabular-nums">
              <span>{d.interview_count} interviews</span>
              <span>avg {fmtScore(d.avg_composite)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Score distribution chart (reused from overview, but with axis avg table) ──

function DistributionSection({
  buckets,
  avgCommunication,
  avgTechnical,
  avgProblemSolving,
  avgConfidence,
}: {
  buckets: { label: string; count: number }[];
  avgCommunication: number | null;
  avgTechnical: number | null;
  avgProblemSolving: number | null;
  avgConfidence: number | null;
}) {
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={buckets} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [value ?? 0, 'Interviews']}
          />
          <Bar dataKey="count" fill="#0071e3" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Per-axis averages */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-caption text-muted-foreground border-t border-border pt-3">
        <span>Communication: <strong className="text-foreground font-semibold">{fmtScore(avgCommunication)}</strong></span>
        <span>Technical: <strong className="text-foreground font-semibold">{fmtScore(avgTechnical)}</strong></span>
        <span>Problem Solving: <strong className="text-foreground font-semibold">{fmtScore(avgProblemSolving)}</strong></span>
        <span>Confidence: <strong className="text-foreground font-semibold">{fmtScore(avgConfidence)}</strong></span>
      </div>
    </div>
  );
}

// ── AdminAnalytics page ────────────────────────────────────────────────────────

export default function AdminAnalytics() {
  const {
    data: roleData,
    isLoading: roleLoading,
    isError: roleError,
    error: roleErr,
  } = useQuery({
    queryKey: ['admin', 'by-role'],
    queryFn: getByRole,
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const { data: langData, isLoading: langLoading } = useQuery({
    queryKey: ['admin', 'by-language'],
    queryFn: getByLanguage,
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
    if (roleError) {
      toast.error(
        roleErr instanceof Error ? roleErr.message : 'Failed to load analytics data.',
      );
    }
  }, [roleError, roleErr]);

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-8">
      {/* Page heading */}
      <motion.div variants={fadeUp}>
        <h1 className="text-heading font-semibold text-foreground">Analytics</h1>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Aggregated performance data broken down by role, language, and score distribution.
        </p>
      </motion.div>

      {/* Row 1: by-role count + by-role score breakdown */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Interview count by role */}
        <Card className="transition-shadow hover:shadow-card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Interviews by Role</CardTitle>
          </CardHeader>
          <CardContent>
            {roleLoading ? (
              <ChartSkeleton height={240} />
            ) : !roleData || roleData.length === 0 ? (
              <ChartEmpty height={240} />
            ) : (
              <ByRoleChart data={roleData} />
            )}
          </CardContent>
        </Card>

        {/* Axis-score averages by role */}
        <Card className="transition-shadow hover:shadow-card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Avg Axis Scores by Role</CardTitle>
          </CardHeader>
          <CardContent>
            {roleLoading ? (
              <ChartSkeleton height={240} />
            ) : !roleData || roleData.length === 0 ? (
              <ChartEmpty height={240} />
            ) : (
              <ByRoleScoreChart data={roleData} />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Row 2: by-language + score distribution */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By language */}
        <Card className="transition-shadow hover:shadow-card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Interviews by Language</CardTitle>
          </CardHeader>
          <CardContent>
            {langLoading ? (
              <ChartSkeleton height={200} />
            ) : !langData || langData.length === 0 ? (
              <ChartEmpty height={200} />
            ) : (
              <ByLanguagePie data={langData} />
            )}
          </CardContent>
        </Card>

        {/* Score distribution */}
        <Card className="transition-shadow hover:shadow-card-hover">
          <CardHeader className="pb-2">
            <CardTitle className="text-subheading font-semibold text-foreground">Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {distLoading ? (
              <ChartSkeleton height={180} />
            ) : !distData ? (
              <ChartEmpty height={180} />
            ) : (
              <DistributionSection
                buckets={distData.buckets}
                avgCommunication={distData.avg_communication}
                avgTechnical={distData.avg_technical}
                avgProblemSolving={distData.avg_problem_solving}
                avgConfidence={distData.avg_confidence}
              />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
