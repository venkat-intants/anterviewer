// Login page — email + password form → POST /auth/login → redirect to /dashboard
// Rebuilt on shadcn Form + Input + Button + Zod. Errors via toast wrapper.

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { login, getMe } from '@/api/auth';
import { googleLoginUrl } from '@/api/sso';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import type { AuthUser } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Google logo SVG (inline — no external dep) ───────────────────────────────
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const loginRes = await login(values);
      const me = await getMe(loginRes.access_token);
      return { loginRes, me };
    },
    onSuccess: ({ loginRes, me }) => {
      const user: AuthUser = {
        user_id: me.user_id,
        full_name: me.full_name,
        email: me.email,
        roles: me.roles,
        must_change_password: me.must_change_password,
      };
      setAuth(loginRes.access_token, user);
      // Force a bootstrap-password reset first; otherwise land on the area that
      // matches the account's role.
      if (me.must_change_password) {
        void navigate('/change-password', { replace: true });
      } else if (me.roles.includes('super_admin')) {
        void navigate('/superadmin', { replace: true });
      } else if (me.roles.includes('hr_manager')) {
        void navigate('/hr', { replace: true });
      } else {
        void navigate('/dashboard', { replace: true });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : t('error.generic');
      toast.error(message);
    },
  });

  function onSubmit(values: LoginFormValues) {
    mutation.mutate(values);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-violet-500/5 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-8"
        >
          <Link
            to="/"
            className="inline-flex flex-col items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-bold shadow-lg shadow-primary/20 select-none">
              I
            </span>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-foreground">{t('auth.welcomeBack')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-2xl border border-border bg-card shadow-sm p-8"
        >
          <Form {...form}>
            <form
              onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
              noValidate
              aria-label="Login form"
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.email')}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.password')}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={mutation.isPending}
                aria-busy={mutation.isPending}
                className="w-full"
              >
                {mutation.isPending ? t('auth.signingIn') : t('auth.signIn')}
              </Button>
            </form>
          </Form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('auth.orContinueWith')}
            </span>
            <Separator className="flex-1" />
          </div>

          {/* Google SSO — full-page redirect to the backend initiate endpoint */}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-3"
            onClick={() => {
              window.location.assign(googleLoginUrl());
            }}
          >
            <GoogleLogo className="h-5 w-5" />
            {t('auth.signInWithGoogle')}
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('auth.noAccount')}{' '}
            <Link
              to="/register"
              className="font-medium text-primary hover:text-primary/80 focus:outline-none focus:underline underline-offset-4"
            >
              {t('auth.createOne')}
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
