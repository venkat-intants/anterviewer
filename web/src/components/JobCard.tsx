// JobCard — shadcn Card with level Badge, language tag, description snippet,
// and a "Start Interview" CTA. Used by JobsList.

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Job } from '@/types/interview';

const LEVEL_LABEL: Record<string, string> = {
  entry: 'Entry Level',
  mid: 'Mid Level',
  senior: 'Senior Level',
};

// Map to shadcn Badge className overrides using design tokens only
const LEVEL_CLASS: Record<string, string> = {
  entry:
    'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800',
  mid: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800',
  senior:
    'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-800',
};

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  hi: 'हिंदी',
  te: 'తెలుగు',
};

interface JobCardProps {
  job: Job;
  onStartInterview: (jobId: string) => void;
  isStarting: boolean;
}

export default function JobCard({ job, onStartInterview, isStarting }: JobCardProps) {
  const levelLabel = LEVEL_LABEL[job.level] ?? job.level;
  const levelClass =
    LEVEL_CLASS[job.level] ?? 'bg-muted text-muted-foreground border-border hover:bg-muted';
  const langLabel = LANGUAGE_LABEL[job.language] ?? job.language.toUpperCase();

  return (
    <Card
      className={cn('flex flex-col h-full shadow-sm transition-shadow hover:shadow-md')}
      aria-label={`Job: ${job.title}`}
    >
      <CardHeader className="pb-3 gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground leading-snug flex-1">
            {job.title}
          </h2>
          <Badge
            variant="outline"
            className={cn('shrink-0 text-xs font-medium', levelClass)}
            aria-label={`Level: ${levelLabel}`}
          >
            {levelLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pt-0">
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
          {job.description}
        </p>
      </CardContent>

      <CardFooter className="pt-4 border-t border-border flex items-center justify-between gap-3">
        {/* Language tag */}
        <Badge
          variant="secondary"
          className="text-xs font-medium"
          aria-label={`Language: ${langLabel}`}
        >
          {langLabel}
        </Badge>

        <Button
          type="button"
          size="sm"
          onClick={() => onStartInterview(job.id)}
          disabled={isStarting}
          aria-label={`Start interview for ${job.title}`}
          aria-busy={isStarting}
        >
          {isStarting ? 'Starting...' : 'Start Interview'}
        </Button>
      </CardFooter>
    </Card>
  );
}
