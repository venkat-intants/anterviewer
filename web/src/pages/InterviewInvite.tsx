// InterviewInvite — public applicant landing for an interview magic link (Phase 3).
//
// No login. Token comes from the URL #fragment. Preview → DPDP consent → redeem
// (which lazily provisions a guest session server-side) → store the returned guest
// token → navigate into the EXISTING /interview/:sessionId UI, unchanged.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, AlertCircle, CheckCircle2, Video, Clock } from 'lucide-react';
import { getInterviewInvite, redeemInterviewInvite } from '@/api/publicInterview';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

const LANGUAGE_STORAGE_KEY = 'intants:interview-language';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      {children}
    </div>
  );
}

export default function InterviewInvite() {
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
        <AlertCircle className="h-10 w-10 text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">This interview link isn&apos;t valid</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have expired, been revoked, or already been used. Please ask your recruiter
          for a fresh link.
        </p>
      </Centered>
    );
  }

  if (inviteQ.isLoading || !inviteQ.data) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading your interview…</p>
      </Centered>
    );
  }

  const info = inviteQ.data;

  if (info.already_completed) {
    return (
      <Centered>
        <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">You&apos;ve already completed this interview</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your interview has been recorded. You can close this window — your recruiter will be
          in touch.
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Video className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold text-foreground">Your AI interview</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Hi {info.applicant_name} — you&apos;ve been invited to a short voice interview for the{' '}
        <span className="font-medium text-foreground">{info.job_title}</span> role. You&apos;ll
        speak with an AI interviewer; it takes about 10 minutes.
      </p>
      {info.scheduled_at && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden="true" />
          Scheduled for {new Date(info.scheduled_at).toLocaleString()}
        </p>
      )}

      <label className="mt-2 flex max-w-md cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span className="text-sm text-muted-foreground">
          I consent to my microphone and camera being used to conduct and assess this interview.
          My data is processed for hiring purposes; I can withdraw consent (DPDP §11) by contacting
          the recruiter.
        </span>
      </label>

      <Button
        size="lg"
        disabled={!consent || redeemMut.isPending}
        onClick={() => redeemMut.mutate()}
        className="gap-2"
      >
        {redeemMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
        Begin interview
      </Button>
      {redeemMut.isError && (
        <p className="text-sm text-rose-600">
          {redeemMut.error instanceof Error ? redeemMut.error.message : 'Could not start the interview.'}
        </p>
      )}
    </Centered>
  );
}
