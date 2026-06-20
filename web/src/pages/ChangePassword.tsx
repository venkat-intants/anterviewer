// ChangePassword — forced bootstrap-password reset (HR workflow).
// Shown when the account has must_change_password=true (e.g. an HR manager who
// just logged in with the default '1234'). Standalone page (no shell).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { changePassword } from '@/api/auth';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function landingForRoles(roles: string[]): string {
  if (roles.includes('super_admin')) return '/superadmin';
  if (roles.includes('hr_manager')) return '/hr';
  if (roles.includes('admin')) return '/admin/overview';
  return '/dashboard';
}

export default function ChangePassword() {
  const navigate = useNavigate();
  const { accessToken, user, setAuth } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword(pw),
    onSuccess: () => {
      if (accessToken && user) {
        setAuth(accessToken, { ...user, must_change_password: false });
      }
      toast.success('Password updated.');
      void navigate(landingForRoles(user?.roles ?? []), { replace: true });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    mutation.mutate();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-sm p-8"
      >
        <div className="flex flex-col items-center text-center mb-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-foreground">Set a new password</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your account uses a temporary password. Choose a new one to continue.
          </p>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Change password form">
          <div className="space-y-1.5">
            <label htmlFor="cp-new" className="block text-sm font-medium text-foreground">
              New password
            </label>
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="cp-confirm" className="block text-sm font-medium text-foreground">
              Confirm password
            </label>
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter the password"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? 'Saving…' : 'Set password & continue'}
          </Button>
        </form>
      </motion.div>
    </main>
  );
}
