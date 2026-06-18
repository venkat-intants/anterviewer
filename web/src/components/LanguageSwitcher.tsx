// LanguageSwitcher — compact EN / हिंदी / తెలుగు toggle in the app header.
// Calls i18n.changeLanguage(); persistence is handled in lib/i18n.ts via the
// 'languageChanged' event → localStorage write.
// Rendered inside TopBar (AppShell) — visible on all pages including admin,
// but admin text stays English regardless (admin UI is EN-only by design).

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'te', label: 'తెలుగు' },
] as const;

type LangCode = (typeof LANGUAGES)[number]['code'];

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.language as LangCode;

  return (
    <div
      role="group"
      aria-label={t('lang.label')}
      className="hidden sm:flex items-center rounded-full border border-border bg-muted/50 p-0.5 gap-0.5"
    >
      {LANGUAGES.map(({ code, label }) => {
        const isActive = current === code || (code === 'en' && !['hi', 'te'].includes(current));
        return (
          <button
            key={code}
            type="button"
            onClick={() => void i18n.changeLanguage(code)}
            aria-label={t(`lang.${code}`)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
