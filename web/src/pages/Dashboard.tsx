// Dashboard — protected page rebuilt inside AppShell.
// Shows: welcome header, stat cards (wired to real data), quick-actions,
// recent-interview preview (latest 3 sessions), and resume status card.
// Logout lives in the AppShell user menu — removed duplicate button here.

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import {
  PlayCircle,
  Briefcase,
  History,
  FileText,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { getMe, logout } from '@/api/auth';
import { listSessions } from '@/api/sessions';
import { listScorecards } from '@/api/scorecard';
import { getCurrentResume, uploadResume } from '@/api/resume';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import { formatDate, formatDuration, statusProps } from '@/lib/formatters';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import FileUploadZone from '@/components/FileUploadZone';
import { cn } from '@/lib/utils';

const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RECENT_COUNT = 3;

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  className?: string;
}

function StatCard({ icon, label, value, loading, className }: StatCardProps) {
  return (
    <Card className={cn('transition-shadow hover:shadow-card-hover', className)}>
      <CardContent className="pt-6 flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-foreground shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-caption text-muted-foreground font-medium uppercase tracking-wide mb-1.5">
            {label}
          </p>
          {loading ? (
            <Skeleton className="h-6 w-20 rounded" />
          ) : (
            <p className="text-subheading font-semibold text-foreground leading-none">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Quick action button ───────────────────────────────────────────────────────

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
}

function ActionButton({ icon, label, onClick, variant = 'default' }: ActionButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      onClick={onClick}
      className="flex-1 sm:flex-none gap-2"
    >
      {icon}
      {label}
    </Button>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { accessToken, user, clearAuth } = useAuth();
  const queryClient = useQueryClient();

  // Profile query
  const {
    data: me,
    isLoading: meLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => getMe(accessToken ?? undefined),
    enabled: accessToken !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Sessions query — used for interviews-taken count + recent preview
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', { page: 1, perPage: RECENT_COUNT }],
    queryFn: () => listSessions({ page: 1, perPage: RECENT_COUNT }),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  // Scorecards query — used for average composite score
  const { data: scorecardsData, isLoading: scorecardsLoading } = useQuery({
    queryKey: ['scorecards', { page: 1, perPage: 20 }],
    queryFn: () => listScorecards({ page: 1, perPage: 20 }),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  // Current resume query — for resume status card
  const { data: currentResume, isLoading: resumeLoading } = useQuery({
    queryKey: ['resume', 'current'],
    queryFn: getCurrentResume,
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const isLoading = meLoading;
  const statsLoading = sessionsLoading || scorecardsLoading || resumeLoading;

  // Computed stats
  const interviewsTaken = sessionsData?.total ?? 0;

  const avgScore = (() => {
    const items = scorecardsData?.items ?? [];
    const valid = items.filter((s) => s.composite_score !== null);
    if (valid.length === 0) return null;
    const sum = valid.reduce((acc, s) => acc + (s.composite_score ?? 0), 0);
    return (sum / valid.length).toFixed(1);
  })();

  const hasResume = Boolean(currentResume) || Boolean(me?.has_resume);
  const recentSessions = (sessionsData?.items ?? []).slice(0, RECENT_COUNT);

  // Logout mutation (kept for page-level error recovery only; primary logout is in AppShell)
  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      queryClient.clear();
      clearAuth();
      void navigate('/login', { replace: true });
    },
    onError: () => {
      toast.error(t('error.generic'));
    },
  });

  const handleResumeUpload = useCallback(
    (file: File, onProgress: (pct: number) => void) => {
      if (!accessToken) return Promise.reject(new Error('No access token'));
      return uploadResume(file, accessToken, onProgress).then((result) => {
        void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        void queryClient.invalidateQueries({ queryKey: ['resume', 'current'] });
        return { text_length: result.text_length };
      });
    },
    [accessToken, queryClient],
  );

  const isAdmin = (me?.roles ?? user?.roles ?? []).includes('admin');
  const displayName = me?.full_name ?? user?.full_name ?? t('app.loading');
  const userEmail = me?.email ?? user?.email ?? '';

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('dashboard.failedToLoadProfile')}
        </p>
        <Button variant="outline" onClick={() => logoutMutation.mutate()}>
          {t('dashboard.returnToLogin')}
        </Button>
      </div>
    );
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-8">
      {/* Welcome header */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-foreground">
            {isLoading ? (
              <Skeleton className="h-8 w-56 rounded" />
            ) : (
              t('dashboard.welcome', { name: displayName })
            )}
          </h1>
          {!isLoading && userEmail && (
            <p className="mt-1.5 text-body-sm text-muted-foreground">
              {t('dashboard.signedInAs')}{' '}
              <span className="font-medium text-foreground">{userEmail}</span>
            </p>
          )}
          {/* Role badges */}
          {!isLoading && (me?.roles ?? user?.roles ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(me?.roles ?? user?.roles ?? []).map((role) => (
                <Badge key={role} variant="secondary" className="text-xs">
                  {role}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {/* Admin shortcut — intentionally EN-only (admin UI is EN-only) */}
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => void navigate('/admin/jd')}>
            {t('dashboard.adminJdUpload')}
          </Button>
        )}
      </motion.div>

      {/* Stat cards row — wired to real query data */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<History className="h-5 w-5" />}
          label={t('dashboard.statInterviews')}
          value={statsLoading ? undefined : String(interviewsTaken)}
          loading={statsLoading}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('dashboard.statAvgScore')}
          value={statsLoading ? undefined : avgScore !== null ? `${avgScore} / 10` : '—'}
          loading={statsLoading}
        />
        <StatCard
          icon={
            hasResume ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <FileText className="h-5 w-5" />
            )
          }
          label={t('dashboard.statResumeStatus')}
          value={
            statsLoading
              ? undefined
              : hasResume
                ? t('dashboard.statResumeReady')
                : t('dashboard.statResumeMissing')
          }
          loading={statsLoading}
          className={hasResume ? 'border-emerald-300 bg-emerald-50/40' : undefined}
        />
      </motion.div>

      {/* Quick actions */}
      <motion.section variants={fadeUp} aria-labelledby="quick-actions-heading">
        <Card className="bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-body-lg text-foreground" id="quick-actions-heading">
              {t('dashboard.quickActionsTitle')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('dashboard.quickActionsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <ActionButton
                icon={<PlayCircle className="h-5 w-5" />}
                label={t('dashboard.startInterview')}
                onClick={() => void navigate('/start')}
              />
              <ActionButton
                icon={<Briefcase className="h-5 w-5" />}
                label={t('dashboard.browseJobs')}
                onClick={() => void navigate('/jobs')}
                variant="outline"
              />
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* Recent interviews + Resume — two-column at lg */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent interviews */}
        <Card className="bg-card">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-body-lg text-foreground">
                {t('dashboard.recentInterviewsTitle')}
              </CardTitle>
            </div>
            <Button variant="ghost" size="sm" asChild className="gap-1 text-muted-foreground">
              <Link to="/history">
                {t('dashboard.viewAllHistory')}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : recentSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <History className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-body-sm text-muted-foreground">
                  {t('dashboard.recentInterviewsEmpty')}
                </p>
              </div>
            ) : (
              <ul className="space-y-2" aria-label="Recent interview sessions">
                {recentSessions.map((session) => {
                  const { label, variant } = statusProps(session.status);
                  return (
                    <li
                      key={session.session_id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3 transition-colors hover:border-primary/30 hover:bg-accent"
                      data-testid={`recent-session-${session.session_id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-body-sm font-medium text-foreground truncate">
                          {session.job_title}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                          <Badge variant={variant} className="text-xs">
                            {label}
                          </Badge>
                          <span className="text-caption text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {formatDuration(session.duration_seconds)}
                          </span>
                          <span className="text-caption text-muted-foreground">
                            {formatDate(session.created_at)}
                          </span>
                        </div>
                      </div>
                      {session.scorecard_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="gap-1 text-primary shrink-0"
                        >
                          <Link to={`/scorecard/${session.scorecard_id}`}>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Resume card */}
        <Card className="bg-card">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-body-lg text-foreground">
                {t('dashboard.resumeCardTitle')}
              </CardTitle>
              <CardDescription className="mt-1 text-caption text-muted-foreground">
                {t('dashboard.resumeCardDesc')}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="gap-1 text-muted-foreground shrink-0"
            >
              <Link to="/resume">
                {t('nav.resume')}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading || resumeLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : (
              <FileUploadZone
                label="Resume"
                accept="application/pdf"
                maxBytes={RESUME_MAX_BYTES}
                onUpload={handleResumeUpload}
                existingFileLabel={
                  hasResume
                    ? currentResume?.filename ?? t('dashboard.resumeOnFile')
                    : undefined
                }
              />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
