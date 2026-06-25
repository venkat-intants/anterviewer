// hr.ts — super-admin company + HR-manager management (HR workflow Phase 0).
// Calls data_gateway (VITE_API_BASE_URL) via the central client (token + refresh).

import { apiGet, apiPost, apiPut } from './client';

export interface Company {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  hr_count: number;
  created_at: string;
}

export interface HrManager {
  user_id: string;
  email: string;
  full_name: string;
  company_id: string;
  must_change_password: boolean;
  created_at: string;
}

export function listCompanies(): Promise<Company[]> {
  return apiGet<Company[]>('/admin/companies');
}

export function createCompany(name: string, slug?: string): Promise<Company> {
  return apiPost<Company>('/admin/companies', slug ? { name, slug } : { name });
}

export function listHrManagers(companyId: string): Promise<HrManager[]> {
  return apiGet<HrManager[]>(`/admin/companies/${companyId}/hr-managers`);
}

export function createHrManager(
  companyId: string,
  body: { email: string; full_name: string; password?: string },
): Promise<HrManager> {
  return apiPost<HrManager>(`/admin/companies/${companyId}/hr-managers`, body);
}

// ── DPDP audit log (super-admin) ────────────────────────────────────────────

export interface AuditEvent {
  ts: string;
  kind: string; // admin_action | consent_granted | consent_denied | consent_revoked
  summary: string;
  actor: string;
}

export function listAuditLog(limit = 100): Promise<AuditEvent[]> {
  return apiGet<AuditEvent[]>(`/admin/audit-log?limit=${limit}`);
}

// ── Platform feature flags (super-admin) ────────────────────────────────────

export interface FeatureFlag {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updated_at: string | null;
}

export function listFeatureFlags(): Promise<FeatureFlag[]> {
  return apiGet<FeatureFlag[]>('/admin/feature-flags');
}

export function setFeatureFlag(key: string, enabled: boolean): Promise<FeatureFlag> {
  return apiPut<FeatureFlag>(`/admin/feature-flags/${key}`, { enabled });
}

// ── HR hiring analytics (funnel + averages) — powers the HR console stats ─────

export interface HrFunnel {
  total_applicants: number;
  shortlisted: number;
  exam_taken: number;
  exam_passed: number;
  interview_invited: number;
  interview_completed: number;
  hired: number;
  rejected: number;
}

export interface HrAverages {
  avg_ats: number | null;
  avg_exam_percent: number | null;
  avg_interview_composite: number | null;
}

export interface HrAnalytics {
  funnel: HrFunnel;
  averages: HrAverages;
}

export function getHrAnalytics(): Promise<HrAnalytics> {
  return apiGet<HrAnalytics>('/hr/analytics');
}
