// Landing — public marketing/hero page.
// Authenticated users are immediately redirected to /dashboard.
// Unauthenticated users see the product hero + value props + CTAs.

import { Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import { Mic, Languages, FileBarChart2, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ── Animation variants ────────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

// ── Feature card data ─────────────────────────────────────────────────────────

interface Feature {
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
}

const FEATURES: Feature[] = [
  {
    icon: <Mic className="h-5 w-5" />,
    titleKey: 'landing.featureVoiceTitle',
    descKey: 'landing.featureVoiceDesc',
  },
  {
    icon: <Languages className="h-5 w-5" />,
    titleKey: 'landing.featureLanguageTitle',
    descKey: 'landing.featureLanguageDesc',
  },
  {
    icon: <FileBarChart2 className="h-5 w-5" />,
    titleKey: 'landing.featureScorecardTitle',
    descKey: 'landing.featureScorecardDesc',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    titleKey: 'landing.featurePrivacyTitle',
    descKey: 'landing.featurePrivacyDesc',
  },
];

// HERO_CHECKS are translated via keys, not hardcoded strings.
// Keys: landing.heroCheckNoCreditCard, landing.heroCheckLanguages, landing.heroCheckScorecard
const HERO_CHECK_KEYS = [
  'landing.heroCheckNoCreditCard',
  'landing.heroCheckLanguages',
  'landing.heroCheckScorecard',
] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function PublicHeader() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label={t('app.name')}
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold select-none">
            I
          </span>
          <span className="hidden sm:block text-sm font-semibold text-foreground">Intants AI</span>
        </Link>
        {/* Auth links */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/login">{t('landing.heroSecondaryCta')}</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/register">{t('landing.heroCta')}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function HeroSection() {
  const { t } = useTranslation();
  const heroChecks = HERO_CHECK_KEYS.map((key) => t(key));

  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden pb-20 pt-16 sm:pt-24"
    >
      {/* Subtle background gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[40rem] w-[80rem] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-20 right-0 h-64 w-64 rounded-full bg-violet-500/5 blur-2xl" />
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-6">
          <motion.div variants={fadeUp} custom={0}>
            <Badge variant="secondary" className="mb-4 gap-1.5 px-3 py-1 text-xs">
              <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden="true" />
              {t('landing.trustBadge')}
            </Badge>
          </motion.div>

          <motion.h1
            id="hero-heading"
            variants={fadeUp}
            custom={1}
            className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
          >
            {t('landing.heroHeadline')}
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="mx-auto max-w-2xl text-lg text-muted-foreground leading-relaxed"
          >
            {t('landing.heroSubtitle')}
          </motion.p>

          {/* Bullet checks */}
          <motion.ul
            variants={fadeUp}
            custom={3}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
            aria-label="Key benefits"
          >
            {heroChecks.map((check) => (
              <li key={check} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                {check}
              </li>
            ))}
          </motion.ul>

          {/* CTA buttons */}
          <motion.div
            variants={fadeUp}
            custom={4}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2"
          >
            <Button
              size="lg"
              asChild
              className="w-full sm:w-auto gap-2 shadow-md shadow-primary/20"
            >
              <Link to="/register">
                {t('landing.heroCta')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild className="w-full sm:w-auto">
              <Link to="/login">{t('landing.heroSecondaryCta')}</Link>
            </Button>
          </motion.div>
        </motion.div>

        {/* Hero visual — avatar teaser card */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16 mx-auto max-w-2xl"
        >
          <AvatarTeaser />
        </motion.div>
      </div>
    </section>
  );
}

/** Illustrative card showing the interview interface feel */
function AvatarTeaser() {
  return (
    <div className="relative rounded-2xl border border-border bg-card shadow-xl shadow-primary/5 overflow-hidden">
      {/* Fake window chrome */}
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400/60" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-amber-400/60" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-green-400/60" aria-hidden="true" />
        <span className="ml-2 text-xs text-muted-foreground">Intants AI Interview</span>
      </div>
      {/* Interview scene */}
      <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-border">
        {/* Avatar placeholder */}
        <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-primary/8 to-violet-500/8 px-6 py-10 gap-4">
          <div className="relative">
            <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-3xl font-bold text-primary select-none">AI</span>
            </div>
            {/* Ripple to suggest audio activity */}
            <motion.span
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-full bg-primary/20 pointer-events-none"
              aria-hidden="true"
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">AI Interviewer</p>
            <p className="text-xs text-muted-foreground mt-0.5">Priya — Software Engineer</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
              aria-hidden="true"
            />
            <span className="text-xs text-primary font-medium">Speaking…</span>
          </div>
        </div>
        {/* Transcript area */}
        <div className="flex-1 flex flex-col justify-between p-5 text-left min-h-[180px]">
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground max-w-[85%]">
              Tell me about a challenging project you handled recently.
            </div>
            <div className="ml-auto rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground max-w-[85%]">
              Sure! I worked on a microservices migration at my previous company…
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 rounded-full bg-muted px-3 py-2">
              <motion.span
                animate={{ scaleY: [1, 2, 1, 1.5, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="h-3 w-0.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <motion.span
                animate={{ scaleY: [1, 1.5, 2, 1, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: 0.1 }}
                className="h-3 w-0.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <motion.span
                animate={{ scaleY: [2, 1, 1.5, 2, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                className="h-3 w-0.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="text-xs text-muted-foreground ml-1">Listening…</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
              <span className="h-2.5 w-2.5 rounded bg-destructive" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="features-heading" className="py-20 bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="text-center mb-12"
        >
          <motion.h2
            id="features-heading"
            variants={fadeUp}
            className="text-3xl font-bold text-foreground"
          >
            {t('landing.everythingYouNeed')}
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {FEATURES.map((feature, i) => (
            <FeatureCard key={feature.titleKey} feature={feature} index={i} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const { t } = useTranslation();
  return (
    <motion.div
      variants={fadeUp}
      custom={index}
      className={cn(
        'rounded-xl border border-border bg-card p-6 shadow-sm',
        'hover:shadow-md hover:border-primary/20 transition-all duration-200',
      )}
    >
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {feature.icon}
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1.5">{t(feature.titleKey)}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{t(feature.descKey)}</p>
    </motion.div>
  );
}

function CtaSection() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="cta-heading" className="py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="rounded-2xl border border-primary/20 bg-primary/5 px-8 py-12 space-y-6"
        >
          <motion.h2
            id="cta-heading"
            variants={fadeUp}
            className="text-3xl font-bold text-foreground"
          >
            {t('landing.ctaTitle')}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground">
            {t('landing.ctaSubtitle')}
          </motion.p>
          <motion.div variants={fadeUp}>
            <Button size="lg" asChild className="gap-2 shadow-md shadow-primary/20">
              <Link to="/register">
                {t('landing.ctaButton')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function PublicFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>&copy; {new Date().getFullYear()} Intants Technologies Pvt. Ltd.</span>
        <span>{t('app.tagline')}</span>
      </div>
    </footer>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function Landing() {
  const { isAuthenticated, isInitializing } = useAuth();

  // While silent-refresh is still running, avoid a flash to the hero
  if (isInitializing) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </main>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PublicHeader />
      <main id="main-content" className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <CtaSection />
      </main>
      <PublicFooter />
    </div>
  );
}
