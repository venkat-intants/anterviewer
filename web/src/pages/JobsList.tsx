// JobsList — protected page inside AppShell; fetches GET /jobs; renders a grid
// of job cards. "Start Interview" is gated by DPDP Act 2023 consent (S3-011).
// Language picker persisted to localStorage ('intants:interview-language').
// AppShell provides the top bar — this page does NOT render its own header.

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { Briefcase, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useConsent } from '@/context/ConsentContext';
import { getJobs } from '@/api/jobs';
import { createSession } from '@/api/sessions';
import JobCard from '@/components/JobCard';
import ConsentModal from '@/components/ConsentModal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Language } from '@/types/interview';

const LANGUAGE_STORAGE_KEY = 'intants:interview-language';

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी (Hindi)' },
  { value: 'te', label: 'తెలుగు (Telugu)' },
];

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'entry', label: 'Entry Level' },
  { value: 'mid', label: 'Mid Level' },
  { value: 'senior', label: 'Senior Level' },
] as const;

type LevelFilter = '' | 'entry' | 'mid' | 'senior';

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

// ── Loading skeleton card ─────────────────────────────────────────────────────

function JobCardSkeleton() {
  return (
    <div
      className="rounded-lg border bg-card shadow-sm p-6 flex flex-col gap-4 animate-pulse"
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-4 w-3/4 rounded" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="space-y-2 flex-1">
        <Skeleton className="h-3 w-full rounded" />
        <Skeleton className="h-3 w-5/6 rounded" />
        <Skeleton className="h-3 w-2/3 rounded" />
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </div>
  );
}

// ── JobsList page ─────────────────────────────────────────────────────────────

export default function JobsList() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { consented, loading: consentLoading, recordConsent } = useConsent();

  // Language picker — persisted to localStorage
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'hi' || stored === 'te') return stored;
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, selectedLanguage);
  }, [selectedLanguage]);

  // Level filter (client-side only)
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('');

  // Pending job that was clicked while consent was needed
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  // Whether the consent modal is visible
  const [showConsent, setShowConsent] = useState(false);
  // In-flight state for POST /consent
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Banner shown after Decline
  const [showDeclineBanner, setShowDeclineBanner] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => {
      if (!accessToken) throw new Error('No access token');
      return getJobs(accessToken);
    },
    enabled: accessToken !== null,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const startInterviewMutation = useMutation({
    mutationFn: ({ jobId, language }: { jobId: string; language: Language }) => {
      if (!accessToken) return Promise.reject(new Error('No access token'));
      return createSession({ job_id: jobId, language }, accessToken);
    },
    onSuccess: (result) => {
      void navigate(`/interview/${result.session_id}`);
    },
  });

  /** Kick off the session once consent is confirmed */
  const proceedToSession = useCallback(
    (jobId: string) => {
      startInterviewMutation.mutate({ jobId, language: selectedLanguage });
    },
    [startInterviewMutation, selectedLanguage],
  );

  /** Called when a JobCard "Start Interview" button is clicked */
  const handleStartInterview = useCallback(
    (jobId: string) => {
      setShowDeclineBanner(false);
      setConsentError(null);

      if (consented === true) {
        // Already consented — go straight to session create
        proceedToSession(jobId);
      } else {
        // Need consent first: store the pending job and show the modal
        setPendingJobId(jobId);
        setShowConsent(true);
      }
    },
    [consented, proceedToSession],
  );

  /** User clicked "I Agree" in the modal */
  const handleAgree = useCallback(async () => {
    setIsSubmittingConsent(true);
    setConsentError(null);
    try {
      await recordConsent();
      setShowConsent(false);
      if (pendingJobId) {
        proceedToSession(pendingJobId);
        setPendingJobId(null);
      }
    } catch (err) {
      setConsentError(
        err instanceof Error ? err.message : 'Failed to record consent. Please try again.',
      );
    } finally {
      setIsSubmittingConsent(false);
    }
  }, [recordConsent, pendingJobId, proceedToSession]);

  /** User clicked "Decline" or pressed Esc in the modal */
  const handleDecline = useCallback(() => {
    setShowConsent(false);
    setPendingJobId(null);
    setConsentError(null);
    setShowDeclineBanner(true);
    void navigate('/jobs');
  }, [navigate]);

  // ── Loading state ───────────────────────────────────────────────────────────
  if (isLoading || consentLoading) {
    return (
      <div className="space-y-6">
        {/* Toolbar skeleton */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 w-44 rounded-md" />
          <Skeleton className="h-10 w-36 rounded-md" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
      >
        <p className="text-sm text-destructive flex-1">
          {error instanceof Error ? error.message : 'Failed to load jobs. Please try again.'}
        </p>
        <Button type="button" variant="destructive" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const allJobs = data?.items ?? [];
  const jobs = levelFilter === '' ? allJobs : allJobs.filter((j) => j.level === levelFilter);

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Decline banner ─────────────────────────────────────────────────── */}
      {showDeclineBanner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start justify-between gap-4 dark:border-amber-800 dark:bg-amber-950/40"
        >
          <p className="text-sm text-amber-800 dark:text-amber-300">
            You must consent to use the interview feature.
          </p>
          <button
            type="button"
            onClick={() => setShowDeclineBanner(false)}
            aria-label="Dismiss"
            className="shrink-0 rounded text-amber-600 hover:text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-amber-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </motion.div>
      )}

      {/* ── Session-start error banner ──────────────────────────────────────── */}
      {startInterviewMutation.isError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm text-destructive">
            {startInterviewMutation.error instanceof Error
              ? startInterviewMutation.error.message
              : 'Failed to start interview. Please try again.'}
          </p>
        </div>
      )}

      {/* ── Toolbar: language picker + level filter + count ─────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Interview language — native <select> so tests can use selectOptions()
            and toHaveValue(); styled to match the design system. */}
        <label
          htmlFor="interview-language"
          className="text-sm font-medium text-foreground shrink-0"
        >
          Interview language
        </label>
        <select
          id="interview-language"
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value as Language)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Level filter — native select so there are no Radix empty-value constraints */}
        <label htmlFor="level-filter" className="sr-only">
          Filter by level
        </label>
        <select
          id="level-filter"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {LEVEL_OPTIONS.map((opt) => (
            <option key={`level-${opt.label}`} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Count */}
        <p className="ml-auto text-sm text-muted-foreground">
          {jobs.length} position{jobs.length !== 1 ? 's' : ''}
          {levelFilter && <span className="ml-1 text-xs">(filtered from {allJobs.length})</span>}
        </p>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {jobs.length === 0 && (
        <div
          className={cn(
            'rounded-xl border border-dashed border-border bg-muted/30',
            'flex flex-col items-center justify-center py-20 px-6 text-center gap-4',
          )}
        >
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Briefcase className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No positions found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {levelFilter
                ? 'Try a different level filter or clear it to see all openings.'
                : 'No open positions are available at the moment.'}
            </p>
          </div>
          {levelFilter && (
            <Button type="button" variant="outline" size="sm" onClick={() => setLevelFilter('')}>
              Clear filter
            </Button>
          )}
        </div>
      )}

      {/* ── Job grid ────────────────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Job listings"
        >
          {jobs.map((job) => (
            <motion.li key={job.id} variants={fadeUp}>
              <JobCard
                job={job}
                onStartInterview={handleStartInterview}
                isStarting={
                  startInterviewMutation.isPending &&
                  startInterviewMutation.variables?.jobId === job.id
                }
              />
            </motion.li>
          ))}
        </motion.ul>
      )}

      {/* Consent gate modal — rendered outside the grid so it overlays everything */}
      {showConsent && (
        <ConsentModal
          onAgree={handleAgree}
          onDecline={handleDecline}
          isSubmitting={isSubmittingConsent}
          error={consentError}
        />
      )}
    </div>
  );
}
