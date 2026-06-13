import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { CreateExercise, SetInput, TemplateInput } from '@bodyatlas/shared';
import { api, expectOk } from './api';
import { offlineQueue } from './offline';
import { isOfflineError } from './offline/connectivity';
import type { SetContext } from './offline/types';

async function withOfflineFallbackSet<T>(
  online: () => Promise<T>,
  payload: Record<string, unknown>,
  context: SetContext,
): Promise<T | { queued: true; id: string }> {
  try {
    return await online();
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    const op = await offlineQueue.enqueue('set', payload, context);
    return { queued: true, id: op.id };
  }
}

// ---------- exercises ----------

type ExerciseList = InferResponseType<typeof api.exercises.$get, 200>;

export function useExercises(q: string, includeArchived = false) {
  return useQuery({
    queryKey: ['exercises', q, includeArchived],
    queryFn: () =>
      expectOk<ExerciseList>(
        api.exercises.$get({
          query: { q: q || undefined, includeArchived: includeArchived ? 'true' : undefined },
        }),
      ),
    staleTime: 60_000,
  });
}

export type Exercise = ExerciseList[number];

type CreatedExercise = InferResponseType<typeof api.exercises.$post, 201>;

export function useCreateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExercise) =>
      expectOk<CreatedExercise>(api.exercises.$post({ json: input })),
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

type LastSetsResponse = InferResponseType<
  (typeof api.exercises)[':id']['last-sets']['$get'],
  200
>;

export function useLastSets(exerciseId: string, excludeWorkoutId?: string) {
  return useQuery({
    queryKey: ['last-sets', exerciseId, excludeWorkoutId ?? null],
    queryFn: async () => {
      // ADAPTATION (verified): the generated RPC input type for this nested
      // route is `{ param: { id } }` only — it rejects a `query` key — so we
      // use raw fetch for the request. The response type is still derived from
      // the worker via InferResponseType so the contract stays in one place.
      const params = new URLSearchParams();
      if (excludeWorkoutId) params.set('excludeWorkoutId', excludeWorkoutId);
      const qs = params.toString();
      const res = await fetch(
        `/api/exercises/${exerciseId}/last-sets${qs ? `?${qs}` : ''}`,
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<LastSetsResponse>;
    },
    staleTime: 5 * 60_000,
  });
}

// ---------- templates ----------

type TemplateList = InferResponseType<typeof api.templates.$get, 200>;

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => expectOk<TemplateList>(api.templates.$get()),
  });
}

export type Template = TemplateList[number];

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
    queryFn: () => expectOk<ActiveResponse>(api.workouts.active.$get()),
  });
}

export type ActiveWorkout = NonNullable<ActiveResponse['workout']>;

type WorkoutList = InferResponseType<typeof api.workouts.$get, 200>;

export function useWorkouts(filters: { limit?: number; exerciseId?: string } = {}) {
  return useQuery({
    queryKey: ['workouts', 'list', filters],
    queryFn: () =>
      expectOk<WorkoutList>(
        api.workouts.$get({
          query: {
            limit: filters.limit !== undefined ? String(filters.limit) : undefined,
            exerciseId: filters.exerciseId,
          },
        }),
      ),
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
    mutationFn: (input: { notes?: string | null; finish?: boolean; startedAt?: string; endedAt?: string }) =>
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
      withOfflineFallbackSet(
        () =>
          expectOk(
            api.workouts[':id'].exercises[':weId'].sets.$post({
              param: { id: workoutId, weId },
              json: input,
            }),
          ),
        input as Record<string, unknown>,
        { workoutId, weId },
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
