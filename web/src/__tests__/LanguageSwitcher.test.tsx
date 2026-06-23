// Tests for LanguageSwitcher component and i18n integration.
// Covers:
//   1. Switcher renders all 3 language options.
//   2. Clicking हिंदी calls i18n.changeLanguage('hi').
//   3. Clicking తెలుగు calls i18n.changeLanguage('te').
//   4. Landing page renders a Hindi string after switching to 'hi'.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../lib/i18n';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Landing from '../pages/Landing';
import { AuthProvider } from '../context/AuthContext';

// ── Switcher isolation tests ──────────────────────────────────────────────────

function renderSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LanguageSwitcher />
    </I18nextProvider>,
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    // Reset to English before each test
    await i18n.changeLanguage('en');
  });

  it('renders three language options: EN, हिंदी, తెలుగు', () => {
    renderSwitcher();
    expect(screen.getByRole('button', { name: /english/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /हिंदी/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /తెలుగు/i })).toBeInTheDocument();
  });

  it('calls changeLanguage("hi") when हिंदी is clicked', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(i18n, 'changeLanguage');
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: /हिंदी/i }));
    expect(spy).toHaveBeenCalledWith('hi');
    spy.mockRestore();
  });

  it('calls changeLanguage("te") when తెలుగు is clicked', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(i18n, 'changeLanguage');
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: /తెలుగు/i }));
    expect(spy).toHaveBeenCalledWith('te');
    spy.mockRestore();
  });

  it('marks EN as pressed when language is en', () => {
    renderSwitcher();
    const enBtn = screen.getByRole('button', { name: /english/i });
    expect(enBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ── Integration: Landing page renders Hindi string after language switch ───────

// Stub auth context so Landing doesn't redirect
vi.mock('../context/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../context/AuthContext')>('../context/AuthContext');
  return {
    ...actual,
    useAuth: vi.fn().mockReturnValue({
      isAuthenticated: false,
      isInitializing: false,
      user: null,
      accessToken: null,
      setAuth: vi.fn(),
      clearAuth: vi.fn(),
    }),
  };
});

function renderLandingWithSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AuthProvider>
          <LanguageSwitcher />
          <Landing />
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Landing page i18n integration', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows English headline by default', () => {
    renderLandingWithSwitcher();
    expect(screen.getByRole('heading', { name: /interviews that feel human/i })).toBeInTheDocument();
  });

  it('shows Hindi headline after switching to hi', async () => {
    const user = userEvent.setup();
    renderLandingWithSwitcher();

    await user.click(screen.getByRole('button', { name: /हिंदी/i }));

    await waitFor(() => {
      // Match the unique Devanagari fragment from the Hindi headline:
      // "इंटरव्यू जो असली जैसे लगें।"
      expect(screen.getByRole('heading', { name: /असली जैसे लगें/ })).toBeInTheDocument();
    });

    // Verify the hero subtitle also switched — a unique contiguous Devanagari
    // fragment from "…सफलता का आत्मविश्वास पाएं।"
    await waitFor(() => {
      expect(screen.getByText(/आत्मविश्वास पाएं/)).toBeInTheDocument();
    });
  });
});
