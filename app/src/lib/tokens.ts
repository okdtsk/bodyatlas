import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import { api, expectOk } from './api';

// Derived response types from the worker AppType
export type TokenListItem = InferResponseType<typeof api.tokens.$get, 200>[number];
export type CreatedToken = InferResponseType<typeof api.tokens.$post, 201>;

export function useTokens() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: () => expectOk<TokenListItem[]>(api.tokens.$get()),
    staleTime: 60_000,
  });
}

export function useCreateToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      expectOk<CreatedToken>(api.tokens.$post({ json: { name } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useRevokeToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk<{ ok: boolean }>(api.tokens[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}
