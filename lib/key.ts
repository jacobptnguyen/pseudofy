// The user's own Claude API key lives only in this browser's localStorage and is sent
// to /api/grade per request. It's never stored on the server.
const STORAGE_KEY = "pseudofy:claude-key";

export function getKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setKey(key: string) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the key just won't persist
  }
}
