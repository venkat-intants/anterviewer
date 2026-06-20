// hr.ts — super-admin company + HR-manager management (HR workflow Phase 0).
// Calls data_gateway (VITE_API_BASE_URL) via the central client (token + refresh).

import { apiGet, apiPost } from './client';

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
