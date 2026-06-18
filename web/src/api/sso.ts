// Google SSO API — S5-003b / B-035
//
// `initiate` is a full-page browser redirect (the backend 302s to Google's
// consent screen), so we expose the URL and let the page navigate to it rather
// than fetching it. The `callback` endpoint returns JSON we fetch from the
// frontend landing route after Google redirects back with ?code&state.
//
// Note: completeGoogleLogin does NOT use the central apiClient because it is
// an unauthenticated exchange (no Bearer token needed, no refresh loop). The
// caller (GoogleCallback.tsx) sets the token in the store via setAuth.

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const API_BASE: string = import.meta.env.VITE_API_BASE_URL;

export interface SsoTokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
}

/**
 * URL that starts the Google OAuth flow. Navigate the whole page to it
 * (window.location) — the backend replies 302 → accounts.google.com.
 */
export function googleLoginUrl(returnUrl = '/dashboard'): string {
  const params = new URLSearchParams({ return_url: returnUrl });
  return `${API_BASE}/auth/sso/google/initiate?${params.toString()}`;
}

/**
 * Exchange the `code` + `state` Google appended to the callback URL for an
 * Intants JWT. Throws Error(detail) on any non-2xx response.
 */
export async function completeGoogleLogin(code: string, state: string): Promise<SsoTokenResponse> {
  const params = new URLSearchParams({ code, state });
  const response = await fetch(`${API_BASE}/auth/sso/google/callback?${params.toString()}`);

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(body.detail ?? `Google sign-in failed (HTTP ${response.status})`);
  }

  return response.json() as Promise<SsoTokenResponse>;
}
