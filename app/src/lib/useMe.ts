import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateMe } from '@bodyatlas/shared';
import { api } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.me.$get();
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`GET /api/me failed: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export type Me = NonNullable<ReturnType<typeof useMe>['data']>;

/** Persists a partial preference/target patch to /api/me and updates the cached user. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdateMe) => {
      const res = await api.me.$patch({ json: patch });
      if (!res.ok) throw new Error(`PATCH /api/me failed: ${res.status}`);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
    },
  });
}
