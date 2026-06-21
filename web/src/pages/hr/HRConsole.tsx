// HRConsole — HR manager landing (HR workflow Phase 0 shell).
// The pipeline stages are stubbed here; each lights up as its phase ships
// (Phase 1: ATS screening, Phase 2: exams, Phase 3: interviews, Phase 4: results).

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileSearch, ClipboardCheck, Video, Trophy } from 'lucide-react';
import { getMe } from '@/api/auth';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Stage {
  icon: React.ReactNode;
  title: string;
  desc: string;
  phase: string;
  to?: string;
  live?: boolean;
}

const STAGES: Stage[] = [
  {
    icon: <FileSearch className="h-5 w-5" />,
    title: 'Resume screening (ATS)',
    desc: 'Upload applicant resumes and get AI fit-scores against the role.',
    phase: 'Phase 1',
    to: '/hr/applicants',
    live: true,
  },
  {
    icon: <ClipboardCheck className="h-5 w-5" />,
    title: 'MCQ exam',
    desc: 'Author a timed exam, set a pass threshold, auto-grade applicants.',
    phase: 'Phase 2',
  },
  {
    icon: <Video className="h-5 w-5" />,
    title: 'AI interview',
    desc: 'Schedule the avatar interview for shortlisted applicants.',
    phase: 'Phase 3',
  },
  {
    icon: <Trophy className="h-5 w-5" />,
    title: 'Results & decision',
    desc: 'One pipeline view: resume → exam → interview → hire decision.',
    phase: 'Phase 4',
  },
];

export default function HRConsole() {
  const { user } = useAuth();
  // Lightweight profile fetch so the greeting works even on a hard refresh.
  const { data: me } = useQuery({ queryKey: ['auth', 'me'], queryFn: () => getMe(), staleTime: 60_000 });
  const name = me?.full_name || user?.full_name || 'there';

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Welcome, {name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your hiring pipeline. Each stage activates as we roll it out.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {STAGES.map((s) => {
          const card = (
            <Card
              className={cn(
                'shadow-sm h-full',
                s.to && 'cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40',
              )}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {s.icon}
                  </span>
                  {s.live ? (
                    <Badge variant="default" className="text-xs shrink-0">
                      Live
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {s.phase} · soon
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base pt-2">{s.title}</CardTitle>
                <CardDescription>{s.desc}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          );
          return s.to ? (
            <Link key={s.title} to={s.to} className="block">
              {card}
            </Link>
          ) : (
            <div key={s.title}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
