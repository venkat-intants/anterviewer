// ChangePassword — forced bootstrap-password reset (HR workflow).
// Shown when the account has must_change_password=true (e.g. an HR manager who
// just logged in with the default '1234'). Standalone page (no shell).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { changePassword } from '@/api/auth';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

function landingForRoles(roles: string[]): string {
  if (roles.includes('super_admin')) return '/superadmin';
  if (roles.includes('hr_manager')) return '/hr';
  if (roles.includes('admin')) return '/admin/overview';
  return '/dashboard';
}

export default function ChangePassword() {
  const { t } = useTranslation();
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
      toast.success(t('changePassword.successToast'));
      void navigate(landingForRoles(user?.roles ?? []), { replace: true });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t('changePassword.errGeneric'));
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError(t('changePassword.errMinLength'));
      return;
    }
    if (pw !== confirm) {
      setError(t('changePassword.errMismatch'));
      return;
    }
    mutation.mutate();
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 shadow-elevated">
          <div className="flex flex-col items-center text-center mb-6">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-foreground">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-subheading font-semibold text-foreground">
              {t('changePassword.title')}
            </h1>
            <p className="mt-2 text-body-sm text-muted-foreground">{t('changePassword.desc')}</p>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Change password form">
            <div className="space-y-1.5">
              <label htmlFor="cp-new" className="block text-body-sm font-medium text-foreground">
                {t('changePassword.newPassword')}
              </label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={t('changePassword.newPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cp-confirm" className="block text-body-sm font-medium text-foreground">
                {t('changePassword.confirmPassword')}
              </label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('changePassword.confirmPlaceholder')}
              />
            </div>

            {error && (
              <p role="alert" className="text-body-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? t('changePassword.saving') : t('changePassword.submit')}
            </Button>
          </form>
        </Card>
      </motion.div>
    </main>
  );
}
