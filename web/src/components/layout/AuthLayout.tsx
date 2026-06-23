// AuthLayout — premium split-screen shell shared by Login & Register.
//
// Left  (lg+): an aurora brand-showcase panel — the product's signature
//              atmosphere, animated glow, value props and a trust line.
// Right (all): the form column (passed as `children`), centered on the canvas.
//
// The brand panel is decorative and hidden below `lg`; on small screens the
// form fills the viewport and each page renders its own compact logo header.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Bot, Languages, ClipboardCheck, ShieldCheck } from 'lucide-react';

interface Feature {
  icon: typeof Bot;
  titleKey: string;
  descKey: string;
}

const FEATURES: Feature[] = [
  { icon: Bot, titleKey: 'auth.feature1Title', descKey: 'auth.feature1Desc' },
  { icon: Languages, titleKey: 'auth.feature2Title', descKey: 'auth.feature2Desc' },
  { icon: ClipboardCheck, titleKey: 'auth.feature3Title', descKey: 'auth.feature3Desc' },
];

// ── Brand showcase (desktop only) ────────────────────────────────────────────
function BrandPanel() {
  const { t } = useTranslation();

  return (
    <aside className="relative hidden overflow-hidden bg-aurora lg:flex lg:flex-col lg:justify-between lg:p-14 xl:p-16">
      {/* Drifting ambient glows — the aurora signature, kept subtle */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-1/4 h-[28rem] w-[28rem] rounded-full bg-electric/25 blur-[120px] animate-aurora-drift" />
        <div className="absolute -right-20 bottom-0 h-[26rem] w-[26rem] rounded-full bg-lavender/25 blur-[120px] animate-aurora-drift [animation-delay:-7s]" />
        {/* Hairline grid for depth */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
      </div>

      {/* Top — brand lockup */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10"
      >
        <Link
          to="/"
          className="inline-flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-lg"
          aria-label="Anterview"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[11px] bg-white/15 text-lg font-bold text-white shadow-inset-hairline backdrop-blur">
            A
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Anterview</span>
        </Link>
      </motion.div>

      {/* Middle — value proposition + features */}
      <div className="relative z-10 max-w-md">
        <motion.h2
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="font-eb-garamond text-[2.5rem] font-medium leading-[1.08] tracking-[-0.01em] text-white xl:text-[3rem]"
        >
          {t('auth.brandTagline')}
        </motion.h2>

        <ul className="mt-10 space-y-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.li
                key={f.titleKey}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.2 + i * 0.1 }}
                className="flex items-start gap-4"
              >
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white shadow-inset-hairline backdrop-blur">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[15px] font-semibold text-white">{t(f.titleKey)}</p>
                  <p className="mt-0.5 text-[13.5px] leading-relaxed text-white/70">{t(f.descKey)}</p>
                </div>
              </motion.li>
            );
          })}
        </ul>
      </div>

      {/* Bottom — trust line */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.55 }}
        className="relative z-10 flex items-center gap-2.5 text-[13px] text-white/65"
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
        {t('auth.trustNote')}
      </motion.div>
    </aside>
  );
}

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="min-h-screen w-full bg-background lg:grid lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      <BrandPanel />

      {/* Form column */}
      <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:min-h-0">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </main>
  );
}
