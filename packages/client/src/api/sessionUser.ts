// Who is signed in on this device, as far as the client knows: set on sign
// in, cleared on sign out. The offline queue stamps it on every queued
// result and only ever sends a result under the session of the judge who
// entered it — venue phones are shared, and a result parked by judge A must
// not go out (and be audit-logged) as judge B's once B signs in.
//
// localStorage, not memory: it has to survive the reloads a sign-in
// redirect causes. It's only a user id and display name (no credential) —
// the session itself stays in httpOnly cookies. Kept in memory too, so a
// browser that blocks storage still gets the protection for the life of the
// tab.
const KEY = 'dueltrack:sessionUserId';
const NAME_KEY = 'dueltrack:sessionUserName';
let memory: { id: string | null; name: string | null } = { id: null, name: null };
// Whether the last write reached storage. Storage can refuse writes yet
// still answer reads (quota, some private modes) — reading it then would
// say "nobody signed in" while memory knows better.
let storageWritable = true;

function read(key: string, fallback: string | null): string | null {
  if (!storageWritable) return fallback;
  try {
    // Storage wins when it's in use: another tab may have signed out
    // (cleared it) since this tab's copy in memory was set.
    return localStorage.getItem(key);
  } catch {
    return fallback;
  }
}

export function getSessionUserId(): string | null {
  return read(KEY, memory.id);
}

// For telling people whose results are still on the device (the sign-out
// notice) — AuthContext's user doesn't survive a reload.
export function getSessionUserName(): string | null {
  return read(NAME_KEY, memory.name);
}

export function setSessionUserId(id: string | null, displayName?: string): void {
  memory = { id, name: id ? (displayName ?? null) : null };
  try {
    if (id) {
      localStorage.setItem(KEY, id);
      if (displayName) localStorage.setItem(NAME_KEY, displayName);
      else localStorage.removeItem(NAME_KEY);
    } else {
      localStorage.removeItem(KEY);
      localStorage.removeItem(NAME_KEY);
    }
    storageWritable = true;
  } catch {
    // Storage blocked (private mode, site data disabled) — memory only.
    storageWritable = false;
  }
}
