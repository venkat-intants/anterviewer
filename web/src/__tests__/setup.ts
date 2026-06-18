// Vitest + RTL setup — loaded before each test file
import '@testing-library/jest-dom';
// Initialise i18n once per test file so components using useTranslation render
// the English (fallback) text rather than raw translation keys. Each test file
// is module-isolated, so this re-inits to the default 'en' — no cross-file leak.
import '../lib/i18n';
