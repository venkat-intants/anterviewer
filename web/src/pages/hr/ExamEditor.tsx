// ExamEditor — author questions, tune settings, publish, and assign (HR Phase 2).
// Layout: design screen ExamEditor.tsx (GlassCard skin, Pill buttons, StatusTag).
// Behavior: all live logic — MCQ model, addQuestion/deleteQuestion, publish/unpublish,
//           thresholdMut, attempt-lock banner, full assign+magic-link+revoke panel.

import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Check,
  Copy,
  Send,
  Ban,
  Lock,
  BarChart3,
  Loader2,
  ListChecks,
  ClipboardList,
  Clock,
  Sparkles,
  Upload,
  Download,
  FileText,
  AlertTriangle,
  X,
  Pencil,
} from '@/design/components/icons';
import {
  getExam,
  updateExam,
  addQuestion,
  deleteQuestion,
  listAssignments,
  assignExam,
  revokeAssignment,
  generateQuestions,
  bulkAddQuestions,
  importQuestions,
  downloadQuestionTemplate,
  type AssignResult,
  type GeneratedQuestion,
  type ImportResult,
  type ExamDifficulty,
  type ExamLanguage,
} from '@/api/exams';
import { listApplicants } from '@/api/applicants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  GlassCard,
  Pill,
  StatusTag,
} from '@/design/components/primitives';
import { Reveal, Stagger, StaggerItem } from '@/design/components/Reveal';

// ── Status helpers ────────────────────────────────────────────────────────────

type TagToneKey = 'neutral' | 'forest' | 'amber';

function statusTone(s: string): { label: string; tone: TagToneKey } {
  switch (s) {
    case 'published':
      return { label: 'Published', tone: 'forest' };
    case 'closed':
      return { label: 'Closed', tone: 'neutral' };
    default:
      return { label: 'Draft', tone: 'amber' };
  }
}

// ── Shared input class (design convention) ────────────────────────────────────

const inputCls =
  'w-full rounded-[10px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-3 py-2 ' +
  'text-[14px] text-white placeholder:text-[#5a5f66] focus:outline-none ' +
  'focus:border-[var(--accent)] transition-colors';

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ExamEditor() {
  const { examId = '' } = useParams<{ examId: string }>();
  const qc = useQueryClient();
  const examKey = ['hr', 'exam', examId];

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: exam, isLoading } = useQuery({
    queryKey: examKey,
    queryFn: () => getExam(examId),
  });
  const { data: applicants } = useQuery({
    queryKey: ['hr', 'applicants'],
    queryFn: () => listApplicants(),
  });
  const { data: assignments } = useQuery({
    queryKey: ['hr', 'exam', examId, 'assignments'],
    queryFn: () => listAssignments(examId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: examKey });
    void qc.invalidateQueries({ queryKey: ['hr', 'exams'] });
  };

  // ── Composer: three ways to add questions ──────────────────────────────────
  const [composerTab, setComposerTab] = useState<'manual' | 'ai' | 'excel'>('manual');

  // Manual MCQ model — prompt + 4 options (default) + correct_index + points.
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correctIdx, setCorrectIdx] = useState(0);
  const [points, setPoints] = useState('1');

  // AI (Gemini) generation
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState('5');
  const [aiDifficulty, setAiDifficulty] = useState<ExamDifficulty>('medium');
  const [aiLanguage, setAiLanguage] = useState<ExamLanguage>('en');
  const [aiPreview, setAiPreview] = useState<GeneratedQuestion[]>([]);

  // Excel / CSV bulk import
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Assign state ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minted, setMinted] = useState<AssignResult[]>([]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const publishMut = useMutation({
    mutationFn: (status: 'draft' | 'published') => updateExam(examId, { status }),
    onSuccess: () => refresh(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });

  const thresholdMut = useMutation({
    mutationFn: (pass_threshold: number) => updateExam(examId, { pass_threshold }),
    onSuccess: () => {
      toast.success('Saved');
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const addMut = useMutation({
    mutationFn: () =>
      addQuestion(examId, {
        prompt: prompt.trim(),
        options: options.map((o) => o.trim()),
        correct_index: correctIdx,
        points: Number(points) || 1,
      }),
    onSuccess: () => {
      setPrompt('');
      setOptions(['', '', '', '']);
      setCorrectIdx(0);
      setPoints('1');
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Add failed'),
  });

  const generateMut = useMutation({
    mutationFn: () =>
      generateQuestions(examId, {
        topic: aiTopic.trim(),
        num_questions: Math.max(1, Math.min(30, Number(aiCount) || 5)),
        difficulty: aiDifficulty,
        language: aiLanguage,
      }),
    onSuccess: (res) => {
      setAiPreview(res.questions);
      if (res.questions.length === 0) toast.error('No questions generated — try again.');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Generation failed'),
  });

  const addGeneratedMut = useMutation({
    mutationFn: (questions: GeneratedQuestion[]) =>
      bulkAddQuestions(
        examId,
        questions.map((q) => ({
          prompt: q.prompt,
          options: q.options,
          correct_index: q.correct_index,
          points: q.points,
        })),
      ),
    onSuccess: (created) => {
      setAiPreview([]);
      toast.success(`${created.length} question(s) added`);
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Add failed'),
  });

  const importMut = useMutation({
    mutationFn: (file: File) => importQuestions(examId, file),
    onSuccess: (res) => {
      setImportResult(res);
      if (res.added > 0) toast.success(`${res.added} question(s) imported`);
      if (res.added === 0) toast.error('No questions imported — check the file.');
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const delMut = useMutation({
    mutationFn: (qid: string) => deleteQuestion(examId, qid),
    onSuccess: () => refresh(),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const assignMut = useMutation({
    mutationFn: () => assignExam(examId, [...selected]),
    onSuccess: (res) => {
      setMinted(res);
      setSelected(new Set());
      toast.success(`${res.length} link(s) created`);
      void qc.invalidateQueries({ queryKey: ['hr', 'exam', examId, 'assignments'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Assign failed'),
  });

  const revokeMut = useMutation({
    mutationFn: (aid: string) => revokeAssignment(examId, aid),
    onSuccess: () => {
      toast.success('Link revoked');
      void qc.invalidateQueries({ queryKey: ['hr', 'exam', examId, 'assignments'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Revoke failed'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  function submitQuestion(ev: React.FormEvent) {
    ev.preventDefault();
    if (!prompt.trim()) return toast.error('Question prompt is required.');
    const filled = options.map((o) => o.trim());
    if (filled.some((o) => !o)) return toast.error('All option fields must be filled.');
    if (correctIdx >= filled.length) return toast.error('Pick the correct answer.');
    addMut.mutate();
  }

  function handleGenerate(ev: React.FormEvent) {
    ev.preventDefault();
    if (!aiTopic.trim()) return toast.error('Enter a topic or role for the AI to use.');
    generateMut.mutate();
  }

  function handleFilePick(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (file) {
      setImportResult(null);
      importMut.mutate(file);
    }
    ev.target.value = ''; // let HR re-pick the same file after a fix
  }

  async function handleDownloadTemplate() {
    try {
      await downloadQuestionTemplate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Template download failed');
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  function toggleApplicant(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // ── Loading guard ──────────────────────────────────────────────────────────
  if (isLoading || !exam) {
    return (
      <div className="mx-auto max-w-[920px] px-6 py-8 lg:px-8 space-y-4">
        <div className="h-5 w-28 rounded-xl bg-white/[0.07] animate-pulse" />
        <div className="h-10 w-64 rounded-xl bg-white/[0.07] animate-pulse" />
        <div className="h-40 w-full rounded-[24px] bg-white/[0.05] animate-pulse" />
        <div className="h-48 w-full rounded-[24px] bg-white/[0.05] animate-pulse" />
      </div>
    );
  }

  const questionCount = exam.questions.length;
  const timeLimitMin = exam.time_limit_seconds
    ? Math.round(exam.time_limit_seconds / 60)
    : null;
  const locked = (exam.attempt_count ?? 0) > 0;
  const isPublished = exam.status === 'published';
  const { label: statusLabel, tone: statusToneKey } = statusTone(exam.status ?? 'draft');

  return (
    <div className="mx-auto max-w-[920px] px-6 py-8 lg:px-8">
      {/* ── Breadcrumb ── */}
      <Reveal>
        <Link
          to="/hr/exams"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#888b91] hover:text-white transition-colors"
        >
          <ArrowLeft size={15} aria-hidden="true" /> Back to exams
        </Link>

        {/* ── Header row ── */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(var(--accent-rgb),0.14)] text-[#60a5fa]">
              <ClipboardList size={20} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-[26px] font-semibold tracking-[-0.8px] text-white">
                {exam.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Link to={`/hr/exams/${examId}/results`}>
              <Pill variant="ghost" className="px-4 py-2.5 gap-2">
                <BarChart3 size={15} aria-hidden="true" /> Results
              </Pill>
            </Link>
            <Pill
              variant={isPublished ? 'ghost' : 'primary'}
              className="px-5 py-2.5"
              disabled={publishMut.isPending}
              aria-busy={publishMut.isPending}
              onClick={() => publishMut.mutate(isPublished ? 'draft' : 'published')}
            >
              {publishMut.isPending ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : null}
              {isPublished ? 'Unpublish' : 'Publish'}
            </Pill>
          </div>
        </div>

        {/* ── Meta row ── */}
        <div className="mt-4 flex items-center gap-4 text-[13px] text-[#888b91]">
          <span className="flex items-center gap-1.5">
            <ListChecks size={15} aria-hidden="true" />
            {questionCount} question{questionCount !== 1 ? 's' : ''}
          </span>
          {timeLimitMin !== null && (
            <span className="flex items-center gap-1.5">
              <Clock size={15} aria-hidden="true" /> ~{timeLimitMin} min
            </span>
          )}
          <span className="flex items-center gap-1.5">
            pass &ge; {exam.pass_threshold}%
          </span>
          <StatusTag tone={statusToneKey}>{statusLabel}</StatusTag>
        </div>
      </Reveal>

      {/* ── Attempt-lock amber banner ── */}
      {locked && (
        <Reveal delay={0.04}>
          <div
            role="alert"
            className="mt-5 flex items-center gap-2.5 rounded-[16px] border border-[rgba(255,183,100,0.3)] bg-[rgba(255,183,100,0.08)] px-4 py-3 text-[13px] text-[#ffb764]"
          >
            <Lock size={16} className="shrink-0" aria-hidden="true" />
            This exam has attempts — questions are locked to protect grading integrity.
          </div>
        </Reveal>
      )}

      {/* ── Settings ── */}
      <Reveal delay={0.06}>
        <GlassCard className="mt-5 p-5">
          <p className="text-[14px] font-semibold text-white">Settings</p>
          <p className="mt-0.5 text-[12.5px] text-[#888b91]">Adjust pass threshold; changes save on blur.</p>
          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="text-[12px] uppercase tracking-[0.5px] text-[#70757c]">Pass threshold %</span>
            <input
              type="number"
              min={0}
              max={100}
              defaultValue={exam.pass_threshold}
              className={cn(inputCls, 'max-w-[180px]')}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== exam.pass_threshold && v >= 0 && v <= 100) thresholdMut.mutate(v);
              }}
              aria-label="Pass threshold"
            />
          </label>
        </GlassCard>
      </Reveal>

      {/* ── Questions ── */}
      <Reveal delay={0.1}>
        <GlassCard className="mt-5 p-5">
          <p className="text-[14px] font-semibold text-white">
            Questions ({questionCount})
          </p>
          <p className="mt-0.5 text-[12.5px] text-[#888b91]">
            One correct option per question. Worth the listed points.
          </p>

          <div className="mt-4 flex flex-col gap-3">
            {/* Existing questions */}
            {questionCount > 0 && (
              <Stagger className="flex flex-col gap-2.5">
                {exam.questions.map((q, i) => (
                  <StaggerItem key={q.id}>
                    <div className="rounded-[16px] border border-white/[0.08] bg-[rgba(28,29,31,0.5)] p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/[0.06] font-mono text-[12px] text-[#b8babf]">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium leading-snug text-white">
                            {q.prompt}{' '}
                            <span className="font-normal text-[#888b91]">({q.points} pt)</span>
                          </p>
                          <ul className="mt-2.5 space-y-1 pl-0">
                            {q.options.map((opt, oi) => (
                              <li
                                key={oi}
                                className={cn(
                                  'flex items-center gap-2 text-[13px]',
                                  oi === q.correct_index
                                    ? 'font-medium text-[#27c93f]'
                                    : 'text-[#888b91]',
                                )}
                              >
                                {oi === q.correct_index ? (
                                  <Check size={14} className="shrink-0" aria-hidden="true" />
                                ) : (
                                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                )}
                                {opt}
                              </li>
                            ))}
                          </ul>
                        </div>
                        {!locked && (
                          <button
                            type="button"
                            aria-label="Delete question"
                            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/[0.1] text-[#888b91] hover:border-[rgba(230,113,79,0.4)] hover:text-[#e6714f] transition-colors"
                            onClick={() => delMut.mutate(q.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            )}

            {/* Composer — three ways to add questions; hidden when locked */}
            {!locked && (
              <div className="rounded-[16px] border border-dashed border-white/[0.1] bg-[rgba(28,29,31,0.3)] p-4">
                {/* Tab bar */}
                <div
                  role="tablist"
                  aria-label="How to add questions"
                  className="mb-4 flex flex-wrap gap-1 rounded-[12px] border border-white/[0.08] bg-[rgba(20,21,23,0.6)] p-1"
                >
                  {[
                    { key: 'manual', label: 'Manual', icon: Pencil },
                    { key: 'ai', label: 'AI generate', icon: Sparkles },
                    { key: 'excel', label: 'Excel upload', icon: Upload },
                  ].map((t) => {
                    const Icon = t.icon;
                    const active = composerTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setComposerTab(t.key as 'manual' | 'ai' | 'excel')}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors',
                          active
                            ? 'bg-[rgba(var(--accent-rgb),0.16)] text-[#60a5fa]'
                            : 'text-[#888b91] hover:text-white',
                        )}
                      >
                        <Icon size={14} aria-hidden="true" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {/* ── Manual tab ── */}
                {composerTab === 'manual' && (
                  <form
                    onSubmit={submitQuestion}
                    className="space-y-3"
                    aria-label="New question composer"
                  >
                    <textarea
                      className={cn(inputCls, 'resize-none')}
                      rows={2}
                      placeholder="Question prompt…"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      aria-label="Question prompt"
                    />

                    <div className="space-y-2">
                      {options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="correct"
                            checked={correctIdx === oi}
                            onChange={() => setCorrectIdx(oi)}
                            className="h-4 w-4 flex-none accent-[var(--accent)]"
                            aria-label={`Mark option ${oi + 1} correct`}
                          />
                          <input
                            className={inputCls}
                            placeholder={`Option ${oi + 1}`}
                            value={opt}
                            onChange={(e) =>
                              setOptions((prev) =>
                                prev.map((o, j) => (j === oi ? e.target.value : o)),
                              )
                            }
                            aria-label={`Option ${oi + 1}`}
                          />
                          {options.length > 2 && (
                            <button
                              type="button"
                              aria-label="Remove option"
                              className="shrink-0 flex h-8 w-8 items-center justify-center rounded-[8px] border border-white/[0.1] text-[#888b91] hover:border-[rgba(230,113,79,0.4)] hover:text-[#e6714f] transition-colors"
                              onClick={() => {
                                setOptions((prev) => prev.filter((_, j) => j !== oi));
                                setCorrectIdx((c) => (c >= oi && c > 0 ? c - 1 : c));
                              }}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[11.5px] text-[#70757c]">
                      Select the radio next to the correct option.
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      {options.length < 6 && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-transparent px-3 py-1.5 text-[12.5px] text-[#888b91] hover:text-white hover:border-white/[0.2] transition-colors"
                          onClick={() => setOptions((prev) => [...prev, ''])}
                        >
                          <Plus size={13} aria-hidden="true" /> Add option
                        </button>
                      )}
                      <label className="ml-auto flex items-center gap-2 text-[12px] text-[#888b91]">
                        Points
                        <input
                          type="number"
                          min={1}
                          value={points}
                          onChange={(e) => setPoints(e.target.value)}
                          className="w-16 rounded-[8px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-2 py-1 text-[13px] text-white focus:outline-none focus:border-[var(--accent)] transition-colors"
                          aria-label="Points"
                        />
                      </label>
                      <Pill
                        type="submit"
                        variant="accent"
                        className="gap-1.5 px-4 py-2"
                        disabled={addMut.isPending}
                        aria-busy={addMut.isPending}
                      >
                        {addMut.isPending ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus size={14} aria-hidden="true" />
                        )}
                        Add question
                      </Pill>
                    </div>
                  </form>
                )}

                {/* ── AI generate tab ── */}
                {composerTab === 'ai' && (
                  <div className="space-y-3" aria-label="AI question generator">
                    <form onSubmit={handleGenerate} className="space-y-3">
                      <input
                        className={inputCls}
                        placeholder="Topic or role — e.g. “React fundamentals” or “Junior Java Developer”"
                        value={aiTopic}
                        onChange={(e) => setAiTopic(e.target.value)}
                        aria-label="Topic for AI generation"
                      />
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="flex flex-col gap-1 text-[12px] text-[#888b91]">
                          Questions
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={aiCount}
                            onChange={(e) => setAiCount(e.target.value)}
                            className="w-20 rounded-[8px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-2 py-1.5 text-[13px] text-white focus:outline-none focus:border-[var(--accent)]"
                            aria-label="Number of questions"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[12px] text-[#888b91]">
                          Difficulty
                          <select
                            value={aiDifficulty}
                            onChange={(e) => setAiDifficulty(e.target.value as ExamDifficulty)}
                            className="rounded-[8px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-2 py-1.5 text-[13px] text-white focus:outline-none focus:border-[var(--accent)]"
                            aria-label="Difficulty"
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                            <option value="mixed">Mixed</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1 text-[12px] text-[#888b91]">
                          Language
                          <select
                            value={aiLanguage}
                            onChange={(e) => setAiLanguage(e.target.value as ExamLanguage)}
                            className="rounded-[8px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-2 py-1.5 text-[13px] text-white focus:outline-none focus:border-[var(--accent)]"
                            aria-label="Language"
                          >
                            <option value="en">English</option>
                            <option value="hi">हिन्दी</option>
                            <option value="te">తెలుగు</option>
                          </select>
                        </label>
                        <Pill
                          type="submit"
                          variant="accent"
                          className="ml-auto gap-1.5 px-4 py-2"
                          disabled={generateMut.isPending}
                          aria-busy={generateMut.isPending}
                        >
                          {generateMut.isPending ? (
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Sparkles size={14} aria-hidden="true" />
                          )}
                          {generateMut.isPending ? 'Generating…' : 'Generate'}
                        </Pill>
                      </div>
                    </form>

                    {/* Preview of generated questions */}
                    {aiPreview.length > 0 && (
                      <div className="space-y-2.5 rounded-[14px] border border-[rgba(var(--accent-rgb),0.25)] bg-[rgba(var(--accent-rgb),0.05)] p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12.5px] font-semibold text-[#60a5fa]">
                            {aiPreview.length} draft question{aiPreview.length !== 1 ? 's' : ''} — review &amp; add
                          </p>
                          <button
                            type="button"
                            onClick={() => setAiPreview([])}
                            className="text-[12px] text-[#888b91] hover:text-white transition-colors"
                          >
                            Discard
                          </button>
                        </div>
                        <ul className="space-y-2">
                          {aiPreview.map((q, qi) => (
                            <li
                              key={qi}
                              className="rounded-[10px] border border-white/[0.08] bg-[rgba(28,29,31,0.5)] p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[13px] font-medium text-white">
                                  {qi + 1}. {q.prompt}
                                </p>
                                <button
                                  type="button"
                                  aria-label="Remove this draft"
                                  className="shrink-0 text-[#888b91] hover:text-[#e6714f] transition-colors"
                                  onClick={() =>
                                    setAiPreview((prev) => prev.filter((_, j) => j !== qi))
                                  }
                                >
                                  <X size={14} aria-hidden="true" />
                                </button>
                              </div>
                              <ul className="mt-1.5 space-y-0.5">
                                {q.options.map((opt, oi) => (
                                  <li
                                    key={oi}
                                    className={cn(
                                      'flex items-center gap-1.5 text-[12.5px]',
                                      oi === q.correct_index
                                        ? 'font-medium text-[#27c93f]'
                                        : 'text-[#888b91]',
                                    )}
                                  >
                                    {oi === q.correct_index ? (
                                      <Check size={12} className="shrink-0" aria-hidden="true" />
                                    ) : (
                                      <span className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    )}
                                    {opt}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                        <Pill
                          variant="accent"
                          className="gap-1.5 px-4 py-2"
                          disabled={addGeneratedMut.isPending}
                          aria-busy={addGeneratedMut.isPending}
                          onClick={() => addGeneratedMut.mutate(aiPreview)}
                        >
                          {addGeneratedMut.isPending ? (
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Plus size={14} aria-hidden="true" />
                          )}
                          Add {aiPreview.length} question{aiPreview.length !== 1 ? 's' : ''}
                        </Pill>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Excel upload tab ── */}
                {composerTab === 'excel' && (
                  <div className="space-y-3" aria-label="Excel/CSV bulk upload">
                    <p className="text-[12.5px] text-[#888b91]">
                      Upload an <span className="text-white">.xlsx</span> or{' '}
                      <span className="text-white">.csv</span> with one question per row:
                      {' '}Question · Option A–D · Correct (A/B/C/D) · Points.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownloadTemplate()}
                        className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/[0.12] bg-transparent px-3.5 py-2 text-[13px] text-[#b8babf] hover:text-white hover:border-white/[0.25] transition-colors"
                      >
                        <Download size={14} aria-hidden="true" /> Download template
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.csv"
                        onChange={handleFilePick}
                        className="hidden"
                        aria-label="Choose spreadsheet file"
                      />
                      <Pill
                        variant="accent"
                        className="gap-1.5 px-4 py-2"
                        disabled={importMut.isPending}
                        aria-busy={importMut.isPending}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {importMut.isPending ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Upload size={14} aria-hidden="true" />
                        )}
                        {importMut.isPending ? 'Uploading…' : 'Upload file'}
                      </Pill>
                    </div>

                    {/* Import result summary */}
                    {importResult && (
                      <div className="space-y-2 rounded-[14px] border border-white/[0.1] bg-[rgba(28,29,31,0.5)] p-3.5">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#27c93f]">
                          <FileText size={14} aria-hidden="true" />
                          {importResult.added} question{importResult.added !== 1 ? 's' : ''} imported
                        </p>
                        {importResult.errors.length > 0 && (
                          <div className="space-y-1">
                            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#ffb764]">
                              <AlertTriangle size={13} aria-hidden="true" />
                              {importResult.errors.length} row
                              {importResult.errors.length !== 1 ? 's' : ''} skipped
                            </p>
                            <ul className="max-h-32 space-y-0.5 overflow-y-auto pl-5 text-[12px] text-[#888b91]">
                              {importResult.errors.map((er, ei) => (
                                <li key={ei} className="list-disc">
                                  Row {er.row}: {er.message}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add question dashed button (when questions exist) */}
          {!locked && questionCount > 0 && (
            <button
              type="button"
              onClick={() => {
                /* scroll to form — it's always visible below */
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border-[1.5px] border-dashed border-white/15 py-3.5 text-[13.5px] font-medium text-[#60a5fa] transition-colors hover:border-[rgba(var(--accent-rgb),0.4)] hover:bg-[rgba(var(--accent-rgb),0.05)]"
            >
              <Plus size={17} aria-hidden="true" /> Add another question
            </button>
          )}
        </GlassCard>
      </Reveal>

      {/* ── Assign & share links ── */}
      <Reveal delay={0.14}>
        <GlassCard className="mt-5 p-5">
          <p className="text-[14px] font-semibold text-white">Assign &amp; share links</p>
          <p className="mt-0.5 text-[12.5px] text-[#888b91]">
            {isPublished
              ? 'Pick applicants and generate a private link each can use to take the exam.'
              : 'Publish the exam first, then assign it to applicants.'}
          </p>

          {isPublished && (
            <div className="mt-4 space-y-4">
              {/* Applicant checkbox list */}
              <div
                className="max-h-44 space-y-1 overflow-y-auto rounded-[16px] border border-white/[0.08] bg-[rgba(28,29,31,0.5)] p-2"
                aria-label="Select applicants to assign"
              >
                {(applicants ?? []).length === 0 ? (
                  <p className="px-2 py-3 text-[12.5px] text-[#888b91]">
                    No applicants yet — add them under Applicants.
                  </p>
                ) : (
                  (applicants ?? []).map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] text-white hover:bg-white/[0.04] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={(e) => toggleApplicant(a.id, e.target.checked)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="truncate">{a.full_name}</span>
                    </label>
                  ))
                )}
              </div>

              <Pill
                variant="accent"
                className="gap-1.5 px-5 py-2.5"
                disabled={assignMut.isPending || selected.size === 0}
                aria-busy={assignMut.isPending}
                onClick={() => assignMut.mutate()}
              >
                {assignMut.isPending ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send size={15} aria-hidden="true" />
                )}
                Generate links ({selected.size})
              </Pill>

              {/* Once-shown magic links panel */}
              {minted.length > 0 && (
                <div
                  role="region"
                  aria-label="Generated magic links"
                  className="space-y-2 rounded-[16px] border border-[rgba(39,201,63,0.3)] bg-[rgba(39,201,63,0.08)] p-3.5"
                >
                  <p className="text-[12.5px] font-semibold text-[#27c93f]">
                    Share each link now — shown once only:
                  </p>
                  {minted.map((m) => (
                    <div key={m.assignment_id} className="flex items-center gap-2 text-[12px]">
                      <span className="w-32 shrink-0 truncate font-medium text-white">
                        {m.applicant_name}
                      </span>
                      <input
                        readOnly
                        value={m.magic_link}
                        className="min-w-0 flex-1 rounded-[10px] border border-white/[0.1] bg-[rgba(28,29,31,0.6)] px-2 py-1 text-[#888b91] focus:outline-none"
                        aria-label={`Magic link for ${m.applicant_name}`}
                      />
                      <button
                        type="button"
                        aria-label={`Copy link for ${m.applicant_name}`}
                        className="shrink-0 flex h-7 w-7 items-center justify-center rounded-[8px] text-[#27c93f] hover:bg-[rgba(39,201,63,0.15)] transition-colors"
                        onClick={() => void copyLink(m.magic_link)}
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assigned list */}
          {(assignments ?? []).length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-[#70757c]">
                Assigned
              </p>
              {(assignments ?? []).map((a) => (
                <div
                  key={a.assignment_id}
                  className="flex items-center gap-2.5 rounded-[12px] border border-white/[0.08] bg-[rgba(28,29,31,0.4)] px-3 py-2 text-[13px] text-white"
                >
                  <span className="min-w-0 flex-1 truncate">{a.applicant_name}</span>
                  <StatusTag tone="neutral" className="text-[11px]">
                    {a.status}
                  </StatusTag>
                  {a.status === 'invited' && (
                    <button
                      type="button"
                      aria-label={`Revoke link for ${a.applicant_name}`}
                      className="shrink-0 flex h-7 w-7 items-center justify-center rounded-[8px] text-[#888b91] hover:border hover:border-[rgba(230,113,79,0.4)] hover:text-[#e6714f] transition-colors"
                      onClick={() => revokeMut.mutate(a.assignment_id)}
                    >
                      <Ban size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </Reveal>
    </div>
  );
}
