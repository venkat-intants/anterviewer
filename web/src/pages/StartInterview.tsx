// StartInterview — multi-step wizard for launching a self-serve interview.
//
// Step layout (rendered as a single scrollable form, visually segmented):
//   Step 1 — Role details   : job title (required), company (opt), JD (opt)
//   Step 2 — Avatar         : pick your interviewer (lucas / anna / gloria)
//   Step 3 — Preferences    : experience level + interview language
//   Step 4 — Review + Start : summary card, consent gate, submit
//
// The wizard is NOT multi-page — all fields are on one form so validation
// on submit catches everything at once and the user can freely scroll.
// Each "Step" section is visually distinct with a numbered badge + divider.
//
// AppShell already provides the top bar; no second PageHeader is rendered here.

import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useConsent } from '@/context/ConsentContext';
import { getMe } from '@/api/auth';
import { createCustomJob } from '@/api/jobs';
import { createSession } from '@/api/sessions';
import { getAvatars } from '@/api/avatars';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import ConsentModal from '@/components/ConsentModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Language, Avatar } from '@/types/interview';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGE_STORAGE_KEY = 'intants:interview-language';
const AVATAR_STORAGE_KEY = 'intants:interview-avatar';
const DEFAULT_AVATAR_ID = 'anna';

// Language + level options are built inside the component so they can use t().

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormValues {
  title: string;
  company_name: string;
  jd_text: string;
  level: 'entry' | 'mid' | 'senior';
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  step: number;
  title: string;
  description?: string;
}

function SectionHeader({ step, title, description }: SectionHeaderProps) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/30 text-primary text-xs font-semibold mt-0.5">
        {step}
      </span>
      <div>
        <p className="text-body-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-caption text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Labelled field wrapper
// ---------------------------------------------------------------------------

interface FieldProps {
  id: string;
  label: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}

function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-body-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared input / select class
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-[9px] border border-border bg-secondary px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 focus:border-primary/50 ' +
  'transition-colors';

const inputErrCls =
  'border-destructive bg-destructive/10 focus:ring-destructive';

// ---------------------------------------------------------------------------
// Avatar card
// ---------------------------------------------------------------------------

interface AvatarCardProps {
  avatar: Avatar;
  selected: boolean;
  onSelect: (id: string) => void;
}

function AvatarCard({ avatar, selected, onSelect }: AvatarCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`Select ${avatar.name}`}
      onClick={() => onSelect(avatar.id)}
      className={cn(
        'relative flex flex-col items-center rounded-xl border-2 overflow-hidden transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'w-28 cursor-pointer',
        selected
          ? 'border-primary bg-muted shadow-card'
          : 'border-border bg-white hover:border-primary/40 hover:shadow-card',
      )}
    >
      {/* Thumbnail — looping muted video; falls back to img if src isn't a video URL */}
      <video
        src={avatar.thumbnail_url}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
        className="w-full aspect-[7/9] object-cover"
        onError={(e) => {
          // If the URL is not a valid video (e.g. placeholder image URL in mock/dev),
          // hide the video element — the name label below still identifies the avatar.
          (e.currentTarget as HTMLVideoElement).style.display = 'none';
        }}
      />
      <span
        className={cn(
          'w-full py-1.5 text-center text-caption font-medium',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {avatar.name}
      </span>
      {selected && (
        <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
          <CheckCircle2 className="h-3 w-3 text-primary-foreground" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StartInterview() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { consented, loading: consentLoading, recordConsent } = useConsent();

  // Translated option arrays — rebuilt whenever language changes
  const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'hi', label: 'हिंदी (Hindi)' },
    { value: 'te', label: 'తెలుగు (Telugu)' },
  ];

  const LEVEL_OPTIONS: { value: 'entry' | 'mid' | 'senior'; label: string; description: string }[] =
    [
      { value: 'entry', label: t('startInterview.entryLevel'), description: t('startInterview.years03') },
      { value: 'mid', label: t('startInterview.midLevel'), description: t('startInterview.years36') },
      { value: 'senior', label: t('startInterview.seniorLevel'), description: t('startInterview.years6plus') },
    ];

  // ── Language (persisted) ────────────────────────────────────────────────────
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'hi' || stored === 'te') return stored;
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, selectedLanguage);
  }, [selectedLanguage]);

  // ── Avatar selection (persisted) ────────────────────────────────────────────
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(() => {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
    return stored ?? DEFAULT_AVATAR_ID;
  });

  useEffect(() => {
    localStorage.setItem(AVATAR_STORAGE_KEY, selectedAvatarId);
  }, [selectedAvatarId]);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [values, setValues] = useState<FormValues>({
    title: '',
    company_name: '',
    jd_text: '',
    level: 'entry',
  });
  const [titleError, setTitleError] = useState<string | null>(null);

  // ── Consent modal state ─────────────────────────────────────────────────────
  const [showConsent, setShowConsent] = useState(false);
  const [isSubmittingConsent, setIsSubmittingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // ── Resume status ───────────────────────────────────────────────────────────
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => {
      if (!accessToken) throw new Error('No access token');
      return getMe(accessToken);
    },
    enabled: accessToken !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // ── Avatars list ─────────────────────────────────────────────────────────────
  // On fetch error we fall back gracefully — user can still proceed with the
  // default avatar so the interview is never blocked.
  const {
    data: avatars,
    isLoading: avatarsLoading,
    isError: avatarsError,
  } = useQuery<Avatar[]>({
    queryKey: ['avatars'],
    queryFn: getAvatars,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createJobMutation = useMutation({
    mutationFn: (formVals: FormValues) => {
      if (!accessToken) return Promise.reject(new Error('No access token'));
      return createCustomJob(
        {
          title: formVals.title.trim(),
          ...(formVals.company_name.trim()
            ? { company_name: formVals.company_name.trim() }
            : {}),
          ...(formVals.jd_text.trim() ? { jd_text: formVals.jd_text.trim() } : {}),
          level: formVals.level,
        },
        accessToken,
      );
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: (jobId: string) => {
      if (!accessToken) return Promise.reject(new Error('No access token'));
      return createSession(
        {
          job_id: jobId,
          language: selectedLanguage,
          avatar_id: selectedAvatarId,
        },
        accessToken,
      );
    },
    onSuccess: (result) => {
      void navigate(`/interview/${result.session_id}`);
    },
  });

  /** After consent is confirmed, run both mutations in sequence */
  const proceedToSession = useCallback(
    async (formVals: FormValues) => {
      const created = await createJobMutation.mutateAsync(formVals);
      createSessionMutation.mutate(created.id);
    },
    [createJobMutation, createSessionMutation],
  );

  // Surface API errors via both toast and an inline role="alert" element.
  // The toast provides ambient notification; the inline alert provides a
  // persistent visible message and allows test assertions via getByRole('alert').
  const apiError =
    createJobMutation.error instanceof Error
      ? createJobMutation.error.message
      : createSessionMutation.error instanceof Error
        ? createSessionMutation.error.message
        : null;

  useEffect(() => {
    if (apiError) {
      toast.error(apiError);
    }
  }, [apiError]);

  /** Called when "Start Interview" is clicked */
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setTitleError(null);
      createJobMutation.reset();
      createSessionMutation.reset();

      if (!values.title.trim()) {
        setTitleError(t('startInterview.jobTitleRequired'));
        return;
      }

      if (consented === true) {
        proceedToSession(values).catch(() => {
          // Error is surfaced via the mutation state and toast above
        });
      } else {
        setConsentError(null);
        setShowConsent(true);
      }
    },
    [values, consented, proceedToSession, createJobMutation, createSessionMutation, t],
  );

  /** User clicked "I Agree" in the consent modal */
  const handleAgree = useCallback(async () => {
    setIsSubmittingConsent(true);
    setConsentError(null);
    try {
      await recordConsent();
      setShowConsent(false);
      await proceedToSession(values);
    } catch (err) {
      setConsentError(
        err instanceof Error ? err.message : 'Failed to record consent. Please try again.',
      );
    } finally {
      setIsSubmittingConsent(false);
    }
  }, [recordConsent, proceedToSession, values]);

  /** User declined consent */
  const handleDecline = useCallback(() => {
    setShowConsent(false);
    setConsentError(null);
    toast.info('You must consent to use the interview feature.');
  }, []);

  const isSubmitting = createJobMutation.isPending || createSessionMutation.isPending;

  // ── Derived summary for review section ──────────────────────────────────────
  const levelLabel =
    LEVEL_OPTIONS.find((o) => o.value === values.level)?.label ?? values.level;
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.value === selectedLanguage)?.label ?? selectedLanguage;
  const avatarLabel =
    avatars?.find((a) => a.id === selectedAvatarId)?.name ?? selectedAvatarId;

  // ── Avatar groups for the picker ─────────────────────────────────────────────
  const maleAvatars = avatars?.filter((a) => a.gender === 'male') ?? [];
  const femaleAvatars = avatars?.filter((a) => a.gender === 'female') ?? [];

  return (
    <div className="pb-12">
      {/* Page heading */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6"
      >
        <h1 className="text-heading font-semibold text-foreground">{t('startInterview.pageTitle')}</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t('startInterview.pageDesc')}
        </p>
      </motion.div>

      {/* Resume status banner */}
      <AnimatePresence mode="wait">
        {!consentLoading && me !== undefined && (
          <motion.div
            key={me.has_resume ? 'resume-ok' : 'resume-missing'}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="mb-5"
          >
            {me.has_resume ? (
              <div
                aria-live="polite"
                className="flex items-center gap-2 rounded-xl border border-border bg-emerald-50 px-4 py-2.5 text-body-sm text-muted-foreground"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span className="font-medium text-foreground">{t('startInterview.resumeOnFile')}</span>
                <span className="text-muted-foreground">{t('startInterview.resumeOnFileDesc')}</span>
              </div>
            ) : (
              <div
                aria-live="polite"
                className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-body-sm text-muted-foreground"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                <span>
                  {t('startInterview.noResume')}{' '}
                  <Link
                    to="/dashboard"
                    className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t('startInterview.noResumeLink')}
                  </Link>{' '}
                  {t('startInterview.noResumeDesc')}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate aria-label="Start interview form">
        <div className="space-y-5">
          {/* ── Step 1: Role details ─────────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-5 pb-5 space-y-4">
              <SectionHeader
                step={1}
                title={t('startInterview.step1Title')}
                description={t('startInterview.step1Desc')}
              />

              <Field
                id="si-title"
                label={
                  <>
                    {t('startInterview.jobTitleLabel')}{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </>
                }
                error={titleError}
              >
                <input
                  id="si-title"
                  type="text"
                  required
                  aria-required="true"
                  aria-describedby={titleError ? 'si-title-error' : undefined}
                  aria-invalid={titleError !== null}
                  value={values.title}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, title: e.target.value }));
                    if (titleError) setTitleError(null);
                  }}
                  placeholder={t('startInterview.jobTitlePlaceholder')}
                  className={cn(inputCls, titleError && inputErrCls)}
                />
              </Field>

              <Field
                id="si-company"
                label={
                  <>
                    {t('startInterview.companyLabel')}{' '}
                    <span className="text-xs font-normal text-muted-foreground">({t('startInterview.optional')})</span>
                  </>
                }
              >
                <input
                  id="si-company"
                  type="text"
                  value={values.company_name}
                  onChange={(e) => setValues((v) => ({ ...v, company_name: e.target.value }))}
                  placeholder={t('startInterview.companyPlaceholder')}
                  className={inputCls}
                />
              </Field>

              <Field
                id="si-jd"
                label={
                  <>
                    {t('startInterview.jdLabel')}{' '}
                    <span className="text-xs font-normal text-muted-foreground">({t('startInterview.optional')})</span>
                  </>
                }
              >
                <textarea
                  id="si-jd"
                  rows={4}
                  value={values.jd_text}
                  onChange={(e) => setValues((v) => ({ ...v, jd_text: e.target.value }))}
                  placeholder={t('startInterview.jdPlaceholder')}
                  className={cn(inputCls, 'resize-y min-h-[80px]')}
                />
              </Field>
            </CardContent>
          </Card>

          {/* ── Step 2: Avatar ──────────────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-5 pb-5 space-y-4">
              <SectionHeader
                step={2}
                title={t('startInterview.step2Title')}
                description={t('startInterview.step2Desc')}
              />

              {avatarsLoading && (
                <div
                  aria-live="polite"
                  aria-label={t('startInterview.loadingInterviewers')}
                  className="flex items-center gap-2 text-body-sm text-muted-foreground"
                >
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                    aria-hidden="true"
                  />
                  {t('startInterview.loadingInterviewers')}
                </div>
              )}

              {!avatarsLoading && avatarsError && (
                <div
                  aria-live="polite"
                  className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-body-sm text-muted-foreground"
                >
                  {t('startInterview.avatarLoadError')}
                </div>
              )}

              {!avatarsLoading && !avatarsError && avatars !== undefined && (
                <div className="space-y-4">
                  {/* Male group */}
                  {maleAvatars.length > 0 && (
                    <div>
                      <p className="text-caption font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        {t('startInterview.maleGroup')}
                      </p>
                      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('startInterview.maleGroup')}>
                        {maleAvatars.map((avatar) => (
                          <AvatarCard
                            key={avatar.id}
                            avatar={avatar}
                            selected={selectedAvatarId === avatar.id}
                            onSelect={setSelectedAvatarId}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Female group */}
                  {femaleAvatars.length > 0 && (
                    <div>
                      <p className="text-caption font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        {t('startInterview.femaleGroup')}
                      </p>
                      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('startInterview.femaleGroup')}>
                        {femaleAvatars.map((avatar) => (
                          <AvatarCard
                            key={avatar.id}
                            avatar={avatar}
                            selected={selectedAvatarId === avatar.id}
                            onSelect={setSelectedAvatarId}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Step 3: Preferences ─────────────────────────────────────────── */}
          <Card>
            <CardContent className="pt-5 pb-5 space-y-4">
              <SectionHeader
                step={3}
                title={t('startInterview.step3Title')}
                description={t('startInterview.step3Desc')}
              />

              <Field id="si-level" label={t('startInterview.experienceLevelLabel')}>
                <select
                  id="si-level"
                  value={values.level}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      level: e.target.value as 'entry' | 'mid' | 'senior',
                    }))
                  }
                  className={inputCls}
                >
                  {LEVEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.description})
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="si-language" label={t('startInterview.interviewLanguageLabel')}>
                <select
                  id="si-language"
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value as Language)}
                  className={inputCls}
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          {/* ── Step 4: Review + Start ───────────────────────────────────────── */}
          <Card className="bg-muted ring-1 ring-primary/10 border-primary/20">
            <CardContent className="pt-5 pb-5 space-y-4">
              <SectionHeader
                step={4}
                title={t('startInterview.step4Title')}
                description={t('startInterview.step4Desc')}
              />

              {/* Summary row */}
              {values.title.trim() && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-xl bg-white border border-border px-4 py-3 space-y-1.5 text-body-sm shadow-card"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{values.title.trim()}</span>
                    {values.company_name.trim() && (
                      <>
                        <span className="text-muted-foreground">{t('startInterview.at')}</span>
                        <span className="text-foreground">{values.company_name.trim()}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      {levelLabel}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {languageLabel}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {avatarLabel}
                    </Badge>
                    {values.jd_text.trim() && (
                      <Badge variant="outline" className="text-xs">
                        {t('startInterview.jdProvided')}
                      </Badge>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Consent note */}
              <p className="text-caption text-muted-foreground">
                {t('startInterview.consentNote')}
              </p>

              {/* Inline API error — also shown via toast above */}
              {apiError && (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-body-sm text-destructive"
                >
                  {apiError}
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full"
                size="lg"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
                      aria-hidden="true"
                    />
                    {t('startInterview.starting')}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    {t('startInterview.startButton')}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>

      {/* Consent modal */}
      {showConsent && (
        <ConsentModal
          onAgree={handleAgree}
          onDecline={handleDecline}
          isSubmitting={isSubmittingConsent}
          error={consentError}
        />
      )}
    </div>
  );
}
