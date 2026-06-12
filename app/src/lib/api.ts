import { hc } from 'hono/client';
import type { AppType } from '@bodyatlas/worker';

export const api = hc<AppType>('/api');

// The Hono RPC client returns Promise<ClientResponse<Success | ErrorUnion>>;
// json() on the union is not expressible as a single generic constraint, so we
// accept Promise<any> here and pin the result type at each call site with
// InferResponseType<..., 200> — the worker types stay the single source of truth.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function expectOk<T>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}
