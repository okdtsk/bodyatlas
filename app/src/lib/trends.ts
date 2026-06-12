import { useQuery } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { api, expectOk } from './api';

// ---------- strength ----------

// ADAPTATION (verified): the generated RPC input type for trends/strength/:exerciseId
// rejects a combined { param, query } shape — the param route only accepts `param`, not
// `query`. Use raw fetch so the request compiles; the response type is still derived
// from the worker via InferResponseType to keep the contract in one place.
type StrengthTrendResponse = InferResponseType<
  (typeof api.trends.strength)[':exerciseId']['$get'],
  200
>;

export function useStrengthTrend(exerciseId: string, fromIso: string) {
  return useQuery({
    queryKey: ['trends', 'strength', exerciseId, fromIso],
    enabled: exerciseId.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/trends/strength/${encodeURIComponent(exerciseId)}?from=${encodeURIComponent(fromIso)}`,
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<StrengthTrendResponse>;
    },
    staleTime: 5 * 60_000,
  });
}

// ---------- volume ----------

type VolumeTrendResponse = InferResponseType<typeof api.trends.volume.$get, 200>;

export function useVolumeTrend(fromIso: string) {
  return useQuery({
    queryKey: ['trends', 'volume', fromIso],
    queryFn: () =>
      expectOk<VolumeTrendResponse>(
        api.trends.volume.$get({ query: { from: fromIso } }),
      ),
    staleTime: 5 * 60_000,
  });
}

// ---------- nutrition-body ----------

const nutritionBodyEndpoint = api.trends['nutrition-body'];
type NutritionBodyTrendResponse = InferResponseType<typeof nutritionBodyEndpoint.$get, 200>;

export function useNutritionBodyTrend(fromIso: string) {
  return useQuery({
    queryKey: ['trends', 'nutrition-body', fromIso],
    queryFn: () =>
      expectOk<NutritionBodyTrendResponse>(
        nutritionBodyEndpoint.$get({ query: { from: fromIso } }),
      ),
    staleTime: 5 * 60_000,
  });
}
