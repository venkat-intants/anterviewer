// AdminInterviews — filterable, sortable, paginated admin interview list.
// Route: /admin/interviews (inside AdminRoute + AppShell)
// Filters: date range, status, language, score range, free-text search (q).
// Sort: created_at (default desc) or composite_score.
// Row click: navigates to /admin/interviews/:sessionId
// Export: CSV download via exportInterviewsCsv().

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  ClipboardList,
  ArrowUpDown,
} from 'lucide-react';
import { listInterviews, exportInterviewsCsv } from '@/api/admin';
import type { InterviewListItem, InterviewFilters } from '@/api/admin';
import { toast } from '@/lib/toast';
import { formatDate, formatDuration, statusProps, languageLabel } from '@/lib/formatters';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── Constants ──────────────────────────────────────────────────────────────────

const PER_PAGE = 20;

function fmtScore(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

// ── Animation ──────────────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

// ── Filter bar ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: InterviewFilters;
  onFiltersChange: (f: Partial<InterviewFilters>) => void;
  onExport: () => void;
  exporting: boolean;
}

function FilterBar({ filters, onFiltersChange, onExport, exporting }: FilterBarProps) {
  const [localQ, setLocalQ] = useState(filters.q ?? '');

  // Debounce the search field: apply after 400 ms idle
  useEffect(() => {
    const id = setTimeout(() => {
      const next = localQ.trim() || undefined;
      if (next !== filters.q) {
        onFiltersChange({ q: next, page: 1 });
      }
    }, 400);
    return () => clearTimeout(id);
  }, [localQ, filters.q, onFiltersChange]);

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* Full-text search */}
      <div className="relative min-w-[180px] flex-1">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search candidate…"
          value={localQ}
          onChange={(e) => setLocalQ(e.target.value)}
          className="pl-8"
          aria-label="Search by candidate name or email"
          data-testid="filter-search"
        />
      </div>

      {/* Status filter */}
      <Select
        value={filters.status ?? '__all__'}
        onValueChange={(v) =>
          onFiltersChange({ status: v === '__all__' ? undefined : v, page: 1 })
        }
      >
        <SelectTrigger className="w-[140px]" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All statuses</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="abandoned">Abandoned</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>

      {/* Language filter */}
      <Select
        value={filters.language ?? '__all__'}
        onValueChange={(v) =>
          onFiltersChange({ language: v === '__all__' ? undefined : v, page: 1 })
        }
      >
        <SelectTrigger className="w-[130px]" aria-label="Filter by language">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All languages</SelectItem>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="hi">Hindi</SelectItem>
          <SelectItem value="te">Telugu</SelectItem>
        </SelectContent>
      </Select>

      {/* Sort */}
      <Select
        value={`${filters.sort_by ?? 'created_at'}_${String(filters.sort_desc !== false)}`}
        onValueChange={(v) => {
          const i = v.lastIndexOf('_');
          const by = v.slice(0, i) as 'created_at' | 'composite_score';
          const descStr = v.slice(i + 1);
          onFiltersChange({ sort_by: by, sort_desc: descStr === 'true', page: 1 });
        }}
      >
        <SelectTrigger className="w-[160px]" aria-label="Sort order">
          <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created_at_true">Newest first</SelectItem>
          <SelectItem value="created_at_false">Oldest first</SelectItem>
          <SelectItem value="composite_score_true">Score (high → low)</SelectItem>
          <SelectItem value="composite_score_false">Score (low → high)</SelectItem>
        </SelectContent>
      </Select>

      {/* Export CSV */}
      <Button
        variant="outline"
        size="sm"
        onClick={onExport}
        disabled={exporting}
        className="gap-1.5 shrink-0"
        aria-label="Export interviews as CSV"
        data-testid="export-csv-btn"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {exporting ? 'Exporting…' : 'Export CSV'}
      </Button>
    </div>
  );
}

// ── Loading skeletons ──────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i} aria-hidden="true">
          {Array.from({ length: 8 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full rounded" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center gap-4"
      data-testid="interviews-empty-state"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <ClipboardList className="h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium text-foreground">
          {hasFilters ? 'No interviews match your filters' : 'No interviews yet'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasFilters
            ? 'Try adjusting your search or filters.'
            : 'Interview sessions will appear here once candidates start.'}
        </p>
      </div>
    </div>
  );
}

// ── Table row ──────────────────────────────────────────────────────────────────

interface InterviewRowProps {
  item: InterviewListItem;
  onClick: (sessionId: string) => void;
}

function InterviewRow({ item, onClick }: InterviewRowProps) {
  const { label, variant } = statusProps(item.status);

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => onClick(item.session_id)}
      data-testid={`interview-row-${item.session_id}`}
      aria-label={`Interview for ${item.candidate_name ?? item.candidate_email}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(item.session_id);
        }
      }}
    >
      <TableCell className="font-medium text-foreground max-w-[160px] truncate">
        {item.candidate_name ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
        {item.candidate_email}
      </TableCell>
      <TableCell className="text-sm text-foreground max-w-[140px] truncate">
        {item.job_title ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        <Badge variant={variant} className="text-xs whitespace-nowrap">
          {label}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {languageLabel(item.language)}
      </TableCell>
      <TableCell className="text-sm tabular-nums text-right font-medium">
        {fmtScore(item.composite_score)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {formatDate(item.created_at)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {formatDuration(item.duration_seconds)}
      </TableCell>
    </TableRow>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPrev: () => void;
  onNext: () => void;
}

function PaginationBar({ page, totalPages, total, perPage, onPrev, onNext }: PaginationBarProps) {
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  return (
    <div className="flex items-center justify-between pt-2 flex-wrap gap-2" aria-label="Pagination">
      <span className="text-sm text-muted-foreground tabular-nums">
        {total > 0 ? `${start}–${end} of ${total.toLocaleString()}` : '0 results'}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={page <= 1}
          aria-label="Previous page"
          className="gap-1.5"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="gap-1.5"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ── AdminInterviews page ───────────────────────────────────────────────────────

export default function AdminInterviews() {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const [filters, setFilters] = useState<InterviewFilters>({
    page: 1,
    per_page: PER_PAGE,
    sort_by: 'created_at',
    sort_desc: true,
  });

  const updateFilters = useCallback((patch: Partial<InterviewFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'interviews', filters],
    queryFn: () => listInterviews(filters),
    staleTime: 60 * 1000,
    retry: false,
    throwOnError: false,
  });

  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load interview list.',
      );
    }
  }, [isError, error]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportInterviewsCsv(filters);
      toast.success('CSV download started.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [filters]);

  const handleRowClick = useCallback(
    (sessionId: string) => {
      void navigate(`/admin/interviews/${sessionId}`);
    },
    [navigate],
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = filters.page ?? 1;
  const perPage = data?.per_page ?? PER_PAGE;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const hasFilters = Boolean(
    filters.q ||
      filters.status ||
      filters.language ||
      filters.min_score !== undefined ||
      filters.max_score !== undefined ||
      filters.date_from ||
      filters.date_to,
  );

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-6">
      {/* Page heading */}
      <motion.div variants={fadeUp}>
        <h1 className="text-2xl font-bold text-foreground">Interviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All candidate interview sessions. Click a row to view full detail.
        </p>
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeUp}>
        <FilterBar
          filters={filters}
          onFiltersChange={updateFilters}
          onExport={() => void handleExport()}
          exporting={exporting}
        />
      </motion.div>

      {/* Table */}
      <motion.div variants={fadeUp}>
        {isError && !isLoading ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 py-16 gap-3 text-center"
          >
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <p className="font-medium text-foreground">Failed to load interviews</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : !isLoading && items.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base">Sessions</CardTitle>
                  <CardDescription className="mt-0.5">
                    {isLoading ? 'Loading…' : `${total.toLocaleString()} interview${total !== 1 ? 's' : ''}`}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Language</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <LoadingRows />
                    ) : (
                      items.map((item) => (
                        <InterviewRow
                          key={item.session_id}
                          item={item}
                          onClick={handleRowClick}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {!isLoading && totalPages > 1 && (
                <div className="px-6 pb-5 pt-2">
                  <PaginationBar
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    perPage={perPage}
                    onPrev={() => updateFilters({ page: Math.max(1, page - 1) })}
                    onNext={() => updateFilters({ page: Math.min(totalPages, page + 1) })}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </motion.div>
  );
}
