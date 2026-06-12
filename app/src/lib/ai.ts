import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferResponseType } from 'hono/client';
import type { AiProvider } from '@bodyatlas/shared';
import { api, expectOk } from './api';

// Derived response types from the worker AppType
export type AiSettings = InferResponseType<typeof api.ai.settings.$get, 200>;
export type AiSettingsSaved = InferResponseType<typeof api.ai.settings.$put, 200>;
export type AiTestResult = InferResponseType<typeof api.ai.test.$post, 200>;
export type AiReview = InferResponseType<typeof api.ai.review.$get, 200>;

// Inline types for routes with hyphens (bracket notation not valid in TS generics)
export type EstimateResult = {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  confidence: 'low' | 'medium' | 'high';
  note?: string;
};

export type CoachReviewResult = {
  review: string;
  generatedAt: string;
};

export function useAiSettings() {
  return useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => expectOk<AiSettings>(api.ai.settings.$get()),
    staleTime: 60_000,
  });
}

export function useSaveAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: AiProvider; model: string; apiKey?: string }) =>
      expectOk<AiSettingsSaved>(api.ai.settings.$put({ json: input })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}

export function useDeleteAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => expectOk<{ ok: boolean }>(api.ai.settings.$delete()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
}

export function useTestAi() {
  return useMutation({
    mutationFn: () => expectOk<AiTestResult>(api.ai.test.$post()),
  });
}

export function useEstimateMeal() {
  return useMutation({
    mutationFn: async (description: string): Promise<EstimateResult> => {
      const res = await fetch('/api/ai/estimate-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<EstimateResult>;
    },
  });
}

export function useAiReview() {
  return useQuery({
    queryKey: ['ai-review'],
    queryFn: () => expectOk<AiReview>(api.ai.review.$get()),
    staleTime: 60_000,
  });
}

export function useCoachReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CoachReviewResult> => {
      const res = await fetch('/api/ai/coach-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      return res.json() as Promise<CoachReviewResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      queryClient.invalidateQueries({ queryKey: ['ai-review'] });
    },
  });
}
