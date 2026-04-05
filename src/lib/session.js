const STORAGE_KEY = "smashalope_session_id";

/**
 * Stable per-browser id for anonymous vote tracking. Persisted in localStorage.
 */
export function getSessionId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // private mode or no storage: still return a UUID for this page lifetime (won't persist)
    return crypto.randomUUID();
  }
}
