// AppShell — authenticated layout shell used by all in-app pages.
// Provides: top bar (brand + primary nav + user menu),
// responsive mobile sheet nav, and a <main> content area.
// All in-app authenticated routes render as children of this shell.

import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Briefcase,
  History,
  FileText,
  LogOut,
  Menu,
  BarChart2,
  ClipboardList,
  TrendingUp,
  Upload,
  Building2,
  Users,
  FileSearch,
  Video,
} from 'lucide-react';
import { logout } from '@/api/auth';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import LanguageSwitcher from '@/components/LanguageSwitcher';

// The interview-language localStorage key (separate concern from UI language)
const INTERVIEW_LANGUAGE_KEY = 'intants:interview-language';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/jobs', labelKey: 'nav.jobs', icon: <Briefcase className="h-4 w-4" /> },
  { to: '/history', labelKey: 'nav.history', icon: <History className="h-4 w-4" /> },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin/overview', labelKey: 'nav.adminOverview', icon: <BarChart2 className="h-4 w-4" /> },
  { to: '/admin/interviews', labelKey: 'nav.adminInterviews', icon: <ClipboardList className="h-4 w-4" /> },
  { to: '/admin/analytics', labelKey: 'nav.adminAnalytics', icon: <TrendingUp className="h-4 w-4" /> },
  { to: '/admin/jd', labelKey: 'nav.adminJd', icon: <Upload className="h-4 w-4" /> },
];

/** Derive initials from a display name for the avatar fallback */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return 'U';
  if (parts.length === 1) return (parts[0]?.[0] ?? 'U').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

// ── DesktopNav ───────────────────────────────────────────────────────────────

function DesktopNavLink({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )
      }
    >
      {item.icon}
      {t(item.labelKey)}
    </NavLink>
  );
}

/** Like DesktopNavLink but with a literal label (HR-workflow links, not yet i18n'd). */
function PlainNavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

// ── User menu ────────────────────────────────────────────────────────────────

function UserMenu() {
  const { t } = useTranslation();
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      queryClient.clear();
      clearAuth();
      void navigate('/login', { replace: true });
    },
    onError: () => {
      toast.error(t('error.generic'));
    },
  });

  const displayName = user?.full_name ?? 'User';
  const email = user?.email ?? '';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t('nav.userMenu')}>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium leading-none">{displayName}</p>
          {email && <p className="mt-1 text-xs text-muted-foreground truncate">{email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/resume" className="flex items-center gap-2 cursor-pointer">
            <FileText className="h-4 w-4" />
            {t('nav.resume')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/history" className="flex items-center gap-2 cursor-pointer">
            <History className="h-4 w-4" />
            {t('nav.history')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          {logoutMutation.isPending ? '…' : t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Mobile sheet nav ─────────────────────────────────────────────────────────

function MobileNav() {
  const { t } = useTranslation();
  const { user, clearAuth } = useAuth();
  const isAdmin = user?.roles.includes('admin') ?? false;
  const isSuperAdmin = user?.roles.includes('super_admin') ?? false;
  const isHr = user?.roles.includes('hr_manager') ?? false;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      queryClient.clear();
      clearAuth();
      void navigate('/login', { replace: true });
    },
    onError: () => {
      toast.error(t('error.generic'));
    },
  });

  function closeAndNavigate(to: string) {
    setOpen(false);
    void navigate(to);
  }

  const displayName = user?.full_name ?? 'User';
  const email = user?.email ?? '';

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.openMenu')}>
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle asChild>
            <Link
              to="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold select-none">
                I
              </span>
              <span className="text-sm font-semibold text-foreground">Intants AI</span>
            </Link>
          </SheetTitle>
        </SheetHeader>

        {/* User info */}
        <div className="px-6 py-4 flex items-center gap-3 border-b border-border">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
            {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
          </div>
        </div>

        {/* Nav links */}
        <nav aria-label="Main navigation" className="px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => closeAndNavigate(item.to)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.icon}
              {t(item.labelKey)}
            </button>
          ))}
          {isAdmin && (
            <>
              <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Admin
              </p>
              {ADMIN_NAV_ITEMS.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => closeAndNavigate(item.to)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.icon}
                  {t(item.labelKey)}
                </button>
              ))}
            </>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => closeAndNavigate('/superadmin')}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Building2 className="h-4 w-4" />
              Super Admin
            </button>
          )}
          {isHr && (
            <>
              <button
                type="button"
                onClick={() => closeAndNavigate('/hr')}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Users className="h-4 w-4" />
                Hiring
              </button>
              <button
                type="button"
                onClick={() => closeAndNavigate('/hr/applicants')}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileSearch className="h-4 w-4" />
                Applicants
              </button>
              <button
                type="button"
                onClick={() => closeAndNavigate('/hr/exams')}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ClipboardList className="h-4 w-4" />
                Exams
              </button>
              <button
                type="button"
                onClick={() => closeAndNavigate('/hr/interviews')}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Video className="h-4 w-4" />
                Interviews
              </button>
            </>
          )}
        </nav>

        <Separator />

        <div className="px-3 py-4 space-y-1">
          <button
            type="button"
            onClick={() => closeAndNavigate('/resume')}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="h-4 w-4" />
            {t('nav.resume')}
          </button>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {logoutMutation.isPending ? '…' : t('nav.logout')}
          </button>
        </div>

      </SheetContent>
    </Sheet>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────────────

function TopBar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Mobile hamburger */}
        <MobileNav />

        {/* Brand */}
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label={t('app.name')}
        >
          <motion.span
            whileHover={{ scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold select-none"
          >
            I
          </motion.span>
          <span className="hidden sm:block text-sm font-semibold text-foreground">Intants AI</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1 ml-4">
          {NAV_ITEMS.map((item) => (
            <DesktopNavLink key={item.to} item={item} />
          ))}
          {user?.roles.includes('admin') && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              {ADMIN_NAV_ITEMS.map((item) => (
                <DesktopNavLink key={item.to} item={item} />
              ))}
            </>
          )}
          {user?.roles.includes('super_admin') && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <PlainNavLink
                to="/superadmin"
                label="Super Admin"
                icon={<Building2 className="h-4 w-4" />}
              />
            </>
          )}
          {user?.roles.includes('hr_manager') && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
              <PlainNavLink to="/hr" label="Hiring" icon={<Users className="h-4 w-4" />} />
              <PlainNavLink
                to="/hr/applicants"
                label="Applicants"
                icon={<FileSearch className="h-4 w-4" />}
              />
              <PlainNavLink
                to="/hr/exams"
                label="Exams"
                icon={<ClipboardList className="h-4 w-4" />}
              />
              <PlainNavLink
                to="/hr/interviews"
                label="Interviews"
                icon={<Video className="h-4 w-4" />}
              />
            </>
          )}
        </nav>

        {/* Right side controls */}
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// ── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  // Ensure the interview-language key exists so other pages can read it
  if (!localStorage.getItem(INTERVIEW_LANGUAGE_KEY)) {
    localStorage.setItem(INTERVIEW_LANGUAGE_KEY, 'en');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
