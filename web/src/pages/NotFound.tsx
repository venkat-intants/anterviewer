// NotFound — 404 page rendered for any unmatched route.
// Unauthenticated users get a link to /login; authenticated users get /dashboard.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { SearchX } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const homePath = isAuthenticated ? '/dashboard' : '/';

  return (
    <main
      className="min-h-screen flex items-center justify-center bg-background px-4"
      aria-labelledby="not-found-heading"
    >
      <div className="max-w-md w-full text-center space-y-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-xl bg-primary/10 shadow-card"
        >
          <SearchX className="h-10 w-10 text-primary" aria-hidden="true" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
          <p className="text-display font-semibold text-foreground/[0.08] select-none">404</p>
          <h1
            id="not-found-heading"
            className="text-heading font-semibold text-foreground"
          >
            {t('error.pageNotFoundTitle')}
          </h1>
          <p className="text-body-sm text-muted-foreground">{t('error.pageNotFoundDesc')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Button asChild>
            <Link to={homePath}>{t('error.goHome')}</Link>
          </Button>
        </motion.div>
      </div>
    </main>
  );
}
