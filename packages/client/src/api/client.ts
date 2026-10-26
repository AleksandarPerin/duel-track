export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

// Without a timeout a request on a stalled connection never settles, leaving
// buttons stuck on "Closing…"/"Publishing…" and the offline queue's serial
// flush blocked behind it. Aborting surfaces as a thrown (non-ApiError)
// error, which every caller already treats as a network failure: forms show
// a retry message, result entry and the sync queue queue/retry it.
export const REQUEST_TIMEOUT_MS = 20_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (typeof AbortSignal.timeout === 'function') {
    return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
  }
  // Older browsers (e.g. iOS 15 Safari, common on cheap venue phones) lack
  // AbortSignal.timeout — without this they'd silently get no timeout.
  // The timer is left running after the headers arrive, like
  // AbortSignal.timeout: the signal also covers reading the body, and a
  // body that stalls would otherwise hang its caller (e.g. the sync queue's
  // flush) forever. Aborting an already-read response is a no-op.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// Sends the user to sign in, carrying ?redirect= back to the current page
// (there's no in-app nav back to a round otherwise). A no-op when already on
// /login: a background 401 (the sync queue, a poll) reloading the login page
// would wipe what's typed and replace its ?redirect with /login itself.
export function redirectToLogin(): void {
  if (window.location.pathname === '/login') return;
  redirectingToLogin = true;
  window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
}

// location.assign doesn't stop the JS that called it — code still running
// after an await (e.g. sign-out, waiting on a flush that hit a 401) checks
// this to stop instead of acting on a page that is already navigating away.
let redirectingToLogin = false;
export function isRedirectingToLogin(): boolean {
  return redirectingToLogin;
}

// In-memory only — never persisted to storage (hard security constraint: a
// double-submit CSRF token has no protective value once it lives somewhere
// an XSS payload could also read it back from).
let csrfToken: string | null = null;
let primingPromise: Promise<void> | null = null;

async function doPrime(): Promise<void> {
  try {
    const res = await fetchWithTimeout('/api/auth/csrf', { credentials: 'include' }, 10_000);
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

// Drops a token the server has rejected, so the next ensureCsrfToken()
// fetches a fresh one instead of resending the stale one forever.
export function resetCsrfToken(): void {
  csrfToken = null;
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
  opts: {
    method?: string;
    body?: unknown;
    skipAuthRedirect?: boolean;
    cache?: RequestCache;
    // internal: set on the single automatic retry after a stale CSRF token
    csrfRetried?: boolean;
  } = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  // Fastify's JSON body parser 400s on an empty body sent with this header
  // (FST_ERR_CTP_EMPTY_JSON_BODY) — only set it when there's actually a body,
  // e.g. a bodyless POST like /auth/logout.
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // ensureCsrfToken(), not the in-memory token as-is: if the boot-time prime
  // failed (app opened on bad venue wifi), every mutation would otherwise
  // 403 on a missing token until a full reload, however often it's retried.
  if (method !== 'GET') {
    const token = await ensureCsrfToken();
    if (token) headers['x-csrf-token'] = token;
  }

  const res = await fetchWithTimeout(`/api${path}`, {
    method,
    credentials: 'include',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: opts.cache,
  });

  if (res.status === 401 && !opts.skipAuthRedirect) {
    // Fine for direct, user-initiated requests (page loads, login-gated
    // fetches) — the offline sync queue deliberately bypasses this by using
    // raw fetch() instead of apiRequest(), since redirecting mid-flush would
    // yank the user off the round page they're actively using offline.
    // Carries the current path as ?redirect= so LoginPage can send the judge
    // back to the round page they were on instead of stranding them on the
    // generic dashboard post-login.
    // login() passes skipAuthRedirect — a 401 there means "wrong credentials,"
    // not "your session expired," and this path was blowing away the login
    // form (and its error message) with a full-page reload back to itself
    // before the user could ever read why it failed.
    redirectToLogin();
    throw new ApiError(401, 'UNAUTHORIZED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // The in-memory token can go stale (e.g. its cookie secret was rotated
    // or cleared); re-prime and retry once rather than failing every
    // mutation until a full reload.
    if (res.status === 403 && String(body.error ?? '').startsWith('FST_CSRF') && !opts.csrfRetried) {
      resetCsrfToken();
      return apiRequest<T>(path, { ...opts, csrfRetried: true });
    }
    throw new ApiError(res.status, body.error ?? 'UNKNOWN_ERROR', body.details);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
