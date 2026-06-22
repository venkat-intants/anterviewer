// HRAnalytics — company-scoped hiring funnel panel (HR workflow Phase 4).
// Funnel metric tiles + a horizontal funnel bar chart (recharts — existing dep).
// Default export = the panel (embeddable on /hr/pipeline); named HRAnalyticsPage
// = the standalone /hr/analytics route. Field names match the backend contract
// ({ funnel, averages }).

import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import { Users, Star, ClipboardCheck, Video, Trophy, BarChart3 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { getHrAnalytics, type HrAnalytics } from '@/api/pipeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

const PALETTE = ['hsl(var(--primary))', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b'];

function fmtScore(v: number | null | undefined, max: number): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(max === 10 ? 1 : 0)}${max === 10 ? '/10' : ''}`;
}

function rate(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function MetricTile({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-start gap-3 pb-3 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="h-6 w-12 rounded" />
          ) : (
            <p className="text-xl font-bold leading-none text-foreground">{value}</p>
          )}
          {sub && !loading && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelChart({ a }: { a: HrAnalytics }) {
  const f = a.funnel;
  const data = [
    { stage: 'Applicants', count: f.total_applicants },
    { stage: 'Shortlisted', count: f.shortlisted },
    { stage: 'Exam passed', count: f.exam_passed },
    { stage: 'Interviewed', count: f.interview_completed },
    { stage: 'Hired', count: f.hired },
  ];
  if (!data.some((d) => d.count > 0)) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No pipeline data yet.</p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="stage"
          width={84}
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: 12,
          }}
          formatter={(value) => [value ?? 0, 'Candidates']}
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function HRAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'analytics'],
    queryFn: () => getHrAnalytics(),
    staleTime: 60_000,
  });
  const f = data?.funnel;
  const avg = data?.averages;

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-4">
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          icon={<Users className="h-4 w-4" />}
          label="Applicants"
          value={f?.total_applicants ?? 0}
          sub={avg ? `avg ATS ${fmtScore(avg.avg_ats, 100)}` : undefined}
          loading={isLoading}
        />
        <MetricTile
          icon={<Star className="h-4 w-4" />}
          label="Shortlisted"
          value={f?.shortlisted ?? 0}
          sub={f ? `${rate(f.shortlisted, f.total_applicants)} of applicants` : undefined}
          loading={isLoading}
        />
        <MetricTile
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Exam passed"
          value={f?.exam_passed ?? 0}
          sub={f ? `${rate(f.exam_passed, f.exam_taken)} pass rate` : undefined}
          loading={isLoading}
        />
        <MetricTile
          icon={<Video className="h-4 w-4" />}
          label="Interviewed"
          value={f?.interview_completed ?? 0}
          sub={avg ? `avg ${fmtScore(avg.avg_interview_composite, 10)}` : undefined}
          loading={isLoading}
        />
        <MetricTile
          icon={<Trophy className="h-4 w-4" />}
          label="Hired"
          value={f?.hired ?? 0}
          sub={f ? `${rate(f.hired, f.interview_completed)} of interviewed` : undefined}
          loading={isLoading}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Hiring funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[220px] w-full rounded-lg" />
            ) : data ? (
              <FunnelChart a={data} />
            ) : null}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

export function HRAnalyticsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Hiring analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your company&apos;s funnel — counts at every stage and average scores.
        </p>
      </div>
      <HRAnalytics />
    </div>
  );
}
