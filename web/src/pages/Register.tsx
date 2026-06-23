// Register page — full_name + email + password → POST /auth/register → /dashboard
// Rebuilt to mirror Login.tsx exactly: shadcn Form + Zod, brand logo, Google SSO,
// framer-motion entrance, toast-based errors (no inline alert divs).

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { register as registerUser, getMe } from '@/api/auth';
import { googleLoginUrl } from '@/api/sso';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import type { AuthUser } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AuthLayout from '@/components/layout/AuthLayout';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';

const registerSchema = z.object({
  full_name: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name is too long'),
  email: z.string().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

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

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: RegisterFormValues) => {
      const regRes = await registerUser(values);
      const me = await getMe(regRes.access_token);
      return { regRes, me };
    },
    onSuccess: ({ regRes, me }) => {
      const user: AuthUser = {
        user_id: me.user_id,
        full_name: me.full_name,
        email: me.email,
        roles: me.roles,
      };
      setAuth(regRes.access_token, user);
      void navigate('/dashboard', { replace: true });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : t('error.generic');
      toast.error(message);
    },
  });

  function onSubmit(values: RegisterFormValues) {
    mutation.mutate(values);
  }

  return (
    <AuthLayout>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Heading — compact logo shows on mobile where the brand panel is hidden */}
        <div className="mb-8">
          <Link
            to="/"
            className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-[12px] bg-foreground text-background text-lg font-bold select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-label="Anterview"
          >
            A
          </Link>
          <h1 className="text-heading font-semibold tracking-tight text-foreground">
            {t('auth.createYourAccount')}
          </h1>
          <p className="mt-2 text-body-sm text-muted-foreground">{t('auth.startJourney')}</p>
        </div>

        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            noValidate
            aria-label="Registration form"
            className="space-y-5"
          >
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('auth.fullName')}</FormLabel>
                  <FormControl>
                    <Input type="text" autoComplete="name" placeholder="Jane Smith" className="h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      className="h-11"
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
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="h-11"
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
              className="h-11 w-full text-[15px]"
            >
              {mutation.isPending ? t('auth.creatingAccount') : t('auth.createAccount')}
            </Button>
          </form>
        </Form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <Separator className="flex-1 bg-border" />
          <span className="text-micro font-medium text-muted-foreground uppercase tracking-wide">
            {t('auth.orContinueWithFull')}
          </span>
          <Separator className="flex-1 bg-border" />
        </div>

        {/* Google SSO — full-page redirect to the backend initiate endpoint */}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full gap-3"
          onClick={() => {
            window.location.assign(googleLoginUrl());
          }}
        >
          <GoogleLogo className="h-5 w-5" />
          {t('auth.signUpWithGoogle')}
        </Button>

        <p className="mt-8 text-center text-body-sm text-muted-foreground">
          {t('auth.haveAccount')}{' '}
          <Link
            to="/login"
            className="font-semibold text-primary hover:text-primary/80 focus:outline-none focus:underline underline-offset-4"
          >
            {t('auth.signIn2')}
          </Link>
        </p>
      </motion.div>
    </AuthLayout>
  );
}
