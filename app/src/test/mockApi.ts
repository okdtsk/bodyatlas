import { vi } from 'vitest';

type RouteMap = Record<string, unknown | ((init?: RequestInit) => unknown)>;

/**
 * Stubs global fetch. Keys are `"METHOD /path"` (query strings ignored on match).
 * Values are response bodies (200) or functions receiving the RequestInit.
 * Returns the spy so tests can assert calls.
 */
export function mockApi(routes: RouteMap) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) {
      throw new Error(`mockApi: unmocked ${key}`);
    }
    const value = routes[key];
    const body = typeof value === 'function' ? (value as (i?: RequestInit) => unknown)(init) : value;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export const emptyActive = { workout: null };
