// HRInterviews — invite eligible applicants to the AI interview + track results (Phase 3).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Video, Send, Copy, Ban, Loader2, BarChart3, Clock } from 'lucide-react';
import {
  listEligibleApplicants,
  listInvites,
  createInvite,
  revokeInvite,
  type InterviewInvite,
} from '@/api/interviewInvites';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const inputCls =
  'w-full rounded-[9px] border border-border bg-secondary px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

function statusBadge(s: string): { label: string; variant: BadgeProps['variant'] } {
  switch (s) {
    case 'completed':
      return { label: 'Completed', variant: 'success' };
    case 'consumed':
      return { label: 'In progress', variant: 'accent' };
    case 'revoked':
      return { label: 'Revoked', variant: 'destructive' };
    case 'expired':
      return { label: 'Expired', variant: 'secondary' };
    default:
      return { label: 'Invited', variant: 'warning' };
  }
}

function InviteRow({ inv, onRevoke, revoking }: {
  inv: InterviewInvite;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  const badge = statusBadge(inv.status);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3.5 transition-colors hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{inv.applicant_name}</p>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="mt-1 text-caption text-muted-foreground">
          {inv.job_title} · {inv.language}
          {inv.scheduled_at ? ` · scheduled ${new Date(inv.scheduled_at).toLocaleDateString()}` : ''}
        </p>
      </div>
      {inv.composite_score !== null && (
        <div className="shrink-0 text-center">
          <div className="text-lg font-semibold leading-none text-emerald-600">
            {inv.composite_score.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground">/10</div>
        </div>
      )}
      {inv.scorecard_id && (
        <Link to={`/scorecard/${inv.scorecard_id}`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <BarChart3 className="h-4 w-4" aria-hidden="true" /> Result
          </Button>
        </Link>
      )}
      {inv.status === 'invited' && (
        <button
          type="button"
          aria-label="Revoke link"
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
          disabled={revoking}
          onClick={() => onRevoke(inv.invite_id)}
        >
          <Ban className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function HRInterviews() {
  const qc = useQueryClient();
  const [applicantId, setApplicantId] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi' | 'te'>('en');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mintedLink, setMintedLink] = useState<string | null>(null);

  const { data: eligible } = useQuery({
    queryKey: ['hr', 'interviews', 'eligible'],
    queryFn: () => listEligibleApplicants('any'),
  });
  const { data: invites, isLoading } = useQuery({
    queryKey: ['hr', 'interviews'],
    queryFn: () => listInvites(),
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      createInvite({
        applicant_id: applicantId,
        language,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    onSuccess: (res) => {
      setMintedLink(res.magic_link);
      setApplicantId('');
      setScheduledAt('');
      toast.success('Interview link created');
      void qc.invalidateQueries({ queryKey: ['hr', 'interviews'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Invite failed'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onSuccess: () => {
      toast.success('Link revoked');
      void qc.invalidateQueries({ queryKey: ['hr', 'interviews'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Revoke failed'),
  });

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  const list = invites ?? [];
  const elig = eligible ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-heading font-semibold text-foreground">AI interviews</h1>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Invite shortlisted or exam-passed applicants to a voice interview with the AI avatar.
          Share the private link — they need no account.
        </p>
      </div>

      {/* Invite */}
      <Card className="rounded-3xl shadow-elevated ring-1 ring-primary/10 bg-muted">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
            <Video className="h-4 w-4 text-primary" aria-hidden="true" />
            Invite a candidate
          </CardTitle>
          <CardDescription className="text-body-sm text-muted-foreground">
            Only shortlisted or exam-passed applicants are eligible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className={cn(inputCls, 'sm:col-span-2')}
              value={applicantId}
              onChange={(e) => setApplicantId(e.target.value)}
              aria-label="Applicant"
            >
              <option value="">Select an applicant…</option>
              {elig.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name} — {a.passed_exam ? 'exam passed' : 'shortlisted'}
                  {a.has_active_invite ? ' (already invited)' : ''}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'hi' | 'te')}
              aria-label="Language"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="te">తెలుగు</option>
            </select>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-caption text-muted-foreground">
              Schedule (optional — link works any time before expiry)
            </span>
            <input
              type="datetime-local"
              className={inputCls}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-label="Scheduled time"
            />
          </label>
          <Button
            disabled={!applicantId || inviteMut.isPending}
            onClick={() => inviteMut.mutate()}
            className="gap-1.5"
          >
            {inviteMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Generate interview link
          </Button>

          {mintedLink && (
            <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-caption font-medium text-emerald-700">
                Share this link with the candidate — copy it now (shown once):
              </p>
              <div className="flex items-center gap-2 text-xs">
                <input
                  readOnly
                  value={mintedLink}
                  className="min-w-0 flex-1 rounded-[9px] border border-border bg-secondary px-2 py-1 text-foreground"
                />
                <button
                  type="button"
                  aria-label="Copy link"
                  className="shrink-0 text-emerald-600 transition-colors hover:text-emerald-800"
                  onClick={() => void copyLink(mintedLink)}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invites list */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Interviews ({list.length})
        </h2>
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-muted-foreground">
            No interviews yet — invite an eligible applicant above.
          </p>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
            className="space-y-2"
          >
            {list.map((inv) => (
              <motion.div
                key={inv.invite_id}
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              >
                <InviteRow inv={inv} onRevoke={(id) => revokeMut.mutate(id)} revoking={revokeMut.isPending} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
