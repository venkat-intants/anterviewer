// App — route definitions with React.lazy code-splitting.
// Authenticated routes are wrapped in AppShell (layout route).
// Public routes render without the shell.
import { Suspense, lazy } from 'react';
import { Routes, Route, Outlet } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import ErrorBoundary from './components/ErrorBoundary';
import AppShell from './components/layout/AppShell';

// ── Public pages ──────────────────────────────────────────────────────────────
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const GoogleCallback = lazy(() => import('./pages/GoogleCallback'));
const NotFound = lazy(() => import('./pages/NotFound'));

// ── Authenticated shell pages ─────────────────────────────────────────────────
const Dashboard = lazy(() => import('./pages/Dashboard'));
const JobsList = lazy(() => import('./pages/JobsList'));
const StartInterview = lazy(() => import('./pages/StartInterview'));
const History = lazy(() => import('./pages/History'));
const Resume = lazy(() => import('./pages/Resume'));

// ── Interview / scorecard (no shell — full-screen experience) ─────────────────
const Interview = lazy(() => import('./pages/Interview'));
const InterviewComplete = lazy(() => import('./pages/InterviewComplete'));
const Scorecard = lazy(() => import('./pages/Scorecard'));

// ── Admin pages (inside AdminRoute + AppShell) ────────────────────────────────
const AdminJobJd = lazy(() => import('./pages/AdminJobJd'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview'));
const AdminInterviews = lazy(() => import('./pages/admin/AdminInterviews'));
const AdminInterviewDetail = lazy(() => import('./pages/admin/AdminInterviewDetail'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
        role="status"
        aria-label="Loading page"
      />
    </div>
  );
}

/** Layout wrapper: renders <AppShell> around whichever child route matches */
function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes — no shell */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/google/callback" element={<GoogleCallback />} />

          {/* Authenticated routes rendered INSIDE AppShell */}
          <Route element={<ProtectedRoute />}>
            <Route element={<ShellLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/jobs" element={<JobsList />} />
              <Route path="/start" element={<StartInterview />} />
              <Route path="/history" element={<History />} />
              <Route path="/resume" element={<Resume />} />
            </Route>

            {/* Full-screen pages — own header/chrome */}
            <Route path="/interview/:sessionId" element={<Interview />} />
            <Route path="/interview/:sessionId/complete" element={<InterviewComplete />} />
            <Route path="/scorecard/:scorecardId" element={<Scorecard />} />
          </Route>

          {/* Admin-only routes — inside AppShell for consistent navigation */}
          <Route element={<AdminRoute />}>
            <Route element={<ShellLayout />}>
              <Route path="/admin/overview" element={<AdminOverview />} />
              <Route path="/admin/interviews" element={<AdminInterviews />} />
              <Route path="/admin/interviews/:sessionId" element={<AdminInterviewDetail />} />
              <Route path="/admin/analytics" element={<AdminAnalytics />} />
              <Route path="/admin/jd" element={<AdminJobJd />} />
            </Route>
          </Route>

          {/* 404 catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
