// ThemeToggle — light/dark switch for the app (the landing keeps its own theme).
// Toggles the `dark` class on <html>, which flips every shadcn semantic token to
// the Apple-dark palette (see index.css). The choice is persisted; an inline
// script in index.html applies it before first paint to avoid a flash.
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const THEME_KEY = 'intants:theme';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage unavailable */
  }
  // Default to the Apple light theme unless the user has explicitly chosen dark.
  return 'light';
}

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* no-op */
    }
  }, [theme]);

  const isDark = theme === 'dark';
  const label = isDark ? t('nav.themeLight') : t('nav.themeDark');

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
