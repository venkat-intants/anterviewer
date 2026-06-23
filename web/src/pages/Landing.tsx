// Landing — public marketing page, redesigned in the Cluely visual language:
// a light, achromatic workspace anchored by a blue-dawn gradient hero, an
// editorial EB Garamond serif display headline against compact Geist UI text,
// a single Signal-Blue accent, hairline borders, and the product (a face-to-face
// AI-avatar ↔ human-candidate interview) presented as a floating dark mockup.
//
// This page opts OUT of the app-wide dark theme: its root sets a white canvas
// and carbon text, and all colours come from the namespaced `cluely-*` tokens
// (see tailwind.config.js) so nothing here collides with the dark product UI.
//
// Authenticated users are redirected to /dashboard.

import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, type Variants } from 'framer-motion';
import {
  Mic,
  Languages,
  FileBarChart2,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  UsersRound,
  Sparkles,
  Eye,
  Lock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import InterviewMockup from '@/components/landing/InterviewMockup';

// ── Motion ────────────────────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

const stagger: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.09 } } };

// ── Buttons (Cluely button vocabulary) ──────────────────────────────────────────

// Signature filled Signal-Blue CTA — used in white sections and the final band.
function PrimaryCta({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[4px] bg-cluely-signal px-5 py-2.5 text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(2,44,112,0.45)] transition-shadow duration-200 hover:shadow-cluely-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cluely-azure focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </Link>
  );
}

// White CTA — for the blue hero, where a blue button would not read.
function LightCta({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[4px] bg-white px-5 py-2.5 text-[15px] font-medium text-cluely-carbon shadow-[0_8px_24px_-8px_rgba(2,20,60,0.55)] transition-colors hover:bg-white/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        className,
      )}
    >
      {children}
    </Link>
  );
}

// ── Hero backdrop: blue dawn over mountain ridges ───────────────────────────────

function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* atmospheric blooms */}
      <div className="absolute left-1/2 top-[-12rem] h-[36rem] w-[60rem] -translate-x-1/2 rounded-[50%] bg-[#9ec6f7]/40 blur-3xl" />
      <div className="absolute bottom-[6rem] left-[12%] h-72 w-72 rounded-full bg-cluely-cyan/10 blur-3xl" />
      {/* mountain ridges */}
      <svg className="absolute inset-x-0 bottom-0 h-[46%] w-full" viewBox="0 0 1440 360" preserveAspectRatio="none" fill="none">
        <path d="M0 250 L210 150 L380 220 L560 120 L760 215 L960 135 L1160 225 L1320 165 L1440 230 L1440 360 L0 360 Z" fill="#103089" fillOpacity="0.55" />
        <path d="M0 300 L260 215 L470 285 L700 195 L900 280 L1130 205 L1340 285 L1440 250 L1440 360 L0 360 Z" fill="#0a1f63" fillOpacity="0.8" />
      </svg>
      {/* haze + melt into the white workspace below */}
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-b from-transparent via-[#dfeafd]/40 to-cluely-chalk" />
    </div>
  );
}

// ── Top navigation (transparent over hero → frosted white on scroll) ────────────

function TopNav() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#suite', label: t('landing.navFeatures') },
    { href: '#languages', label: t('landing.navLanguages') },
    { href: '#help', label: t('landing.navHowItWorks') },
  ];

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled ? 'border-b border-cluely-bone bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70' : 'border-b border-transparent',
      )}
    >
      <nav aria-label="Primary" className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 focus-visible:outline-none" aria-label={t('app.name')}>
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-[6px] text-[15px] font-bold transition-colors',
              scrolled ? 'bg-cluely-carbon text-white' : 'bg-white text-cluely-carbon',
            )}
          >
            A
          </span>
          <span className={cn('text-[20px] font-semibold tracking-tight transition-colors', scrolled ? 'text-cluely-carbon' : 'text-white')}>
            Anterview
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={cn('text-[14px] font-normal transition-colors', scrolled ? 'text-cluely-slate hover:text-cluely-carbon' : 'text-white/85 hover:text-white')}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/login"
            className={cn('hidden rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-colors sm:inline-flex', scrolled ? 'text-cluely-slate hover:text-cluely-carbon' : 'text-white/85 hover:text-white')}
          >
            {t('landing.heroSecondaryCta')}
          </Link>
          <Link
            to="/register"
            className={cn(
              'inline-flex items-center rounded-[4px] px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              scrolled
                ? 'bg-cluely-signal text-white hover:bg-cluely-signal/90 focus-visible:ring-cluely-azure focus-visible:ring-offset-white'
                : 'bg-white text-cluely-carbon hover:bg-white/95 focus-visible:ring-white focus-visible:ring-offset-transparent',
            )}
          >
            {t('landing.heroCta')}
          </Link>
        </div>
      </nav>
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────────

function Hero() {
  const { t } = useTranslation();
  const checks = [t('landing.heroCheckNoCreditCard'), t('landing.heroCheckLanguages'), t('landing.heroCheckScorecard')];

  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden bg-cluely-hero">
      <HeroBackdrop />

      <div className="relative z-10 mx-auto max-w-screen-2xl px-4 pb-28 pt-28 sm:px-6 sm:pb-36 sm:pt-32">
        <motion.div initial="hidden" animate="visible" variants={stagger} className="mx-auto max-w-3xl text-center">
          <motion.span
            variants={fadeUp}
            custom={0}
            className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[12px] font-medium text-white/90 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t('landing.heroEyebrow')}
          </motion.span>

          <motion.h1
            id="hero-heading"
            variants={fadeUp}
            custom={1}
            className="text-balance font-eb-garamond text-[2.75rem] font-medium leading-[1.02] tracking-[-0.012em] text-white sm:text-6xl lg:text-[80px]"
          >
            {t('landing.heroHeadline')}
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="mx-auto mt-6 max-w-xl text-[18px] leading-[1.5] text-white/80">
            {t('landing.heroSubtitle')}
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LightCta to="/register" className="w-full sm:w-auto">
              {t('landing.heroCta')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </LightCta>
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-[4px] border border-white/30 bg-white/5 px-5 py-2.5 text-[15px] font-medium text-white backdrop-blur transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
            >
              {t('landing.heroSecondaryCta')}
            </Link>
          </motion.div>

          <motion.ul variants={fadeUp} custom={4} className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="Key benefits">
            {checks.map((c) => (
              <li key={c} className="flex items-center gap-1.5 text-[12px] text-white/70">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-white/90" aria-hidden="true" />
                {c}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Floating product mockup — the AI-avatar ↔ candidate interview call */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16"
        >
          <InterviewMockup />
        </motion.div>
      </div>
    </section>
  );
}

// ── Compatibility / reach strip ─────────────────────────────────────────────────

function CompatStrip() {
  const { t } = useTranslation();
  const items = ['English', 'हिन्दी', 'తెలుగు', 'Software', 'Sales', 'Banking', 'Nursing'];
  return (
    <section id="languages" className="border-b border-cluely-bone bg-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-10 text-center sm:px-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-cluely-fog">{t('landing.compatCaption')}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {items.map((it) => (
            <span key={it} className="text-[16px] font-medium text-cluely-mist">
              {it}
            </span>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-cluely-fog">{t('landing.compatMore')}</p>
      </div>
    </section>
  );
}

// ── Section heading helper ──────────────────────────────────────────────────────

function SectionHeading({ id, title, subtitle }: { id?: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <motion.h2
        id={id}
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="text-[30px] font-medium leading-[1.2] tracking-[-0.025em] text-cluely-carbon sm:text-4xl"
      >
        {title}
      </motion.h2>
      {subtitle && <p className="mx-auto mt-3 max-w-xl text-[18px] leading-[1.5] text-cluely-steel">{subtitle}</p>}
    </div>
  );
}

// ── How it helps (two-column: blue-tint + white) ────────────────────────────────

function HelpSection() {
  const { t } = useTranslation();
  return (
    <section id="help" className="bg-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading title={t('landing.helpHeading')} subtitle={t('landing.helpSubtitle')} />
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          {/* Blue-tint card — talk, don't type */}
          <motion.div variants={fadeUp} className="rounded-3xl bg-cluely-frost p-7 ring-1 ring-cluely-signal/10">
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-[10px] bg-cluely-signal text-white shadow-[0_6px_16px_-6px_rgba(60,131,246,0.8)]">
              <Mic className="h-5 w-5" />
            </div>
            <h3 className="text-[20px] font-medium leading-snug text-cluely-carbon">{t('landing.featureVoiceTitle')}</h3>
            <p className="mt-2 text-[16px] leading-[1.5] text-cluely-steel">{t('landing.featureVoiceDesc')}</p>
            {/* mini avatar+candidate strip */}
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-white p-2.5 ring-1 ring-cluely-bone">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#4a8df8] to-[#0544a5] text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="flex items-end gap-[3px]" aria-hidden="true">
                {[10, 18, 26, 14, 22, 12].map((h, i) => (
                  <span key={i} className="w-[3px] origin-bottom rounded-full bg-cluely-signal motion-safe:animate-voice-bar" style={{ height: `${h}px`, animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
              <span className="ml-auto text-[12px] font-medium text-cluely-fog">{t('landing.mockupAiStatus')}</span>
            </div>
          </motion.div>

          {/* White card — know where you stand */}
          <motion.div variants={fadeUp} className="rounded-3xl bg-white p-7 ring-1 ring-cluely-bone">
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-[10px] bg-cluely-carbon text-white">
              <FileBarChart2 className="h-5 w-5" />
            </div>
            <h3 className="text-[20px] font-medium leading-snug text-cluely-carbon">{t('landing.featureScorecardTitle')}</h3>
            <p className="mt-2 text-[16px] leading-[1.5] text-cluely-steel">{t('landing.featureScorecardDesc')}</p>
            {/* mini scorecard bars */}
            <div className="mt-6 space-y-2.5 rounded-xl bg-cluely-vapor p-3.5">
              {[
                { k: t('scorecard.dimensionCommunication'), v: 86 },
                { k: t('scorecard.dimensionTechnical'), v: 72 },
                { k: t('scorecard.dimensionProblemSolving'), v: 64 },
              ].map((row) => (
                <div key={row.k} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-[12px] text-cluely-steel">{row.k}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white" aria-hidden="true">
                    <span className="block h-full rounded-full bg-cluely-signal" style={{ width: `${row.v}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Suite (three-column feature grid) ───────────────────────────────────────────

interface Pillar {
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
  visual: React.ReactNode;
}

function SuiteSection() {
  const { t } = useTranslation();

  const pillars: Pillar[] = [
    {
      icon: <UsersRound className="h-5 w-5" />,
      titleKey: 'landing.featureAvatarsTitle',
      descKey: 'landing.featureAvatarsDesc',
      visual: (
        <div className="flex items-center justify-center gap-2">
          {['from-[#4a8df8] to-[#0544a5]', 'from-[#a855f7] to-[#6d28d9]', 'from-[#f97362] to-[#b91c1c]', 'from-[#22c55e] to-[#15803d]', 'from-[#f59e0b] to-[#b45309]', 'from-[#38bdf8] to-[#0369a1]'].map((g, i) => (
            <span key={i} className={cn('h-8 w-8 rounded-full bg-gradient-to-br ring-2 ring-white', g, i % 2 ? 'translate-y-1.5' : '')} />
          ))}
        </div>
      ),
    },
    {
      icon: <Languages className="h-5 w-5" />,
      titleKey: 'landing.featureLanguageTitle',
      descKey: 'landing.featureLanguageDesc',
      visual: (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {['English', 'हिन्दी', 'తెలుగు', '+22'].map((l) => (
            <span key={l} className="rounded-full border border-cluely-bone bg-white px-3 py-1 text-[13px] font-medium text-cluely-slate">
              {l}
            </span>
          ))}
        </div>
      ),
    },
    {
      icon: <ShieldCheck className="h-5 w-5" />,
      titleKey: 'landing.featurePrivacyTitle',
      descKey: 'landing.featurePrivacyDesc',
      visual: (
        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cluely-bone bg-white px-3 py-1.5 text-[12px] font-medium text-cluely-slate">
            <Lock className="h-3.5 w-3.5 text-cluely-signal" /> DPDP 2023
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cluely-bone bg-white px-3 py-1.5 text-[12px] font-medium text-cluely-slate">
            🇮🇳 India
          </span>
        </div>
      ),
    },
  ];

  return (
    <section id="suite" className="border-y border-cluely-bone bg-cluely-vapor/40">
      <div className="mx-auto max-w-screen-2xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading title={t('landing.suiteHeading')} subtitle={t('landing.suiteSubtitle')} />
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          {pillars.map((p) => (
            <motion.div key={p.titleKey} variants={fadeUp} className="flex flex-col rounded-xl border border-cluely-bone bg-white p-6">
              <div className="mb-6 grid h-32 place-items-center rounded-lg bg-cluely-frost ring-1 ring-inset ring-cluely-signal/10">{p.visual}</div>
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[8px] bg-cluely-signal/10 text-cluely-signal">{p.icon}</div>
              <h3 className="text-[18px] font-semibold leading-snug text-cluely-carbon">{t(p.titleKey)}</h3>
              <p className="mt-2 text-[15px] leading-[1.5] text-cluely-steel">{t(p.descKey)}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Integrity / proctoring band (video-conference participant card) ─────────────

function IntegritySection() {
  const { t } = useTranslation();
  const participants = [
    { name: t('landing.mockupAiName'), role: t('landing.integrityHostRole'), ai: true },
    { name: t('landing.mockupYouName'), role: t('landing.integrityCandidateRole'), ai: false },
  ];
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-screen-2xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-cluely-signal">{t('landing.integrityEyebrow')}</p>
          <h2 className="mt-3 text-[30px] font-medium leading-[1.2] tracking-[-0.025em] text-cluely-carbon sm:text-4xl">{t('landing.integrityTitle')}</h2>
          <p className="mt-4 max-w-md text-[18px] leading-[1.5] text-cluely-steel">{t('landing.integrityDesc')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {[
              { icon: <Eye className="h-4 w-4" />, label: t('landing.featurePrivacyTitle') },
              { icon: <Lock className="h-4 w-4" />, label: 'India data residency' },
            ].map((b) => (
              <span key={b.label} className="inline-flex items-center gap-2 rounded-full border border-cluely-bone bg-cluely-frost px-3.5 py-1.5 text-[13px] font-medium text-cluely-slate">
                <span className="text-cluely-signal">{b.icon}</span>
                {b.label}
              </span>
            ))}
          </div>
        </div>

        {/* Video-conference participant card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-cluely-bone bg-white p-5 shadow-cluely-glow"
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-cluely-carbon">{t('landing.mockupLive')}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cluely-signal/10 px-2.5 py-1 text-[12px] font-medium text-cluely-signal">
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('landing.integrityBadge')}
            </span>
          </div>
          <ul className="space-y-2.5">
            {participants.map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-xl bg-cluely-vapor/70 p-2.5">
                <span className={cn('grid h-9 w-9 place-items-center rounded-full text-white', p.ai ? 'bg-gradient-to-br from-[#4a8df8] to-[#0544a5]' : 'bg-cluely-slate')}>
                  {p.ai ? <Sparkles className="h-4 w-4" /> : <span className="text-[13px] font-semibold">{p.name.charAt(0)}</span>}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-cluely-carbon">{p.name}</p>
                  <p className="text-[12px] text-cluely-fog">{p.role}</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-cluely-fog">
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

// ── Final CTA band ──────────────────────────────────────────────────────────────

function CtaSection() {
  const { t } = useTranslation();
  return (
    <section className="bg-white px-4 pb-24 sm:px-6">
      <div className="relative mx-auto max-w-screen-2xl overflow-hidden rounded-3xl border border-cluely-bone bg-cluely-frost px-6 py-16 text-center sm:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-10rem] h-72 w-[44rem] -translate-x-1/2 rounded-[50%] bg-cluely-signal/10 blur-3xl" />
        </div>
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="relative z-10 mx-auto max-w-xl">
          <motion.p variants={fadeUp} className="text-[12px] font-semibold uppercase tracking-[0.15em] text-cluely-signal">
            {t('landing.ctaEyebrow')}
          </motion.p>
          <motion.h2 variants={fadeUp} className="mt-3 text-balance font-eb-garamond text-4xl font-medium leading-[1.05] tracking-[-0.012em] text-cluely-carbon sm:text-5xl">
            {t('landing.ctaTitle')}
          </motion.h2>
          <motion.p variants={fadeUp} className="mx-auto mt-4 max-w-md text-[18px] leading-[1.5] text-cluely-steel">
            {t('landing.ctaSubtitle')}
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            <PrimaryCta to="/register">
              {t('landing.ctaButton')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </PrimaryCta>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────────

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-cluely-bone bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 px-4 py-10 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-cluely-carbon text-[13px] font-bold text-white">A</span>
          <span className="text-[15px] font-semibold text-cluely-carbon">Anterview</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-cluely-steel">
          <a href="#suite" className="hover:text-cluely-carbon">{t('landing.navFeatures')}</a>
          <a href="#languages" className="hover:text-cluely-carbon">{t('landing.navLanguages')}</a>
          <span className="hover:text-cluely-carbon">{t('landing.footerPrivacy')}</span>
          <span className="hover:text-cluely-carbon">{t('landing.footerTerms')}</span>
          <a href="mailto:support@intants.com" className="hover:text-cluely-carbon">{t('landing.footerContact')}</a>
        </nav>
        <span className="text-[12px] text-cluely-fog">&copy; {new Date().getFullYear()} Intants Technologies Pvt. Ltd.</span>
      </div>
    </footer>
  );
}

// ── Page root ───────────────────────────────────────────────────────────────────

export default function Landing() {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cluely-chalk">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-cluely-signal border-t-transparent" role="status" aria-label="Loading" />
      </main>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-cluely-chalk font-geist text-cluely-carbon antialiased">
      <TopNav />
      <main id="main-content">
        <Hero />
        <CompatStrip />
        <HelpSection />
        <SuiteSection />
        <IntegritySection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
