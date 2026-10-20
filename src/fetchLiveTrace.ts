/**
 * Fetch replacement for http/https modules — works in VS Code Web (browser).
 * WHY: The web extension host provides global `fetch` and `AbortSignal.timeout`.
 * WHAT: Minimal wrapper matching the old getJson() signature.
 * WHERE: Called from src/web/extension.ts fetchLiveTrace() → active.applyTrace().
 */
export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status}.`);
  }
  return response.json();
}