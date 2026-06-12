import { useQuery } from '@tanstack/react-query';
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
