// applicants.ts — HR resume screening API (HR workflow Phase 1).
// Calls data_gateway (VITE_API_BASE_URL) via the central client. Tenant-scoped
// server-side by the HR's company — the frontend just consumes its own list.

import { apiGet, apiPost, clientFetch, uploadWithProgress } from './client';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const API_BASE: string = import.meta.env.VITE_API_BASE_URL;

export type ApplicantStatus = 'new' | 'shortlisted' | 'rejected';

export interface Applicant {
  id: string;
  full_name: string;
  email: string | null;
  target_job_title: string;
  target_level: string;
  status: ApplicantStatus;
  /** ATS fit score 0-100, or null until scored. */
  ats_overall: number | null;
  ats_breakdown: Record<string, number> | null;
  ats_strengths: string[] | null;
  ats_concerns: string[] | null;
  ats_recommendation: string | null;
  ats_summary: string | null;
  created_at: string;
  /** Linked candidate user id (set after interview-invite redeem); null otherwise. */
  user_id?: string | null;
}

/** Ranked applicant list (highest ATS score first), optionally filtered by status. */
export function listApplicants(status?: ApplicantStatus): Promise<Applicant[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet<Applicant[]>(`/hr/applicants${q}`);
}

export function getApplicant(id: string): Promise<Applicant> {
  return apiGet<Applicant>(`/hr/applicants/${id}`);
}

/**
 * Upload + auto-score an applicant resume. `form` must contain: file (PDF),
 * full_name, target_job_title, and optionally email, target_level, target_jd_text.
 */
export function uploadApplicant(
  form: FormData,
  onProgress?: (pct: number) => void,
): Promise<Applicant> {
  return uploadWithProgress<Applicant>(`${API_BASE}/hr/applicants`, form, onProgress);
}

export interface BulkUploadResult {
  created: Applicant[];
  failed: { filename: string; error: string }[];
  created_count: number;
  failed_count: number;
}

/**
 * Bulk-upload many resumes for ONE role. The candidate name + email are
 * auto-extracted from each resume server-side (no manual entry). Append each
 * PDF under the `files` key, plus target_job_title and optionally
 * target_level / target_jd_text.
 */
export function bulkUploadApplicants(
  form: FormData,
  onProgress?: (pct: number) => void,
): Promise<BulkUploadResult> {
  return uploadWithProgress<BulkUploadResult>(
    `${API_BASE}/hr/applicants/bulk`,
    form,
    onProgress,
  );
}

export function updateApplicantStatus(
  id: string,
  status: ApplicantStatus,
): Promise<Applicant> {
  return clientFetch<Applicant>(`${API_BASE}/hr/applicants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function rescoreApplicant(id: string): Promise<Applicant> {
  return apiPost<Applicant>(`/hr/applicants/${id}/rescore`, {});
}
