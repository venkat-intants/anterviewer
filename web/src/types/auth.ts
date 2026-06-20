// Auth types — mirror backend Pydantic models in data_gateway
// Shape matches LLD §3.1 JWT spec

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  user_id: string;
  roles: string[];
}

export interface RegisterResponse {
  access_token: string;
  expires_in: number;
  user_id: string;
  roles: string[];
}

export interface MeResponse {
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  has_resume: boolean;
  /** HR workflow — true when the account still has its bootstrap password. */
  must_change_password?: boolean;
}

export interface LogoutResponse {
  ok: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  full_name: string;
  email: string;
  password: string;
}

export interface AuthUser {
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  /** HR workflow — drives the force-password-change redirect on first login. */
  must_change_password?: boolean;
}

export interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
}
