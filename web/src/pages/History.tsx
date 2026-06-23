// History — Interview history page. Renders inside AppShell.
// Uses: useQuery(listSessions), responsive Table (desktop) / Card list (mobile),
// status Badge, pagination, empty state + loading skeletons, toast on error.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import {
  History as HistoryIcon,
  PlayCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  Globe,
} from 'lucide-react';
import { listSessions } from '@/api/sessions';
import type { SessionListItem } from '@/api/sessions';
import { toast } from '@/lib/toast';
import { formatDate, formatDuration, statusProps } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PER_PAGE = 10;

// languageLabel is a hook-based helper; defined inside the component tree instead.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
  en: 'history.langEnglish',
  hi: 'history.langHindi',
  te: 'history.langTelugu',
};

// ── Animation variants ─────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingSkeletons() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading interview history">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/40 py-20 text-center gap-4"
      data-testid="history-empty-state"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
        <HistoryIcon className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-body font-semibold text-foreground">{t('history.noInterviewsTitle')}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('history.noInterviewsDesc')}
        </p>
      </div>
      <Button asChild size="sm" className="gap-2 mt-1">
        <Link to="/start">
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {t('history.startFirstInterview')}
        </Link>
      </Button>
    </div>
  );
}

/** Desktop table row */
function SessionRow({ session }: { session: SessionListItem }) {
  const { t } = useTranslation();
  const { label, variant } = statusProps(session.status);
  const langKey = LANGUAGE_LABEL_KEYS[session.language];
  const langLabel = langKey ? t(langKey) : session.language.toUpperCase();

  return (
    <TableRow
      data-testid={`session-row-${session.session_id}`}
      className="border-border hover:bg-muted/40"
    >
      <TableCell className="font-medium text-foreground">{session.job_title}</TableCell>
      <TableCell className="text-muted-foreground text-body-sm tabular-nums">
        {formatDate(session.created_at)}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          {langLabel}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={variant} className="text-xs">
          {label}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground tabular-nums">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          {formatDuration(session.duration_seconds)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {session.scorecard_id ? (
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-primary hover:text-primary">
            <Link to={`/scorecard/${session.scorecard_id}`}>
              {t('history.viewScorecard')}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Mobile card */
function SessionCard({ session }: { session: SessionListItem }) {
  const { t } = useTranslation();
  const { label, variant } = statusProps(session.status);
  const langKey = LANGUAGE_LABEL_KEYS[session.language];
  const langLabel = langKey ? t(langKey) : session.language.toUpperCase();

  return (
    <motion.div variants={fadeUp}>
      <Card
        className="rounded-xl transition-shadow hover:shadow-card-hover"
        data-testid={`session-card-${session.session_id}`}
      >
        <CardContent className="py-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">{session.job_title}</p>
              <p className="text-caption text-muted-foreground mt-0.5 tabular-nums">
                {formatDate(session.created_at)}
              </p>
            </div>
            <Badge variant={variant} className="text-xs shrink-0">
              {label}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              {langLabel}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              {formatDuration(session.duration_seconds)}
            </span>
          </div>

          {session.scorecard_id && (
            <Button variant="outline" size="sm" asChild className="gap-1.5 self-start">
              <Link to={`/scorecard/${session.scorecard_id}`}>
                {t('history.viewScorecard')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** Pagination controls */
function PaginationBar({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-2" aria-label="Pagination">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={page <= 1}
        className="gap-1.5"
        aria-label={t('history.prevPage')}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        {t('history.prevPage')}
      </Button>
      <span className="text-body-sm text-muted-foreground tabular-nums">
        {t('history.pageOf', { page, total: totalPages })}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={page >= totalPages}
        className="gap-1.5"
        aria-label={t('history.nextPage')}
      >
        {t('history.nextPage')}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ── History page ───────────────────────────────────────────────────────────────

export default function History() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sessions', { page, perPage: PER_PAGE }],
    queryFn: () => listSessions({ page, perPage: PER_PAGE }),
    staleTime: 2 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  // Fire error toast once per distinct error object — never on every render.
  useEffect(() => {
    if (isError) {
      toast.error(error instanceof Error ? error.message : 'Failed to load interview history.');
    }
  }, [isError, error]);

  const sessions = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <motion.section
      aria-labelledby="history-heading"
      initial="hidden"
      animate="visible"
      variants={stagger}
      className="space-y-6"
    >
      {/* Page heading */}
      <motion.div variants={fadeUp}>
        <h1 id="history-heading" className="text-heading font-semibold text-foreground">
          {t('history.pageTitle')}
        </h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('history.pageDesc')}
        </p>
      </motion.div>

      {/* Content */}
      <motion.div variants={fadeUp}>
        {isLoading ? (
          <LoadingSkeletons />
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-body-lg font-semibold text-foreground">{t('history.sessionsTitle')}</CardTitle>
                  <CardDescription className="mt-0.5 text-muted-foreground">
                    {t('history.sessionsTotal', { count: total })}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnRole')}</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnDate')}</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnLanguage')}</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnStatus')}</TableHead>
                      <TableHead className="text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnDuration')}</TableHead>
                      <TableHead className="text-right text-muted-foreground text-xs uppercase tracking-wide">{t('history.columnScorecard')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session) => (
                      <SessionRow key={session.session_id} session={session} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div
                className={cn('md:hidden space-y-3 p-4', sessions.length > 0 && 'pt-0')}
                aria-label="Interview session list"
              >
                {sessions.map((session) => (
                  <SessionCard key={session.session_id} session={session} />
                ))}
              </div>
            </CardContent>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 pb-5">
                <PaginationBar
                  page={page}
                  totalPages={totalPages}
                  onPrev={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                />
              </div>
            )}
          </Card>
        )}
      </motion.div>
    </motion.section>
  );
}
