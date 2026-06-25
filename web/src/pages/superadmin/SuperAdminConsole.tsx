// SuperAdminConsole — platform-owner view.
//
// Layout: reproduced from design screen (SuperAdminConsole.tsx).
//   • Page header (title + Add tenant Pill)
//   • 4 platform-wide stat tiles (design data)
//   • SegTabs: Companies / Feature flags / Audit log
//   • Companies tab: design table layout (Tenant/Plan/HR managers/Seats/Interviews/Status)
//     with live row-click → HR panel below + create-company form
//   • Feature flags tab: live (listFeatureFlags + setFeatureFlag via ToggleSwitch)
//   • Audit log tab: live (listAuditLog)
//
// Behavior: 100% live — listCompanies + createCompany + real hr_count;
//   listHrManagers + createHrManager (default pw + must_change_password badge);
//   listFeatureFlags + setFeatureFlag; listAuditLog.
// Shell: bare content — AppShell is provided by the router (no double-wrap).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Building2,
  UserPlus,
  Users,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Plus,
  ToggleLeft,
  AlertTriangle,
  ClipboardList,
} from '@/design/components/icons';
import {
  listCompanies,
  createCompany,
  listHrManagers,
  createHrManager,
  listFeatureFlags,
  setFeatureFlag,
  listAuditLog,
  type Company,
  type FeatureFlag,
  type AuditEvent,
} from '@/api/hr';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  GlassCard,
  StatCard,
  Avatar,
  SegTabs,
  Pill,
  ToggleSwitch,
  StatusTag,
  type TagTone,
} from '@/design/components/primitives';
import { Reveal } from '@/design/components/Reveal';
import { gradientFor, initialsOf } from '@/design/data/shared';
import { SUPER_STATS } from '@/design/data/admin';

// ── Tab definitions ────────────────────────────────────────────────────────────

const VIEW_TABS = [
  { key: 'companies', label: 'Companies' },
  { key: 'flags', label: 'Feature flags' },
  { key: 'audit', label: 'Audit log' },
] as const;

type ViewKey = (typeof VIEW_TABS)[number]['key'];

// ── Plan / status tones (design) ───────────────────────────────────────────────

const STATUS_TONE: Record<string, TagTone> = {
  Active: 'forest',
  Trial: 'amber',
  Suspended: 'ember',
};

// ── HR Panel (sub-component for the selected company) ─────────────────────────

function HrPanel({ company }: { company: Company }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const DEFAULT_PW = '12345678';

  const { data: hrs, isLoading } = useQuery({
    queryKey: ['hr-managers', company.id],
    queryFn: () => listHrManagers(company.id),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createHrManager(company.id, {
        email: email.trim(),
        full_name: fullName.trim(),
        password: DEFAULT_PW,
      }),
    onSuccess: () => {
      toast.success(`HR manager ${email} created.`);
      setEmail('');
      setFullName('');
      void qc.invalidateQueries({ queryKey: ['hr-managers', company.id] });
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Could not create HR manager.'),
  });

  return (
    <GlassCard className="p-5 space-y-4">
      {/* Panel header */}
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[rgba(var(--accent-rgb),0.12)] text-[#60a5fa]"
          aria-hidden="true"
        >
          <Users size={17} />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold text-white">
            HR managers — {company.name}
          </h3>
          <p className="text-[12px] text-[#888b91]">
            Create accounts; they log in and reset the password.
          </p>
        </div>
      </div>

      {/* Create HR form */}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim() || !fullName.trim()) {
            toast.error('Email and name are required.');
            return;
          }
          createMut.mutate();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hr-email" className="text-[12px] font-medium text-[#b8babf]">
            Email
          </label>
          <Input
            id="hr-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hr@company.com"
            aria-required="true"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hr-name" className="text-[12px] font-medium text-[#b8babf]">
            Full name
          </label>
          <Input
            id="hr-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="HR Manager"
            aria-required="true"
          />
        </div>
        <Button
          type="submit"
          disabled={createMut.isPending}
          className="gap-1.5"
          aria-busy={createMut.isPending}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {createMut.isPending ? 'Adding…' : 'Add HR'}
        </Button>
      </form>

      {/* Default password hint */}
      <p className="flex items-center gap-1.5 text-[12px] text-[#888b91]">
        <KeyRound className="h-3 w-3 text-[#60a5fa]" aria-hidden="true" />
        Default password{' '}
        <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white">
          {DEFAULT_PW}
        </code>{' '}
        — they must change it on first login.
      </p>

      {/* HR list */}
      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-[12px] bg-white/[0.05]" />
      ) : !hrs || hrs.length === 0 ? (
        <p className="text-[13px] text-[#888b91] py-2">No HR managers yet.</p>
      ) : (
        <div role="list" aria-label={`HR managers for ${company.name}`}>
          {hrs.map((hr) => (
            <div
              key={hr.user_id}
              role="listitem"
              className="flex items-center justify-between rounded-[14px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 mb-2 last:mb-0"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar
                  initials={initialsOf(hr.full_name)}
                  gradient={gradientFor(hr.user_id.charCodeAt(0))}
                  size={30}
                />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-white truncate">
                    {hr.full_name}
                  </p>
                  <p className="text-[12px] text-[#888b91] truncate">{hr.email}</p>
                </div>
              </div>
              {hr.must_change_password ? (
                <Badge variant="outline" className="text-xs shrink-0">
                  pending first login
                </Badge>
              ) : (
                <Badge variant="success" className="text-xs gap-1 shrink-0">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  active
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

// ── Feature flags tab — live ──────────────────────────────────────────────────

function FeatureFlagsTab(): JSX.Element {
  const qc = useQueryClient();

  const { data: flags, isLoading, isError } = useQuery<FeatureFlag[]>({
    queryKey: ['feature-flags'],
    queryFn: listFeatureFlags,
    retry: false,
    throwOnError: false,
  });

  const toggleMut = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      setFeatureFlag(key, enabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feature-flags'] });
      toast.success('Feature flag updated.');
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Could not update flag.'),
  });

  return (
    <div className="mt-5 space-y-4" aria-live="polite">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[rgba(var(--accent-rgb),0.12)] text-[#60a5fa]"
          aria-hidden="true"
        >
          <ToggleLeft size={17} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-white">Feature flags</h2>
          <p className="text-[12px] text-[#888b91]">Toggle platform features globally.</p>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[24px] bg-white/[0.05]" />
          ))}
        </div>
      )}

      {/* Error / not-migrated state */}
      {!isLoading && isError && (
        <GlassCard className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ffb764]" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-semibold text-white">
                Feature flags unavailable — run the latest migration.
              </p>
              <p className="mt-1 text-[12.5px] text-[#888b91]">
                The{' '}
                <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-white">
                  feature_flags
                </code>{' '}
                table does not exist yet. Apply the pending schema migration and reload.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty state */}
      {!isLoading && !isError && flags && flags.length === 0 && (
        <GlassCard className="p-8 text-center">
          <p className="text-[13px] text-[#888b91]">No feature flags defined yet.</p>
        </GlassCard>
      )}

      {/* Flag cards — design: 2-col grid with icon + toggle */}
      {!isLoading && !isError && flags && flags.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="list" aria-label="Feature flags">
          {flags.map((flag) => (
            <GlassCard
              key={flag.key}
              className="flex items-center gap-4 p-5"
            >
              <span
                className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-white/[0.05] text-[#60a5fa]"
                aria-hidden="true"
              >
                <Building2 size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14.5px] font-semibold text-white truncate">
                  {flag.label}
                </p>
                {flag.description && (
                  <p className="text-[12.5px] text-[#888b91] truncate">
                    {flag.description}
                  </p>
                )}
                <p className="mt-0.5 font-mono text-[11px] text-[#5a5f66]">{flag.key}</p>
              </div>
              <ToggleSwitch
                checked={flag.enabled}
                label={`Toggle ${flag.label}`}
                onChange={(next) =>
                  toggleMut.mutate({ key: flag.key, enabled: next })
                }
              />
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audit log tab helpers ─────────────────────────────────────────────────────

type AuditKind = 'admin_action' | 'consent_granted' | 'consent_denied' | 'consent_revoked';

const KIND_TONE: Record<AuditKind, TagTone> = {
  admin_action: 'electric',
  consent_granted: 'forest',
  consent_denied: 'ember',
  consent_revoked: 'ember',
};

const KIND_LABEL: Record<AuditKind, string> = {
  admin_action: 'Admin action',
  consent_granted: 'Consent granted',
  consent_denied: 'Consent denied',
  consent_revoked: 'Consent revoked',
};

function toneForKind(kind: string): TagTone {
  return (KIND_TONE as Record<string, TagTone>)[kind] ?? 'neutral';
}

function labelForKind(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind;
}

function relativeTs(isoTs: string): string {
  const diff = Date.now() - new Date(isoTs).getTime();
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(isoTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Audit log tab — live ──────────────────────────────────────────────────────

function AuditLogTab(): JSX.Element {
  const { data: events, isLoading } = useQuery<AuditEvent[]>({
    queryKey: ['audit-log'],
    queryFn: () => listAuditLog(100),
    retry: false,
    throwOnError: false,
  });

  return (
    <GlassCard className="mt-5 p-5">
      <h3 className="mb-4 flex items-center gap-2 text-[16px] font-semibold text-white">
        <ShieldCheck size={17} className="text-[#27c93f]" aria-hidden="true" />
        DPDP audit log
      </h3>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[10px] bg-white/[0.05]" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!events || events.length === 0) && (
        <div className="py-8 text-center">
          <ClipboardList
            className="mx-auto mb-3 h-8 w-8 text-[#5a5f66]"
            aria-hidden="true"
          />
          <p className="text-[13px] text-[#888b91]">No audit events yet.</p>
        </div>
      )}

      {/* Event list — design layout */}
      {!isLoading && events && events.length > 0 && (
        <div className="flex flex-col" aria-label="Audit event list" role="list">
          {events.map((ev, idx) => (
            <div
              key={idx}
              role="listitem"
              className="flex items-center gap-3 border-b border-white/[0.05] py-3 last:border-0"
            >
              <span className="font-mono text-[11.5px] text-[#5a5f66] shrink-0">
                {relativeTs(ev.ts)}
              </span>
              <StatusTag tone={toneForKind(ev.kind)} dot>
                {labelForKind(ev.kind)}
              </StatusTag>
              <div className="flex-1 text-[13px] min-w-0">
                <span className="text-white">{ev.summary}</span>{' '}
                <span className="text-[#70757c]">· {ev.actor}</span>
              </div>
              <time
                dateTime={ev.ts}
                className="shrink-0 font-mono text-[11.5px] text-[#888b91] tabular-nums"
                title={new Date(ev.ts).toLocaleString('en-IN')}
              >
                {new Date(ev.ts).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SuperAdminConsole() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState('');
  const [view, setView] = useState<ViewKey>('companies');

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: listCompanies,
  });

  const createMut = useMutation({
    mutationFn: () => createCompany(newCompany.trim()),
    onSuccess: (c) => {
      toast.success(`Company "${c.name}" created.`);
      setNewCompany('');
      setSelectedId(c.id);
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Could not create company.'),
  });

  const selected = companies?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-[1280px] px-0 py-2 space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-1px] text-white">
              Super Admin
            </h1>
            <p className="mt-1 text-[14px] text-[#888b91]">
              Tenants, access and platform governance.
            </p>
          </div>
          {/* Add tenant — focuses the create-company input */}
          <Pill
            variant="primary"
            className="px-5 py-2.5"
            type="button"
            onClick={() => {
              setView('companies');
              setTimeout(
                () =>
                  (
                    document.getElementById('new-company-input') as HTMLInputElement | null
                  )?.focus(),
                50,
              );
            }}
            aria-label="Add a new tenant company"
          >
            <Plus size={16} aria-hidden="true" />
            Add tenant
          </Pill>
        </div>
      </Reveal>

      {/* ── Platform-wide stat tiles (design data) ───────────────────────── */}
      <Reveal delay={0.05}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SUPER_STATS.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
      </Reveal>

      {/* ── Tab switcher ────────────────────────────────────────────────── */}
      <Reveal delay={0.08}>
        <SegTabs
          tabs={VIEW_TABS as unknown as { key: string; label: string }[]}
          active={view}
          onChange={(k) => setView(k as ViewKey)}
        />
      </Reveal>

      {/* ══════════════════════════════════════════════════════════════════
          TAB: Companies — design table layout + live interaction
      ══════════════════════════════════════════════════════════════════ */}
      {view === 'companies' && (
        <div className="space-y-5">
          {/* Create company form */}
          <GlassCard className="p-4">
            <form
              className="flex gap-2 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCompany.trim()) {
                  toast.error('Company name is required.');
                  return;
                }
                createMut.mutate();
              }}
            >
              <Building2 className="h-4 w-4 text-[#60a5fa] shrink-0" aria-hidden="true" />
              <Input
                id="new-company-input"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="New company name"
                aria-label="New company name"
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={createMut.isPending}
                className="gap-1.5 shrink-0"
                aria-busy={createMut.isPending}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {createMut.isPending ? '…' : 'Create'}
              </Button>
            </form>
          </GlassCard>

          {/* Companies table — design layout */}
          {isLoading ? (
            <Skeleton className="h-48 w-full rounded-[24px] bg-white/[0.04]" />
          ) : !companies || companies.length === 0 ? (
            <GlassCard className="p-8 text-center">
              <p className="text-[13px] text-[#888b91]">
                No companies yet — create your first one above.
              </p>
            </GlassCard>
          ) : (
            <GlassCard className="overflow-hidden p-0">
              {/* Table header */}
              <div className="grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 border-b border-white/[0.06] px-6 py-3.5 text-[11.5px] uppercase tracking-[0.5px] text-[#70757c]">
                <div>Tenant</div>
                <div>HR managers</div>
                <div>Slug</div>
                <div>Created</div>
                <div>Status</div>
              </div>

              {/* Table rows — clickable, drives HR panel */}
              {companies.map((c) => (
                <motion.button
                  key={c.id}
                  type="button"
                  whileTap={{ scale: 0.995 }}
                  onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  className={cn(
                    'grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] items-center gap-3 w-full text-left',
                    'border-b border-white/[0.04] px-6 py-3.5 last:border-0 transition-colors',
                    c.id === selectedId
                      ? 'bg-[rgba(var(--accent-rgb),0.06)]'
                      : 'hover:bg-white/[0.02]',
                  )}
                  aria-pressed={c.id === selectedId}
                  aria-label={`Select ${c.name}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar
                      initials={initialsOf(c.name)}
                      gradient={gradientFor(c.name.charCodeAt(0))}
                      size={34}
                    />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-white truncate">
                        {c.name}
                      </p>
                    </div>
                  </div>
                  {/* Real hr_count from live API */}
                  <div className="flex items-center gap-1.5 text-[13.5px] text-[#b8babf]">
                    <Users className="h-3 w-3 text-[#888b91]" aria-hidden="true" />
                    {c.hr_count}
                  </div>
                  <div className="font-mono text-[12.5px] text-[#888b91] truncate">
                    {c.slug}
                  </div>
                  <div className="font-mono text-[12.5px] text-[#888b91]">
                    {new Date(c.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                  <div>
                    <StatusTag
                      tone={c.is_active ? STATUS_TONE['Active'] : STATUS_TONE['Suspended']}
                      dot={c.is_active}
                    >
                      {c.is_active ? 'Active' : 'Suspended'}
                    </StatusTag>
                  </div>
                </motion.button>
              ))}
            </GlassCard>
          )}

          {/* HR panel — appears below table when a company is selected */}
          {selected ? (
            <HrPanel company={selected} />
          ) : companies && companies.length > 0 ? (
            <GlassCard className="p-5">
              <div className="py-6 text-center space-y-2">
                <Users className="mx-auto h-7 w-7 text-[#5a5f66]" aria-hidden="true" />
                <p className="text-[13px] text-[#888b91]">
                  Click a row above to manage its HR managers.
                </p>
              </div>
            </GlassCard>
          ) : null}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: Feature flags — live (listFeatureFlags + setFeatureFlag)
      ══════════════════════════════════════════════════════════════════ */}
      {view === 'flags' && <FeatureFlagsTab />}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: DPDP audit log — live (listAuditLog)
      ══════════════════════════════════════════════════════════════════ */}
      {view === 'audit' && <AuditLogTab />}
    </div>
  );
}
