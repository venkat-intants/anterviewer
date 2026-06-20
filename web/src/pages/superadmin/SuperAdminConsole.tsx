// SuperAdminConsole — platform owner view (HR workflow Phase 0).
// Manage tenant companies and the HR managers inside each.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Building2, Plus, UserPlus, Users, CheckCircle2, KeyRound } from 'lucide-react';
import {
  listCompanies,
  createCompany,
  listHrManagers,
  createHrManager,
  type Company,
} from '@/api/hr';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

// ── HR managers panel for the selected company ───────────────────────────────
function HrPanel({ company }: { company: Company }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('12345678');

  const { data: hrs, isLoading } = useQuery({
    queryKey: ['hr-managers', company.id],
    queryFn: () => listHrManagers(company.id),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createHrManager(company.id, { email: email.trim(), full_name: fullName.trim(), password }),
    onSuccess: () => {
      toast.success(`HR manager ${email} created.`);
      setEmail('');
      setFullName('');
      setPassword('12345678');
      void qc.invalidateQueries({ queryKey: ['hr-managers', company.id] });
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Could not create HR manager.'),
  });

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          HR managers — {company.name}
        </CardTitle>
        <CardDescription>Create accounts; they log in and reset the password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <div className="space-y-1">
            <label htmlFor="hr-email" className="text-xs font-medium text-muted-foreground">
              Email
            </label>
            <Input
              id="hr-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hr@company.com"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="hr-name" className="text-xs font-medium text-muted-foreground">
              Full name
            </label>
            <Input
              id="hr-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="HR Manager"
            />
          </div>
          <Button type="submit" disabled={createMut.isPending} className="gap-1.5">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {createMut.isPending ? 'Adding…' : 'Add HR'}
          </Button>
        </form>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound className="h-3 w-3" aria-hidden="true" />
          Default password <code className="rounded bg-muted px-1">{password}</code> — they must
          change it on first login.
        </p>

        {/* HR list */}
        {isLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : !hrs || hrs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No HR managers yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="HR manager list">
            {hrs.map((hr) => (
              <li
                key={hr.user_id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{hr.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{hr.email}</p>
                </div>
                {hr.must_change_password ? (
                  <Badge variant="outline" className="text-xs shrink-0">
                    pending first login
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    active
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SuperAdminConsole() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCompany, setNewCompany] = useState('');

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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Super Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage companies and their HR managers.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Companies column */}
        <div className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
                Companies
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newCompany.trim()) {
                    toast.error('Company name is required.');
                    return;
                  }
                  createMut.mutate();
                }}
              >
                <Input
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="New company name"
                  aria-label="New company name"
                />
                <Button type="submit" disabled={createMut.isPending} className="gap-1.5 shrink-0">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {createMut.isPending ? '…' : 'Create'}
                </Button>
              </form>

              {isLoading ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : !companies || companies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No companies yet — create your first one above.
                </p>
              ) : (
                <ul className="space-y-2" aria-label="Company list">
                  {companies.map((c) => (
                    <li key={c.id}>
                      <motion.button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        whileTap={{ scale: 0.99 }}
                        className={cn(
                          'w-full text-left flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors',
                          c.id === selectedId
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border bg-card hover:border-primary/30 hover:bg-accent',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{c.slug}</p>
                        </div>
                        <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {c.hr_count}
                        </Badge>
                      </motion.button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* HR managers column */}
        <div className="space-y-4">
          {selected ? (
            <HrPanel company={selected} />
          ) : (
            <Card className="shadow-sm border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a company to manage its HR managers.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
