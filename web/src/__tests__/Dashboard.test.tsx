// Smoke tests for Dashboard page
// The Dashboard renders inside AppShell when in the real app, but in tests
// we render it directly (no AppShell) to keep the scope tight.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../context/AuthContext';
import Dashboard from '../pages/Dashboard';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../lib/i18n';

vi.mock('../api/auth', () => ({
  getMe: vi.fn().mockResolvedValue({
    user_id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Test Candidate',
    email: 'test@intants.com',
    roles: ['candidate'],
    has_resume: false,
  }),
  logout: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../api/resume', () => ({
  uploadResume: vi.fn().mockResolvedValue({
    message: 'ok',
    resume_id: 'new-id',
    resume_s3_key: 'resumes/test.pdf',
    text_length: 1000,
  }),
  getCurrentResume: vi.fn().mockRejectedValue(new Error('No resume')),
}));

vi.mock('../api/sessions', () => ({
  listSessions: vi.fn().mockResolvedValue({
    items: [
      {
        session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        job_title: 'Junior Java Developer',
        language: 'en',
        status: 'completed',
        started_at: '2026-05-29T10:00:00Z',
        completed_at: '2026-05-29T10:12:34Z',
        duration_seconds: 754,
        created_at: '2026-05-29T09:58:00Z',
        scorecard_id: '00000000-0000-0000-0000-000000000001',
      },
    ],
    total: 1,
    page: 1,
    per_page: 3,
  }),
}));

vi.mock('../api/scorecard', () => ({
  listScorecards: vi.fn().mockResolvedValue({
    items: [
      {
        scorecard_id: '00000000-0000-0000-0000-000000000001',
        session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        composite_score: 7.05,
        created_at: '2026-05-29T10:13:00Z',
        summary: 'Solid candidate.',
        job_title: 'Junior Java Developer',
      },
    ],
    total: 1,
    page: 1,
    per_page: 20,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Properly sets auth state via effect before Dashboard renders
function TokenSetter({ children }: { children: React.ReactNode }) {
  const { setAuth } = useAuth();
  useEffect(() => {
    setAuth('mock-access-token', {
      user_id: '11111111-1111-1111-1111-111111111111',
      full_name: 'Test Candidate',
      email: 'test@intants.com',
      roles: ['candidate'],
    });
  }, [setAuth]);
  return <>{children}</>;
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthProvider>
            <TokenSetter>
              <Dashboard />
            </TokenSetter>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders welcome message after load', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /welcome, test candidate/i })).toBeInTheDocument();
    });
  });

  it('displays user email', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/test@intants\.com/i)).toBeInTheDocument();
    });
  });

  it('shows the Start Interview quick-action button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start interview/i })).toBeInTheDocument();
    });
  });

  it('displays the candidate role badge', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('candidate')).toBeInTheDocument();
    });
  });

  it('navigates to /start when Start Interview is clicked', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const startBtn = await screen.findByRole('button', { name: /start interview/i });
    await user.click(startBtn);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/start');
    });
  });

  it('shows interviews-taken stat after data loads', async () => {
    renderDashboard();
    await waitFor(() => {
      // stat value "1" for 1 session, or within a containing element
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('shows average score stat after data loads', async () => {
    renderDashboard();
    // composite_score: 7.05 → (7.05).toFixed(1) = "7.0" (JavaScript float rounding)
    await waitFor(() => {
      expect(screen.getByText(/7\.0 \/ 10/i)).toBeInTheDocument();
    });
  });

  it('shows recent session job title after data loads', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText(/junior java developer/i).length).toBeGreaterThan(0);
    });
  });
});
