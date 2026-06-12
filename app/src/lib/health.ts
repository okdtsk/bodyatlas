import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { MealInput, MeasurementInput, SleepInput } from '@bodyatlas/shared';
import { api, expectOk } from './api';

// ---------- meals ----------

type MealList = InferResponseType<typeof api.meals.$get, 200>;
type MealSearchList = InferResponseType<(typeof api.meals)['search']['$get'], 200>;

export type Meal = MealList[number];
export type MealSearchResult = MealSearchList[number];

export function useMeals(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ['meals', fromIso, toIso],
    queryFn: () =>
      expectOk<MealList>(
        api.meals.$get({ query: { from: fromIso, to: toIso } }),
      ),
  });
}

export function useMealSearch(q: string) {
  return useQuery({
    queryKey: ['meal-search', q],
    queryFn: () =>
      expectOk<MealSearchList>(
        api.meals.search.$get({ query: { q } }),
      ),
    staleTime: 60_000,
  });
}

type CreatedMeal = InferResponseType<typeof api.meals.$post, 201>;

export function useCreateMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MealInput) =>
      expectOk<CreatedMeal>(api.meals.$post({ json: input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meals'] });
      void qc.invalidateQueries({ queryKey: ['meal-search'] });
    },
  });
}

export function useUpdateMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MealInput }) =>
      expectOk(api.meals[':id'].$put({ param: { id }, json: input })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meals'] });
      void qc.invalidateQueries({ queryKey: ['meal-search'] });
    },
  });
}

// ADAPTATION: The Hono RPC client for nested param routes like meals[':id'].favorite.$patch
// rejects a combined { param, json } shape at the type level (the generated input type
// only accepts `param`). Use raw fetch so the request compiles; response type is still
// derived via InferResponseType to keep the worker as the single source of truth.
type ToggleFavoriteResponse = InferResponseType<
  (typeof api.meals)[':id']['favorite']['$patch'],
  200
>;

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const res = await fetch(`/api/meals/${id}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<ToggleFavoriteResponse>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meals'] });
      void qc.invalidateQueries({ queryKey: ['meal-search'] });
    },
  });
}

export function useDeleteMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.meals[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meals'] });
      void qc.invalidateQueries({ queryKey: ['meal-search'] });
    },
  });
}

// ---------- sleep ----------

type SleepList = InferResponseType<typeof api.sleep.$get, 200>;

export type SleepRecord = SleepList[number];

export function useSleep(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ['sleep', fromIso, toIso],
    queryFn: () =>
      expectOk<SleepList>(
        api.sleep.$get({ query: { from: fromIso, to: toIso } }),
      ),
  });
}

type CreatedSleep = InferResponseType<typeof api.sleep.$post, 201>;

export function useCreateSleep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SleepInput) =>
      expectOk<CreatedSleep>(api.sleep.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sleep'] }),
  });
}

export function useUpdateSleep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SleepInput }) =>
      expectOk(api.sleep[':id'].$put({ param: { id }, json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sleep'] }),
  });
}

export function useDeleteSleep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.sleep[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sleep'] }),
  });
}

// ---------- measurements ----------

type MeasurementList = InferResponseType<typeof api.measurements.$get, 200>;

export type Measurement = MeasurementList[number];

export function useMeasurements(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ['measurements', fromIso, toIso],
    queryFn: () =>
      expectOk<MeasurementList>(
        api.measurements.$get({ query: { from: fromIso, to: toIso } }),
      ),
  });
}

type CreatedMeasurement = InferResponseType<typeof api.measurements.$post, 201>;

export function useCreateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MeasurementInput) =>
      expectOk<CreatedMeasurement>(api.measurements.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['measurements'] }),
  });
}

export function useUpdateMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MeasurementInput }) =>
      expectOk(api.measurements[':id'].$put({ param: { id }, json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['measurements'] }),
  });
}

export function useDeleteMeasurement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.measurements[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['measurements'] }),
  });
}
