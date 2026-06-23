// InterviewInvite — public applicant landing for an interview magic link (Phase 3).
//
// No login. Token comes from the URL #fragment. Preview → DPDP consent → redeem
// (which lazily provisions a guest session server-side) → store the returned guest
// token → navigate into the EXISTING /interview/:sessionId UI, unchanged.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation, Trans } from 'react-i18next';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2, Video, Clock } from 'lucide-react';
import { getInterviewInvite, redeemInterviewInvite } from '@/api/publicInterview';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

const LANGUAGE_STORAGE_KEY = 'intants:interview-language';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-3 overflow-hidden bg-background px-6 text-center">
      <div className="relative z-10 flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

export default function InterviewInvite() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [token] = useState(() => window.location.hash.replace(/^#/, '').trim());
  const [consent, setConsent] = useState(false);

  const inviteQ = useQuery({
    queryKey: ['interview-invite', token],
    queryFn: () => getInterviewInvite(token),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const redeemMut = useMutation({
    mutationFn: () => redeemInterviewInvite(token, true),
    onSuccess: (r) => {
      setAuth(r.access_token, {
        user_id: r.user_id,
        full_name: r.full_name,
        email: r.email ?? '',
        roles: r.roles,
        must_change_password: false,
      });
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, r.language);
      } catch {
        // non-fatal — the session already carries the language server-side
      }
      // Strip the token from the URL before leaving the page.
      window.history.replaceState(null, '', '/interview-invite');
      navigate(`/interview/${r.session_id}`, { replace: true });
    },
  });

  if (!token || inviteQ.isError) {
    return (
      <Centered>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-amber-50 text-amber-600 shadow-sm">
          <AlertCircle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('interviewInvite.invalidTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {t('interviewInvite.invalidDesc')}
        </p>
      </Centered>
    );
  }

  if (inviteQ.isLoading || !inviteQ.data) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-body-sm text-muted-foreground">{t('interviewInvite.loading')}</p>
      </Centered>
    );
  }

  const info = inviteQ.data;

  if (info.already_completed) {
    return (
      <Centered>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-[9px] bg-emerald-50 text-emerald-600 shadow-sm">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('interviewInvite.completedTitle')}
        </h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          {t('interviewInvite.completedDesc')}
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border border-border bg-card text-card-foreground p-8 shadow-elevated transition-shadow hover:shadow-card-hover"
      >
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-[9px] bg-secondary text-foreground">
          <Video className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-subheading font-semibold text-foreground">
          {t('interviewInvite.title')}
        </h1>
        <p className="max-w-md text-body-sm text-muted-foreground">
          <Trans
            i18nKey="interviewInvite.greeting"
            values={{ name: info.applicant_name, role: info.job_title }}
            components={{ 1: <span className="font-medium text-foreground" /> }}
          />
        </p>
        {info.scheduled_at && (
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('interviewInvite.scheduledFor', {
              time: new Date(info.scheduled_at).toLocaleString(),
            })}
          </p>
        )}

        <label className="mt-2 flex max-w-md cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-body-sm text-muted-foreground">{t('interviewInvite.consent')}</span>
        </label>

        <Button
          size="lg"
          disabled={!consent || redeemMut.isPending}
          onClick={() => redeemMut.mutate()}
          className="gap-2"
        >
          {redeemMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {t('interviewInvite.begin')}
        </Button>
        {redeemMut.isError && (
          <p className="text-body-sm text-rose-600">
            {redeemMut.error instanceof Error
              ? redeemMut.error.message
              : t('interviewInvite.startError')}
          </p>
        )}
      </motion.div>
    </Centered>
  );
}
