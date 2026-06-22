// publicExam.ts — applicant exam-taking API (HR workflow Phase 2).
//
// PUBLIC: the applicant has no account. Auth is the opaque magic-link token,
// passed in the X-Exam-Token HEADER (the token lives in the URL #fragment, which
// browsers never send to the server). We use clientFetch with skipAuth:true so it
// never injects the user session token nor bounces a 401 to /login — a bad/expired
// link surfaces as an in-page error instead.
//
// These types deliberately OMIT correct_index / pass_threshold — the server never
// sends them on this path.

import { clientFetch } from './client';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const API_BASE: string = import.meta.env.VITE_API_BASE_URL;

export interface PublicQuestion {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  points: number;
}

export interface TakeExam {
  exam_id: string;
  title: string;
  description: string | null;
  time_limit_seconds: number | null;
  total_questions: number;
  allow_retake: boolean;
  already_submitted: boolean;
  server_now: string;
  deadline: string | null;
  questions: PublicQuestion[];
}

export interface AttemptStart {
  attempt_id: string;
  started_at: string;
  deadline: string | null;
}

export interface ExamResult {
  attempt_id: string;
  score_raw: number;
  score_max: number;
  score_percent: number;
  passed: boolean;
  status: string;
  submitted_at: string;
}

function tokenHeaders(token: string): Record<string, string> {
  return { 'X-Exam-Token': token };
}

export function getPublicExam(token: string): Promise<TakeExam> {
  return clientFetch<TakeExam>(`${API_BASE}/exam`, {
    skipAuth: true,
    headers: tokenHeaders(token),
  });
}

export function startExam(token: string): Promise<AttemptStart> {
  return clientFetch<AttemptStart>(`${API_BASE}/exam/start`, {
    method: 'POST',
    skipAuth: true,
    headers: tokenHeaders(token),
  });
}

export function submitExam(
  token: string,
  attemptId: string,
  answers: Record<string, number>,
): Promise<ExamResult> {
  return clientFetch<ExamResult>(`${API_BASE}/exam/submit`, {
    method: 'POST',
    skipAuth: true,
    headers: tokenHeaders(token),
    body: JSON.stringify({ attempt_id: attemptId, answers }),
  });
}
