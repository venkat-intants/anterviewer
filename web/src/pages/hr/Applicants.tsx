// Applicants — HR resume screening dashboard (HR workflow Phase 1).
// Upload applicant resumes -> auto ATS score -> ranked list -> shortlist/reject.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Upload,
  FileSearch,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronDown,
  Star,
  FileText,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  listApplicants,
  bulkUploadApplicants,
  updateApplicantStatus,
  rescoreApplicant,
  type Applicant,
  type ApplicantStatus,
  type BulkUploadResult,
} from '@/api/applicants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const inputCls =
  'w-full rounded-[9px] border border-border bg-secondary px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

function scoreTone(n: number | null): string {
  if (n === null) return 'text-muted-foreground';
  if (n >= 70) return 'text-emerald-600';
  if (n >= 45) return 'text-amber-600';
  return 'text-rose-600';
}

type RecBadgeResult = { label: string; variant: 'success' | 'destructive' | 'warning' | 'secondary' };

function recBadge(rec: string | null): RecBadgeResult {
  switch (rec) {
    case 'strong_fit':
      return { label: 'Strong fit', variant: 'success' };
    case 'weak_fit':
      return { label: 'Weak fit', variant: 'destructive' };
    case 'moderate_fit':
      return { label: 'Moderate fit', variant: 'warning' };
    default:
      return { label: 'Unscored', variant: 'secondary' };
  }
}

const BREAKDOWN_LABELS: Record<string, string> = {
  skills_match: 'Skills',
  experience_relevance: 'Experience',
  education_fit: 'Education',
  role_alignment: 'Role alignment',
};

// ── Applicant row ────────────────────────────────────────────────────────────
function ApplicantRow({ a }: { a: Applicant }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const statusMut = useMutation({
    mutationFn: (status: ApplicantStatus) => updateApplicantStatus(a.id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['hr', 'applicants'] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });
  const rescoreMut = useMutation({
    mutationFn: () => rescoreApplicant(a.id),
    onSuccess: () => {
      toast.success('Rescored');
      void qc.invalidateQueries({ queryKey: ['hr', 'applicants'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Rescore failed'),
  });

  const rec = recBadge(a.ats_recommendation);

  return (
    <div className="rounded-xl border border-border bg-card shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-center gap-3 p-3">
        {/* Score */}
        <div className="w-12 shrink-0 text-center">
          <div className={cn('text-xl font-semibold leading-none tracking-tight', scoreTone(a.ats_overall))}>
            {a.ats_overall ?? '—'}
          </div>
          <div className="text-[11px] text-muted-foreground">ATS</div>
        </div>
        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{a.full_name}</p>
            <Badge variant={rec.variant} className="text-[11px]">
              {rec.label}
            </Badge>
            {a.status === 'shortlisted' && (
              <Badge variant="success" className="text-[11px] gap-1">
                <Star className="h-3 w-3" aria-hidden="true" /> Shortlisted
              </Badge>
            )}
            {a.status === 'rejected' && (
              <Badge variant="destructive" className="text-[11px]">
                Rejected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {a.target_job_title} · {a.target_level}
            {a.email ? ` · ${a.email}` : ''}
          </p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            disabled={statusMut.isPending || a.status === 'shortlisted'}
            onClick={() => statusMut.mutate('shortlisted')}
            aria-label="Shortlist"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={statusMut.isPending || a.status === 'rejected'}
            onClick={() => statusMut.mutate('rejected')}
            aria-label="Reject"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle details"
            aria-expanded={open}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {/* Detail */}
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3 text-sm">
          {a.ats_summary && <p className="text-muted-foreground">{a.ats_summary}</p>}
          {a.ats_breakdown && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(a.ats_breakdown).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    {BREAKDOWN_LABELS[k] ?? k}
                  </span>
                  <div className="h-1.5 flex-1 rounded-full bg-border">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                    />
                  </div>
                  <span className="w-7 text-right text-xs font-medium text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {a.ats_strengths && a.ats_strengths.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-emerald-600">Strengths</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                  {a.ats_strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.ats_concerns && a.ats_concerns.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-rose-600">Concerns</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                  {a.ats_concerns.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={rescoreMut.isPending}
            onClick={() => rescoreMut.mutate()}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', rescoreMut.isPending && 'animate-spin')} />
            Re-score
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
const MAX_BULK_FILES = 25;

export default function Applicants() {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [jobTitle, setJobTitle] = useState('');
  const [level, setLevel] = useState('mid');
  const [jd, setJd] = useState('');
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState<BulkUploadResult | null>(null);

  const { data: applicants, isLoading } = useQuery({
    queryKey: ['hr', 'applicants'],
    queryFn: () => listApplicants(),
  });

  const uploadMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('target_job_title', jobTitle.trim());
      fd.append('target_level', level);
      if (jd.trim()) fd.append('target_jd_text', jd.trim());
      setProgress(0);
      return bulkUploadApplicants(fd, setProgress);
    },
    onSuccess: (res) => {
      setLastResult(res);
      if (res.created_count > 0) {
        toast.success(
          `${res.created_count} resume${res.created_count === 1 ? '' : 's'} added & scored` +
            (res.failed_count > 0 ? ` · ${res.failed_count} skipped` : ''),
        );
      } else {
        toast.error('No resumes could be processed — see details below.');
      }
      setFiles([]);
      setJd('');
      void qc.invalidateQueries({ queryKey: ['hr', 'applicants'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const incoming = Array.from(selected).filter((f) => f.type === 'application/pdf');
    setFiles((prev) => {
      // de-dupe by name+size, cap at MAX_BULK_FILES
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      if (merged.length > MAX_BULK_FILES) {
        toast.error(`Max ${MAX_BULK_FILES} resumes per batch — extra files ignored.`);
      }
      return merged.slice(0, MAX_BULK_FILES);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return toast.error('Choose one or more PDF resumes.');
    if (!jobTitle.trim()) return toast.error('The role to screen for is required.');
    uploadMut.mutate();
  }

  const list = applicants ?? [];
  const pending = uploadMut.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading font-semibold text-foreground">Resume screening</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop in many resumes at once — each candidate&apos;s name &amp; email are read
          straight from the resume, AI-scored against the role, then ranked.
        </p>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-foreground">
            <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
            Bulk upload resumes
          </CardTitle>
          <CardDescription>
            Pick the role once, then select up to {MAX_BULK_FILES} PDF resumes — names are
            extracted automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Role (e.g. Blockchain Engineer)"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                aria-label="Target role"
              />
              <select
                className={inputCls}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                aria-label="Experience level"
              >
                <option value="entry">Entry level</option>
                <option value="mid">Mid level</option>
                <option value="senior">Senior level</option>
              </select>
            </div>

            {/* File picker */}
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed',
                'border-border bg-muted/40 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-accent',
              )}
            >
              <FileText className="h-6 w-6 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">
                Click to choose PDF resumes
              </span>
              <span className="text-xs text-muted-foreground">
                Select multiple files · up to {MAX_BULK_FILES} per batch
              </span>
              <input
                type="file"
                accept="application/pdf"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = ''; // allow re-picking the same file
                }}
                aria-label="Resume PDFs"
              />
            </label>

            {/* Selected files */}
            {files.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/40 p-2">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {files.length} resume{files.length === 1 ? '' : 's'} selected
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setFiles([])}
                  >
                    Clear all
                  </button>
                </div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}:${f.size}:${i}`}
                      className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-muted-foreground"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-muted-foreground/60">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        className="shrink-0 text-muted-foreground/60 hover:text-rose-600"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              placeholder="Job description (optional — applied to the whole batch, improves scoring accuracy)"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              aria-label="Job description"
            />

            {pending && (
              <div className="space-y-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-1.5 rounded-full bg-primary transition-all"
                    style={{ width: `${progress < 100 ? progress : 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {progress < 100
                    ? `Uploading ${progress}%…`
                    : `Scoring ${files.length || 'the'} resume${files.length === 1 ? '' : 's'} — this can take a moment…`}
                </p>
              </div>
            )}

            <Button type="submit" disabled={pending || files.length === 0} className="gap-1.5">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {pending
                ? 'Processing…'
                : `Upload & score${files.length > 0 ? ` ${files.length} resume${files.length === 1 ? '' : 's'}` : ''}`}
            </Button>
          </form>

          {/* Per-file failure summary from the last batch */}
          {lastResult && lastResult.failed_count > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {lastResult.failed_count} file{lastResult.failed_count === 1 ? '' : 's'} skipped
              </p>
              <ul className="space-y-0.5 text-amber-600">
                {lastResult.failed.map((f, i) => (
                  <li key={i} className="truncate">
                    <span className="font-medium">{f.filename}</span> — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-primary" aria-hidden="true" />
          Applicants ({list.length})
        </h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No applicants yet — upload a resume above to get started.
          </p>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
            className="space-y-2"
          >
            {list.map((a) => (
              <motion.div
                key={a.id}
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              >
                <ApplicantRow a={a} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
