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
} from 'lucide-react';
import {
  listApplicants,
  uploadApplicant,
  updateApplicantStatus,
  rescoreApplicant,
  type Applicant,
  type ApplicantStatus,
} from '@/api/applicants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

function scoreTone(n: number | null): string {
  if (n === null) return 'text-muted-foreground';
  if (n >= 70) return 'text-emerald-600';
  if (n >= 45) return 'text-amber-600';
  return 'text-rose-600';
}

function recBadge(rec: string | null): { label: string; cls: string } {
  switch (rec) {
    case 'strong_fit':
      return { label: 'Strong fit', cls: 'bg-emerald-100 text-emerald-800' };
    case 'weak_fit':
      return { label: 'Weak fit', cls: 'bg-rose-100 text-rose-800' };
    case 'moderate_fit':
      return { label: 'Moderate fit', cls: 'bg-amber-100 text-amber-800' };
    default:
      return { label: 'Unscored', cls: 'bg-muted text-muted-foreground' };
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
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-3">
        {/* Score */}
        <div className="w-12 shrink-0 text-center">
          <div className={cn('text-xl font-bold leading-none', scoreTone(a.ats_overall))}>
            {a.ats_overall ?? '—'}
          </div>
          <div className="text-[10px] text-muted-foreground">ATS</div>
        </div>
        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{a.full_name}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', rec.cls)}>
              {rec.label}
            </span>
            {a.status === 'shortlisted' && (
              <Badge variant="default" className="text-[11px] gap-1">
                <Star className="h-3 w-3" aria-hidden="true" /> Shortlisted
              </Badge>
            )}
            {a.status === 'rejected' && (
              <Badge variant="outline" className="text-[11px] text-rose-600">
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
            className="text-emerald-700 hover:bg-emerald-50"
            disabled={statusMut.isPending || a.status === 'shortlisted'}
            onClick={() => statusMut.mutate('shortlisted')}
            aria-label="Shortlist"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-700 hover:bg-rose-50"
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
                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                    />
                  </div>
                  <span className="w-7 text-right text-xs font-medium">{v}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {a.ats_strengths && a.ats_strengths.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-emerald-700">Strengths</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                  {a.ats_strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.ats_concerns && a.ats_concerns.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-rose-700">Concerns</p>
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
export default function Applicants() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [level, setLevel] = useState('mid');
  const [jd, setJd] = useState('');

  const { data: applicants, isLoading } = useQuery({
    queryKey: ['hr', 'applicants'],
    queryFn: () => listApplicants(),
  });

  const uploadMut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file as File);
      fd.append('full_name', fullName.trim());
      fd.append('target_job_title', jobTitle.trim());
      fd.append('target_level', level);
      if (jd.trim()) fd.append('target_jd_text', jd.trim());
      return uploadApplicant(fd);
    },
    onSuccess: (a) => {
      toast.success(`${a.full_name} added — ATS ${a.ats_overall ?? '—'}/100`);
      setFile(null);
      setFullName('');
      setJobTitle('');
      setJd('');
      void qc.invalidateQueries({ queryKey: ['hr', 'applicants'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error('Choose a PDF resume.');
    if (!fullName.trim() || !jobTitle.trim()) return toast.error('Name and role are required.');
    uploadMut.mutate();
  }

  const list = applicants ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Resume screening</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload applicant resumes — each is AI-scored against the role, then ranked.
        </p>
      </div>

      {/* Upload */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
            Add applicant
          </CardTitle>
          <CardDescription>PDF resume, candidate name, and the role to screen for.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Candidate full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                aria-label="Candidate full name"
              />
              <Input
                placeholder="Role (e.g. Blockchain Engineer)"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                aria-label="Target role"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
                aria-label="Resume PDF"
              />
            </div>
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              placeholder="Job description (optional — improves scoring accuracy)"
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              aria-label="Job description"
            />
            <Button type="submit" disabled={uploadMut.isPending} className="gap-1.5">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {uploadMut.isPending ? 'Uploading & scoring…' : 'Upload & score'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Applicants ({list.length})
        </h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
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
