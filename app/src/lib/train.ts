import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { CreateExercise, SetInput, TemplateInput } from '@bodyatlas/shared';
import { api } from './api';

// ---------- helpers ----------

// The Hono RPC client returns Promise<ClientResponse<ErrorUnion | SuccessType>>.
// TypeScript cannot unify the union json() overloads, so we accept `Promise<any>`
// and let callers rely on the inferred return type from the RPC call site.
// ADAPTATION: expectOk accepts Promise<any> because ClientResponse union types
// (e.g. 200 success | 422 error | 404 not-found) do not match a typed constraint;
// the RPC type error was: "Type 'Promise<ClientResponse<ErrorShape | SuccessShape>>'
// is not assignable to parameter of type 'Promise<{ok; status; json(): Promise<T>}>'"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expectOk<T>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------- exercises ----------

export function useExercises(q: string, includeArchived = false) {
  return useQuery({
    queryKey: ['exercises', q, includeArchived],
    queryFn: async () => {
      // ADAPTATION: exercises GET has no zValidator for query, so RPC type has
      // no typed query shape. We call fetch directly to pass arbitrary query params.
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (includeArchived) params.set('includeArchived', 'true');
      const qs = params.toString();
      const res = await fetch(`/api/exercises${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<
        {
          id: string;
          userId: string | null;
          nameEn: string;
          nameJa: string | null;
          type: 'strength' | 'bodyweight' | 'cardio';
          muscleGroup: string;
          equipment: string;
          isArchived: boolean;
        }[]
      >;
    },
    staleTime: 60_000,
  });
}

export type Exercise = NonNullable<ReturnType<typeof useExercises>['data']>[number];

export function useCreateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExercise) =>
      expectOk(api.exercises.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });
}

export function useArchiveExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.exercises[':id'].$patch({ param: { id }, json: { isArchived: true } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });
}

export function useLastSets(exerciseId: string, excludeWorkoutId?: string) {
  return useQuery({
    queryKey: ['last-sets', exerciseId, excludeWorkoutId ?? null],
    queryFn: async () => {
      // ADAPTATION: last-sets GET has no zValidator for query, so the RPC type
      // for this nested route does not expose a query parameter shape.
      // We call fetch directly to pass excludeWorkoutId as a query param.
      const params = new URLSearchParams();
      if (excludeWorkoutId) params.set('excludeWorkoutId', excludeWorkoutId);
      const qs = params.toString();
      const res = await fetch(
        `/api/exercises/${exerciseId}/last-sets${qs ? `?${qs}` : ''}`,
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<
        | {
            workoutId: string;
            startedAt: string;
            sets: {
              id: string;
              workoutExerciseId: string;
              position: number;
              weightKg: number | null;
              reps: number | null;
              rpe: number | null;
              durationSec: number | null;
              distanceM: number | null;
            }[];
          }
        | null
      >;
    },
    staleTime: 5 * 60_000,
  });
}

// ---------- templates ----------

// ADAPTATION: InferResponseType used to extract the 200-OK shape from the
// typed RPC union so Template / ActiveWorkout type aliases resolve correctly.
// Without it, expectOk<T>(Promise<any>) leaves T=unknown and the alias becomes {}.
type TemplateList = InferResponseType<typeof api.templates.$get, 200>;
type TemplateRow = TemplateList[number];

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async (): Promise<TemplateList> => {
      const res = await api.templates.$get();
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<TemplateList>;
    },
  });
}

export type Template = TemplateRow;

export function useSaveTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) =>
      id
        ? expectOk(api.templates[':id'].$put({ param: { id }, json: input }))
        : expectOk(api.templates.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.templates[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ---------- workouts ----------

type ActiveResponse = InferResponseType<typeof api.workouts.active.$get, 200>;

export function useActiveWorkout() {
  return useQuery({
    queryKey: ['workouts', 'active'],
    queryFn: async (): Promise<ActiveResponse> => {
      const res = await api.workouts.active.$get();
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<ActiveResponse>;
    },
  });
}

export type ActiveWorkout = NonNullable<ActiveResponse['workout']>;

export function useWorkouts(filters: { limit?: number; exerciseId?: string } = {}) {
  return useQuery({
    queryKey: ['workouts', 'list', filters],
    queryFn: async () => {
      // ADAPTATION: workouts GET has no zValidator for query, so RPC type has
      // no typed query shape. We call fetch directly.
      const params = new URLSearchParams();
      if (filters.limit !== undefined) params.set('limit', String(filters.limit));
      if (filters.exerciseId) params.set('exerciseId', filters.exerciseId);
      const qs = params.toString();
      const res = await fetch(`/api/workouts${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<
        {
          id: string;
          startedAt: string;
          endedAt: string | null;
          notes: string | null;
          templateId: string | null;
          exerciseNames: string[];
          exerciseNamesJa: string[];
          setCount: number;
        }[]
      >;
    },
  });
}

export function useWorkout(id: string) {
  return useQuery({
    queryKey: ['workouts', 'detail', id],
    queryFn: () => {
      return api.workouts[':id'].$get({ param: { id } }).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`API error ${res.status}`);
        return res.json();
      });
    },
  });
}

/** Resolves to the workout id to navigate to — created OR already-active (409). */
export function useStartWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId?: string; copyFromWorkoutId?: string }) => {
      const res = await api.workouts.$post({ json: input });
      if (res.status === 409) {
        const body = (await res.json()) as {
          error: { details: { workoutId: string } };
        };
        return { workoutId: body.error.details.workoutId, resumed: true };
      }
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const created = (await res.json()) as { id: string };
      return { workoutId: created.id, resumed: false };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useUpdateWorkout(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { notes?: string | null; finish?: boolean }) =>
      expectOk(api.workouts[':id'].$patch({ param: { id }, json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useDeleteWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.workouts[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useAddWorkoutExercise(workoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exerciseId: string) =>
      expectOk(
        api.workouts[':id'].exercises.$post({
          param: { id: workoutId },
          json: { exerciseId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useRemoveWorkoutExercise(workoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weId: string) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].$delete({
          param: { id: workoutId, weId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useLogSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetInput) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets.$post({
          param: { id: workoutId, weId },
          json: input,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useUpdateSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ setId, input }: { setId: string; input: SetInput }) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets[':setId'].$patch({
          param: { id: workoutId, weId, setId },
          json: input,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useDeleteSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setId: string) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets[':setId'].$delete({
          param: { id: workoutId, weId, setId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}
