// Google OAuth callback landing page — S5-003b / B-035
//
// Google redirects the browser here (configured as the OAuth redirect_uri) with
// ?code & ?state. We exchange them for an Intants JWT, load the profile, store
// auth, and continue into the app. The exchange is guarded by a ref because the
// state token is single-use (Redis get-then-delete) and React StrictMode
// double-invokes effects in development — a second call would burn the token.
//
// Presentation rebuilt to match the auth page visual language (brand logo,
// design tokens, framer-motion). OAuth mechanics are completely unchanged.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { completeGoogleLogin } from '@/api/sso';
import { getMe } from '@/api/auth';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import type { AuthUser } from '@/types/auth';

export default function GoogleCallback() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const exchangedRef = useRef(false);

  useEffect(() => {
    // Run the single-use exchange exactly once (StrictMode double-effect guard).
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');

    if (oauthError) {
      const msg = `Google sign-in was cancelled (${oauthError}).`;
      setError(msg);
      return;
    }
    if (!code || !state) {
      setError('Missing authorization code or state from Google.');
      return;
    }

    void (async () => {
      try {
        const tokens = await completeGoogleLogin(code, state);
        const me = await getMe(tokens.access_token);
        const user: AuthUser = {
          user_id: me.user_id,
          full_name: me.full_name,
          email: me.email,
          roles: me.roles,
        };
        setAuth(tokens.access_token, user);
        void navigate('/dashboard', { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Google sign-in failed.';
        setError(message);
        toast.error(message);
      }
    })();
  }, [params, navigate, setAuth]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 flex items-center justify-center px-4 py-12">
      {error ? (
        /* ── Error state ────────────────────────────────────────────────────── */
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          {/* Brand */}
          <div className="text-center mb-8">
            <Link
              to="/"
              className="inline-flex flex-col items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold shadow-lg shadow-primary/20 select-none">
                I
              </span>
            </Link>
          </div>

          <div
            role="alert"
            className="rounded-2xl border border-border bg-card shadow-sm p-8 text-center"
          >
            <div className="flex justify-center mb-4">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
              </span>
            </div>
            <h1 className="text-lg font-semibold text-foreground mb-2">Sign-in failed</h1>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild variant="default">
                <Link to="/login">Back to sign in</Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </div>
        </motion.div>
      ) : (
        /* ── Loading state ──────────────────────────────────────────────────── */
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-center"
        >
          {/* Brand mark */}
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold shadow-lg shadow-primary/20 select-none mb-6">
            I
          </span>

          {/* Spinner */}
          <div className="flex justify-center mb-4">
            <div
              className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent"
              role="status"
              aria-label="Completing Google sign-in"
            />
          </div>

          <p className="text-sm font-medium text-foreground">Completing Google sign-in</p>
          <p className="mt-1 text-xs text-muted-foreground">This will only take a moment…</p>
        </motion.div>
      )}
    </main>
  );
}
