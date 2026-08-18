import { hc } from 'hono/client';
import type { AppType } from '@bodyatlas/worker';

export const api = hc<AppType>('/api');

/**
 * A failed API call, carrying the worker's structured error body when there is
 * one. It extends Error, so call sites that only care that something failed
 * keep working unchanged; components that want to say something specific read
 * `code` and the fields beside it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly existingName?: string;

  constructor(status: number, body?: { code?: string; message?: string; existingName?: string }) {
    super(body?.message ?? `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code;
    this.existingName = body?.existingName;
  }
}

/** Narrow an unknown parsed body to the worker's `{ error: {...} }` envelope. */
function errorBody(body: unknown): { code?: string; message?: string; existingName?: string } | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body as { error: unknown };
  if (typeof error !== 'object' || error === null) return undefined;
  return error as { code?: string; message?: string; existingName?: string };
}

// The Hono RPC client returns Promise<ClientResponse<Success | ErrorUnion>>;
// json() on the union is not expressible as a single generic constraint, so we
// accept Promise<any> here and pin the result type at each call site with
// InferResponseType<..., 200> — the worker types stay the single source of truth.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function expectOk<T>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  if (!res.ok) {
    // A non-JSON error body must not mask the status the caller needs.
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, errorBody(body));
  }
  return res.json() as Promise<T>;
}
