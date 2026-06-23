// AdminJobJd — admin-only page for uploading a JD PDF to a specific job posting.
// Route: /admin/jd (gated by AdminRoute)
// Rebuilt on shadcn (Card, Select, Button, Skeleton). AppShell provides the top bar.
// Upload results and errors are surfaced via toast + inline result state.

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import { FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getJobs } from '@/api/jobs';
import { uploadJd } from '@/api/jd';
import { toast } from '@/lib/toast';
import FileUploadZone from '@/components/FileUploadZone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

const JD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

export default function AdminJobJd() {
  const { accessToken } = useAuth();
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
    error: jobsFetchError,
    refetch: refetchJobs,
  } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => {
      if (!accessToken) throw new Error('No access token');
      return getJobs(accessToken);
    },
    enabled: accessToken !== null,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const jobs = jobsData?.items ?? [];

  // Reset upload zone key when job changes so the component re-initialises
  const [uploadKey, setUploadKey] = useState(0);

  const handleJobChange = useCallback((value: string) => {
    setSelectedJobId(value);
    setUploadKey((k) => k + 1);
  }, []);

  const handleJdUpload = useCallback(
    (file: File, onProgress: (pct: number) => void) => {
      if (!accessToken) return Promise.reject(new Error('No access token'));
      if (!selectedJobId) return Promise.reject(new Error('Select a job first'));
      return uploadJd(selectedJobId, file, accessToken, onProgress).then((result) => {
        toast.success(
          `JD processed — ${result.text_length.toLocaleString()} characters extracted.`,
        );
        return { text_length: result.text_length };
      });
    },
    [accessToken, selectedJobId],
  );

  const selectedJobTitle = jobs.find((j) => j.id === selectedJobId)?.title;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      className="space-y-6"
    >
      {/* Page heading */}
      <div>
        <h1 className="text-subheading font-semibold text-foreground">Upload Job Description</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          Select a job posting, then upload its PDF job description. The AI will use this to
          generate targeted interview questions.
        </p>
      </div>

      <Separator />

      {/* Main card */}
      <Card className="shadow-card transition-shadow hover:shadow-card-hover">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-body-lg text-foreground">
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            Job Description Upload
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            PDF only — maximum 10 MB. The document will be parsed and indexed for AI grounding.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* ── Job picker ─────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <label htmlFor="job-select" className="text-body-sm font-medium text-foreground">
              Job posting
            </label>

            {jobsLoading && (
              <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <div
                  className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                  role="status"
                  aria-label="Loading jobs"
                />
                <span>Loading jobs…</span>
                <Skeleton className="h-10 w-full rounded-md mt-1" />
              </div>
            )}

            {jobsError && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3"
              >
                <AlertCircle
                  className="h-5 w-5 text-destructive shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-sm text-destructive flex-1">
                  {jobsFetchError instanceof Error
                    ? jobsFetchError.message
                    : 'Failed to load jobs.'}
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void refetchJobs()}
                  className="shrink-0"
                >
                  Retry
                </Button>
              </div>
            )}

            {!jobsLoading && !jobsError && (
              <Select value={selectedJobId} onValueChange={handleJobChange}>
                <SelectTrigger id="job-select" aria-label="Select job posting" className="w-full">
                  <SelectValue placeholder="— select a job —" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* ── Upload zone ─────────────────────────────────────────────────── */}
          {selectedJobId ? (
            <div className="space-y-3">
              <p className="text-body-sm text-muted-foreground">
                JD document for{' '}
                <span className="font-medium text-foreground">{selectedJobTitle}</span>
              </p>
              <FileUploadZone
                key={uploadKey}
                label="Job Description"
                accept="application/pdf"
                maxBytes={JD_MAX_BYTES}
                onUpload={handleJdUpload}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-10 text-center">
              <FileText
                className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3"
                aria-hidden="true"
              />
              <p className="text-body-sm text-muted-foreground">
                Select a job above to enable JD upload
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
