// exams.ts — HR MCQ exam authoring + results API (HR workflow Phase 2).
// Calls data_gateway (VITE_API_BASE_URL) via the central authenticated client.
// Tenant-scoped server-side by the HR's company. correct_index is returned here
// (HR only); the applicant take path lives in publicExam.ts and never sees it.

import { apiGet, apiPost, apiPut, apiDelete, clientFetch, uploadWithProgress } from './client';
import { getToken } from './tokenStore';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const API_BASE: string = import.meta.env.VITE_API_BASE_URL;

export type ExamStatus = 'draft' | 'published' | 'closed';

export interface ExamQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  points: number;
  position: number;
}

export interface Exam {
  id: string;
  title: string;
  description: string | null;
  target_job_title: string | null;
  pass_threshold: number;
  time_limit_seconds: number | null;
  allow_retake: boolean;
  status: ExamStatus;
  created_at: string;
}

export interface ExamSummary extends Exam {
  question_count: number;
  attempt_count: number;
}

export interface ExamDetail extends Exam {
  questions: ExamQuestion[];
  attempt_count: number;
}

export interface Assignment {
  assignment_id: string;
  applicant_id: string;
  applicant_name: string;
  status: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AssignResult {
  assignment_id: string;
  applicant_id: string;
  applicant_name: string;
  magic_link: string;
  expires_at: string;
  status: string;
}

export interface AttemptResult {
  attempt_id: string;
  applicant_id: string;
  applicant_name: string;
  score_raw: number | null;
  score_max: number | null;
  score_percent: number | null;
  passed: boolean | null;
  status: string;
  submitted_at: string | null;
  attempt_no: number;
}

export interface ExamCreateInput {
  title: string;
  description?: string;
  target_job_title?: string;
  pass_threshold?: number;
  time_limit_seconds?: number | null;
  allow_retake?: boolean;
}

export type ExamUpdateInput = Partial<{
  title: string;
  description: string;
  target_job_title: string;
  pass_threshold: number;
  time_limit_seconds: number | null;
  allow_retake: boolean;
  status: ExamStatus;
}>;

export interface QuestionInput {
  prompt: string;
  options: string[];
  correct_index: number;
  points?: number;
}

// ── Exams ──────────────────────────────────────────────────────────────────
export function listExams(status?: ExamStatus): Promise<ExamSummary[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet<ExamSummary[]>(`/hr/exams${q}`);
}

export function getExam(id: string): Promise<ExamDetail> {
  return apiGet<ExamDetail>(`/hr/exams/${id}`);
}

export function createExam(input: ExamCreateInput): Promise<Exam> {
  return apiPost<Exam>('/hr/exams', input);
}

export function updateExam(id: string, patch: ExamUpdateInput): Promise<Exam> {
  return clientFetch<Exam>(`${API_BASE}/hr/exams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// ── Questions ────────────────────────────────────────────────────────────────
export function addQuestion(examId: string, q: QuestionInput): Promise<ExamQuestion> {
  return apiPost<ExamQuestion>(`/hr/exams/${examId}/questions`, q);
}

export function updateQuestion(
  examId: string,
  qid: string,
  q: Partial<QuestionInput>,
): Promise<ExamQuestion> {
  return clientFetch<ExamQuestion>(`${API_BASE}/hr/exams/${examId}/questions/${qid}`, {
    method: 'PATCH',
    body: JSON.stringify(q),
  });
}

export function deleteQuestion(examId: string, qid: string): Promise<void> {
  return apiDelete<void>(`/hr/exams/${examId}/questions/${qid}`);
}

// ── Bulk add / AI generate / Excel import ────────────────────────────────────
export type ExamDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type ExamLanguage = 'en' | 'hi' | 'te';

export interface GeneratedQuestion {
  prompt: string;
  options: string[];
  correct_index: number;
  points: number;
}

export interface GenerateParams {
  topic: string;
  num_questions: number;
  difficulty: ExamDifficulty;
  language: ExamLanguage;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  added: number;
  errors: ImportRowError[];
  questions: ExamQuestion[];
}

/** Ask Gemini (via backend) to draft questions — returned for preview, NOT saved. */
export function generateQuestions(
  examId: string,
  params: GenerateParams,
): Promise<{ questions: GeneratedQuestion[] }> {
  return apiPost<{ questions: GeneratedQuestion[] }>(
    `/hr/exams/${examId}/questions/generate`,
    params,
  );
}

/** Insert many already-built questions at once (AI 'add all', reviewed import). */
export function bulkAddQuestions(
  examId: string,
  questions: QuestionInput[],
): Promise<ExamQuestion[]> {
  return apiPost<ExamQuestion[]>(`/hr/exams/${examId}/questions/bulk`, { questions });
}

/** Upload an .xlsx/.csv in the template layout; backend parses + inserts valid rows. */
export function importQuestions(examId: string, file: File): Promise<ImportResult> {
  const fd = new FormData();
  fd.append('file', file);
  return uploadWithProgress<ImportResult>(
    `${API_BASE}/hr/exams/${examId}/questions/import`,
    fd,
  );
}

/** Fetch the .xlsx bulk-upload template (auth-scoped) and trigger a browser download. */
export async function downloadQuestionTemplate(): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/hr/exam-question-template`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not download template (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'exam-questions-template.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function reorderQuestions(examId: string, questionIds: string[]): Promise<ExamQuestion[]> {
  return apiPut<ExamQuestion[]>(`/hr/exams/${examId}/questions/order`, {
    question_ids: questionIds,
  });
}

// ── Assignments (magic links) ────────────────────────────────────────────────
export function listAssignments(examId: string): Promise<Assignment[]> {
  return apiGet<Assignment[]>(`/hr/exams/${examId}/assignments`);
}

export function assignExam(
  examId: string,
  applicantIds: string[],
  ttlHours?: number,
): Promise<AssignResult[]> {
  return apiPost<AssignResult[]>(`/hr/exams/${examId}/assignments`, {
    applicant_ids: applicantIds,
    ttl_hours: ttlHours,
  });
}

export function revokeAssignment(examId: string, aid: string): Promise<Assignment> {
  return apiPost<Assignment>(`/hr/exams/${examId}/assignments/${aid}/revoke`, {});
}

// ── Results ──────────────────────────────────────────────────────────────────
export function listAttempts(examId: string): Promise<AttemptResult[]> {
  return apiGet<AttemptResult[]>(`/hr/exams/${examId}/attempts`);
}
