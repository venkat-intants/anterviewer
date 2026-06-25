// Register page — full_name + email + password → POST /auth/register → /dashboard
// Design: AuthSplit skin (dark canvas, conic-G Google badge, Naipunyam disabled,
//         DPDP consent checkbox as presentation gate).
// Logic: RHF + zodResolver (full_name 2–100, email, password 8–128),
//        registerUser()→getMe()→setAuth→/dashboard, isPending/aria-busy,
//        toast errors, all t() keys. No role tabs (role is server-assigned).

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { register as registerUser, getMe } from '@/api/auth';
import { googleLoginUrl } from '@/api/sso';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import type { AuthUser } from '@/types/auth';
import AuthLayout from '@/components/layout/AuthLayout';
import { Field, Pill } from '@/design/components/primitives';
import { User, Mail, Lock } from '@/design/components/icons';

// ── Zod schema ────────────────────────────────────────────────────────────────
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

// ── Google "G" badge (conic gradient — matches design SsoButtons) ──────────────
function GoogleBadge() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: 'conic-gradient(from -45deg,#ea4335,#fbbc05,#34a853,#4285f4,#ea4335)' }}
    >
      G
    </span>
  );
}

// ── Naipunyam badge ───────────────────────────────────────────────────────────
function NaipunyamBadge() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 items-center justify-center rounded-[6px] text-[11px] font-bold text-white"
      style={{ background: 'linear-gradient(135deg,#16c253,var(--accent))' }}
    >
      न
    </span>
  );
}

// ── Base button classes reused across SSO buttons ─────────────────────────────
const ssoBase =
  'flex w-full items-center justify-center gap-2.5 rounded-[12px] px-4 py-3 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black';

// ─────────────────────────────────────────────────────────────────────────────

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  // DPDP consent — presentation gate on submit button only.
  // The register API does not yet accept a consent param; this checkbox is
  // visual until the backend captures consent (see gap report §Design-only).
  const [agreedToDpdp, setAgreedToDpdp] = useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', password: '' },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  // ── Mutation: registerUser → getMe → setAuth → /dashboard ────────────────────
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
      {/* Mobile compact logo (hidden on desktop where the brand panel shows) */}
      <Link
        to="/"
        className="mb-8 flex items-center gap-2.5 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-lg"
        aria-label="Anterview home"
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px]"
          style={{ background: 'linear-gradient(135deg,#112d72,#a887dc)' }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="text-[15px] font-semibold text-white">Anterview</span>
      </Link>

      {/* Heading */}
      <h1 className="text-[26px] font-semibold tracking-[-0.8px] text-white">
        {t('auth.createYourAccount')}
      </h1>
      <p className="mt-1.5 text-[14px] text-[#888b91]">{t('auth.startJourney')}</p>

      {/* SSO buttons */}
      <div className="mt-8 flex flex-col gap-2.5">
        {/* Google — real handler (signUpWithGoogle → googleLoginUrl) */}
        <button
          type="button"
          className={`${ssoBase} bg-white text-black hover:bg-[#eaeaea]`}
          onClick={() => { window.location.assign(googleLoginUrl()); }}
        >
          <GoogleBadge />
          {t('auth.signUpWithGoogle')}
        </button>

        {/* Naipunyam — disabled (no live handler; see gap report) */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={`${ssoBase} border border-white/15 bg-white/[0.04] text-white opacity-50 cursor-not-allowed`}
        >
          <NaipunyamBadge />
          Sign up with Naipunyam SSO
        </button>
      </div>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3 text-[12px] text-[#5a5f66]">
        <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
        {t('auth.orContinueWithFull')}
        <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
      </div>

      {/* Full name + email + password form — RHF + Zod + inline FormMessage */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        aria-label="Registration form"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <Field
            label={t('auth.fullName')}
            type="text"
            autoComplete="name"
            placeholder="Your name"
            icon={<User size={15} aria-hidden="true" />}
            {...register('full_name')}
          />
          {errors.full_name && (
            <span role="alert" className="text-[11.5px] text-[#e6714f]">
              {errors.full_name.message}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            icon={<Mail size={15} aria-hidden="true" />}
            {...register('email')}
          />
          {errors.email && (
            <span role="alert" className="text-[11.5px] text-[#e6714f]">
              {errors.email.message}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Field
            label={t('auth.password')}
            type="password"
            autoComplete="new-password"
            placeholder="8+ characters"
            icon={<Lock size={15} aria-hidden="true" />}
            hint="Use 8+ characters with a number and a symbol."
            {...register('password')}
          />
          {errors.password && (
            <span role="alert" className="text-[11.5px] text-[#e6714f]">
              {errors.password.message}
            </span>
          )}
        </div>

        {/* DPDP consent checkbox — presentation gate only.
            The API does not yet capture a consent param; this visually
            gates the submit button until the user acknowledges DPDP terms.
            See gap report §Register / Design-only. */}
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-[#888b91]">
          <input
            type="checkbox"
            checked={agreedToDpdp}
            onChange={(e) => { setAgreedToDpdp(e.target.checked); }}
            className="mt-0.5 h-4 w-4 flex-none cursor-pointer accent-[var(--accent)]"
            aria-label="I agree to the Terms and DPDP-compliant Privacy Policy"
          />
          <span>
            I agree to the Terms and the DPDP-compliant Privacy Policy, including
            interview recording for scoring.
          </span>
        </label>

        {/* Submit — gated by DPDP consent checkbox (presentation) */}
        <Pill
          type="submit"
          disabled={mutation.isPending || !agreedToDpdp}
          aria-busy={mutation.isPending}
          className="w-full py-3"
        >
          {mutation.isPending ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Pill>
      </form>

      {/* Footer link */}
      <p className="mt-6 text-center text-[13px] text-[#888b91]">
        {t('auth.haveAccount')}{' '}
        <Link
          to="/login"
          className="font-medium text-white hover:underline focus:outline-none focus:underline underline-offset-4"
        >
          {t('auth.signIn2')}
        </Link>
      </p>
    </AuthLayout>
  );
}
