// Resume — Resume manager page. Renders inside AppShell.
// Shows: current resume with "Current" badge + download,
// upload new version (FileUploadZone with progress),
// version list with set-as-current + delete (confirm Dialog) actions.
// All mutations use React Query optimistic invalidation.

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import {
  FileText,
  Download,
  Trash2,
  CheckCircle2,
  Upload,
  AlertCircle,
} from 'lucide-react';
import {
  listResumes,
  getCurrentResume,
  setCurrentResume,
  deleteResume,
  uploadResume,
} from '@/api/resume';
import type { ResumeVersionItem } from '@/api/resume';
import FileUploadZone from '@/components/FileUploadZone';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ── Constants ──────────────────────────────────────────────────────────────────

const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    <div className="space-y-4" aria-busy="true" aria-label="Loading resume data">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function EmptyState({ onUploadSuccess }: { onUploadSuccess: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handleUpload = useCallback(
    (file: File, onProgress: (pct: number) => void) => {
      return uploadResume(file, undefined, onProgress).then((result) => {
        void queryClient.invalidateQueries({ queryKey: ['resumes'] });
        void queryClient.invalidateQueries({ queryKey: ['resume', 'current'] });
        toast.success(t('resume.uploadedSuccess'));
        onUploadSuccess();
        return { text_length: result.text_length };
      });
    },
    [queryClient, onUploadSuccess, t],
  );

  return (
    <div
      className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/40 py-16 text-center gap-4"
      data-testid="resume-empty-state"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-secondary ring-1 ring-border">
        <FileText className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-body font-semibold text-foreground">{t('resume.noResumeTitle')}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('resume.noResumeDesc')}
        </p>
      </div>
      <div className="w-full max-w-sm px-4">
        <FileUploadZone
          label="Resume"
          accept="application/pdf"
          maxBytes={RESUME_MAX_BYTES}
          onUpload={handleUpload}
        />
      </div>
    </div>
  );
}

// Delete confirm dialog
interface DeleteDialogProps {
  open: boolean;
  filename: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteDialog({ open, filename, isPending, onConfirm, onCancel }: DeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resume.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('resume.deleteDesc', { filename })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            {t('resume.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? t('resume.deleting') : t('resume.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Single resume version row
interface ResumeVersionRowProps {
  item: ResumeVersionItem;
  onSetCurrent: (id: string) => void;
  onDelete: (item: ResumeVersionItem) => void;
  isSettingCurrent: boolean;
  isDeleting: boolean;
}

function ResumeVersionRow({
  item,
  onSetCurrent,
  onDelete,
  isSettingCurrent,
  isDeleting,
}: ResumeVersionRowProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-white p-4 transition-shadow hover:shadow-card-hover',
        item.is_current && 'border-primary/30 bg-muted ring-1 ring-primary/10',
      )}
      data-testid={`resume-version-${item.resume_id}`}
    >
      {/* File icon + info */}
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]',
            item.is_current
              ? 'bg-secondary text-foreground'
              : 'bg-secondary text-muted-foreground',
          )}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className="text-body-sm font-medium text-foreground truncate"
              title={item.filename}
            >
              {item.filename}
            </p>
            {item.is_current && (
              <Badge variant="accent" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {t('resume.currentBadge')}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t('resume.uploaded')} {formatDate(item.uploaded_at)} · {formatBytes(item.text_length)} {t('resume.extracted')}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {item.download_url && (
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <a href={item.download_url} download={item.filename} aria-label={`Download ${item.filename}`}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('resume.download')}
            </a>
          </Button>
        )}
        {!item.is_current && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSetCurrent(item.resume_id)}
            disabled={isSettingCurrent}
            aria-busy={isSettingCurrent}
            aria-label={`Set ${item.filename} as current resume`}
          >
            {isSettingCurrent ? t('resume.setting') : t('resume.setAsCurrent')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(item)}
          disabled={isDeleting}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${item.filename}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </motion.div>
  );
}

// ── Resume page ────────────────────────────────────────────────────────────────

export default function Resume() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<ResumeVersionItem | null>(null);

  // Queries
  const {
    data: resumes,
    isLoading: resumesLoading,
    isError: resumesError,
  } = useQuery({
    queryKey: ['resumes'],
    queryFn: listResumes,
    staleTime: 2 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const {
    data: currentResume,
    isLoading: currentLoading,
    isError: currentError,
  } = useQuery({
    queryKey: ['resume', 'current'],
    queryFn: getCurrentResume,
    staleTime: 2 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  const isLoading = resumesLoading || currentLoading;

  // Set-current mutation
  const setCurrentMutation = useMutation({
    mutationFn: (id: string) => setCurrentResume(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['resumes'] });
      void queryClient.invalidateQueries({ queryKey: ['resume', 'current'] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success(t('resume.setCurrentSuccess'));
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('resume.updateError'));
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteResume(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['resumes'] });
      void queryClient.invalidateQueries({ queryKey: ['resume', 'current'] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success(t('resume.deletedSuccess'));
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : t('resume.deleteError'));
      setDeleteTarget(null);
    },
  });

  // Upload handler (passed to FileUploadZone)
  const handleUpload = useCallback(
    (file: File, onProgress: (pct: number) => void) => {
      return uploadResume(file, undefined, onProgress).then((result) => {
        void queryClient.invalidateQueries({ queryKey: ['resumes'] });
        void queryClient.invalidateQueries({ queryKey: ['resume', 'current'] });
        void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        toast.success(t('resume.uploadedSuccess'));
        return { text_length: result.text_length };
      });
    },
    [queryClient, t],
  );

  // Fire error toast once per distinct error transition — never on every render.
  useEffect(() => {
    if (resumesError || currentError) {
      toast.error(t('resume.loadError'));
    }
  }, [resumesError, currentError, t]);

  const resumeList = resumes ?? [];
  const hasResumes = resumeList.length > 0;

  return (
    <motion.section
      aria-labelledby="resume-heading"
      initial="hidden"
      animate="visible"
      variants={stagger}
      className="space-y-6"
    >
      {/* Page heading */}
      <motion.div variants={fadeUp}>
        <h1 id="resume-heading" className="text-heading font-semibold text-foreground">
          {t('resume.pageTitle')}
        </h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('resume.pageDesc')}
        </p>
      </motion.div>

      {isLoading ? (
        <LoadingSkeletons />
      ) : !hasResumes ? (
        <motion.div variants={fadeUp}>
          <EmptyState onUploadSuccess={() => void queryClient.invalidateQueries({ queryKey: ['resumes'] })} />
        </motion.div>
      ) : (
        <>
          {/* Current resume highlight */}
          {currentResume && (
            <motion.div variants={fadeUp}>
              <Card className="shadow-elevated border-primary/25 bg-muted ring-1 ring-primary/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-body-lg font-semibold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    {t('resume.activeResumeTitle')}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {t('resume.activeResumeDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-secondary text-foreground">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-body-sm font-medium text-foreground truncate"
                          title={currentResume.filename}
                        >
                          {currentResume.filename}
                        </p>
                        <p className="text-caption text-muted-foreground mt-0.5">
                          {t('resume.uploaded')} {formatDate(currentResume.uploaded_at)}
                        </p>
                      </div>
                    </div>
                    {currentResume.download_url && (
                      <Button variant="outline" size="sm" asChild className="gap-1.5 shrink-0">
                        <a
                          href={currentResume.download_url}
                          download={currentResume.filename}
                          aria-label={`Download ${currentResume.filename}`}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          Download
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Error note when current resume query failed */}
          {currentError && (
            <motion.div variants={fadeUp}>
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t('resume.currentLoadError')}
              </div>
            </motion.div>
          )}

          {/* Upload new version */}
          <motion.div variants={fadeUp}>
            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-body-lg font-semibold text-foreground flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t('resume.uploadTitle')}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('resume.uploadDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileUploadZone
                  label="Resume"
                  accept="application/pdf"
                  maxBytes={RESUME_MAX_BYTES}
                  onUpload={handleUpload}
                />
              </CardContent>
            </Card>
          </motion.div>

          <Separator />

          {/* Version history */}
          <motion.div variants={fadeUp} className="space-y-3">
            <h2 className="text-body-sm font-semibold text-foreground">
              {t('resume.versionHistory', { count: resumeList.length })}
            </h2>
            <div className="space-y-2" aria-label="Resume version list">
              {resumeList.map((item) => (
                <ResumeVersionRow
                  key={item.resume_id}
                  item={item}
                  onSetCurrent={(id) => setCurrentMutation.mutate(id)}
                  onDelete={(it) => setDeleteTarget(it)}
                  isSettingCurrent={
                    setCurrentMutation.isPending &&
                    setCurrentMutation.variables === item.resume_id
                  }
                  isDeleting={
                    deleteMutation.isPending && deleteTarget?.resume_id === item.resume_id
                  }
                />
              ))}
            </div>
          </motion.div>
        </>
      )}

      {/* Delete confirm dialog */}
      <DeleteDialog
        open={deleteTarget !== null}
        filename={deleteTarget?.filename ?? ''}
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.resume_id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </motion.section>
  );
}
