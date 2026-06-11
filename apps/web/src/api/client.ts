/** Typed API client. Same-origin in production; Vite proxies /api in dev. */

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  const body = (await res.json()) as { data?: T; error?: ApiError };
  if (!res.ok || body.error) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: 'INTERNAL', message: 'unknown error', details: null },
    );
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: 'POST', body: payload === undefined ? null : JSON.stringify(payload) }),
  patch: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface HealthData {
  status: string;
  version: string;
  uptimeSeconds: number;
  db: string;
}

export const fetchHealth = () => api.get<HealthData>('/health');
