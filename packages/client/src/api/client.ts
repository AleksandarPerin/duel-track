export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

// In-memory only — never persisted to storage (hard security constraint: a
// double-submit CSRF token has no protective value once it lives somewhere
// an XSS payload could also read it back from).
let csrfToken: string | null = null;
let primingPromise: Promise<void> | null = null;

async function doPrime(): Promise<void> {
  try {
    const res = await fetch('/api/auth/csrf', { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken;
  } finally {
    // Cleared even on failure (e.g. booted offline) so a later
    // ensureCsrfToken() call retries instead of being stuck awaiting a
    // promise that already resolved without a token.
    primingPromise = null;
  }
}

export function primeCsrfToken(): Promise<void> {
  if (!primingPromise) primingPromise = doPrime();
  return primingPromise;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

// Awaits a real token rather than reading whatever's in memory right now —
// for callers (the offline sync queue) that can run before the boot-time
// primeCsrfToken() call has resolved, or after it failed because the app
// booted offline.
export async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  await primeCsrfToken();
  return csrfToken;
}

export async function apiRequest<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  // Fastify's JSON body parser 400s on an empty body sent with this header
  // (FST_ERR_CTP_EMPTY_JSON_BODY) — only set it when there's actually a body,
  // e.g. a bodyless POST like /auth/logout.
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    // Fine for direct, user-initiated requests (page loads, login-gated
    // fetches) — the offline sync queue deliberately bypasses this by using
    // raw fetch() instead of apiRequest(), since redirecting mid-flush would
    // yank the user off the round page they're actively using offline.
    // Carries the current path as ?redirect= so LoginPage can send the judge
    // back to the round page they were on instead of stranding them on the
    // generic dashboard post-login.
    const redirect = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?redirect=${redirect}`);
    throw new ApiError(401, 'UNAUTHORIZED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'UNKNOWN_ERROR', body.details);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
