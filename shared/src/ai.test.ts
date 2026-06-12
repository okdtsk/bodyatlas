import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  aiSettingsInputSchema,
  estimateMealInputSchema,
  estimateResultSchema,
} from './ai';

describe('AI_PROVIDERS', () => {
  it('contains claude, openai, gemini', () => {
    expect(AI_PROVIDERS).toContain('claude');
    expect(AI_PROVIDERS).toContain('openai');
    expect(AI_PROVIDERS).toContain('gemini');
    expect(AI_PROVIDERS).toHaveLength(3);
  });
});

describe('aiSettingsInputSchema', () => {
  it('accepts a valid claude config with key', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'claude',
      model: 'claude-opus-4-8',
      apiKey: 'sk-ant-test12345678',
    });
    expect(result.success).toBe(true);
  });

  it('accepts config without apiKey (key already stored)', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'grok',
      model: 'grok-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a key shorter than 8 characters', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      apiKey: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a key longer than 200 characters', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty model', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'claude',
      model: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a model longer than 80 characters', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'claude',
      model: 'a'.repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from model and apiKey', () => {
    const result = aiSettingsInputSchema.safeParse({
      provider: 'claude',
      model: '  claude-opus-4-8  ',
      apiKey: '  sk-ant-trimmedkey  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe('claude-opus-4-8');
      expect(result.data.apiKey).toBe('sk-ant-trimmedkey');
    }
  });
});

describe('estimateMealInputSchema', () => {
  it('accepts a valid description', () => {
    const result = estimateMealInputSchema.safeParse({
      description: 'カツ丼 並盛り',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty description', () => {
    const result = estimateMealInputSchema.safeParse({ description: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a description longer than 300 characters', () => {
    const result = estimateMealInputSchema.safeParse({
      description: 'a'.repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from description', () => {
    const result = estimateMealInputSchema.safeParse({
      description: '  grilled chicken  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('grilled chicken');
    }
  });
});

describe('estimateResultSchema', () => {
  const validResult = {
    calories: 650,
    proteinG: 35.5,
    fatG: 20.0,
    carbsG: 80.0,
    confidence: 'high' as const,
    note: 'Estimate for standard serving',
  };

  it('accepts a valid estimate result', () => {
    expect(estimateResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('accepts result without optional note', () => {
    const { note: _note, ...noNote } = validResult;
    expect(estimateResultSchema.safeParse(noNote).success).toBe(true);
  });

  it('rejects negative calories', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, calories: -1 }).success).toBe(false);
  });

  it('rejects calories exceeding 10000', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, calories: 10001 }).success).toBe(false);
  });

  it('rejects non-integer calories', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, calories: 650.5 }).success).toBe(false);
  });

  it('rejects proteinG exceeding 1000', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, proteinG: 1001 }).success).toBe(false);
  });

  it('rejects negative fatG', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, fatG: -0.1 }).success).toBe(false);
  });

  it('rejects unknown confidence level', () => {
    expect(estimateResultSchema.safeParse({ ...validResult, confidence: 'very-high' }).success).toBe(false);
  });

  it('rejects note longer than 150 characters', () => {
    expect(
      estimateResultSchema.safeParse({ ...validResult, note: 'n'.repeat(151) }).success,
    ).toBe(false);
  });

  it('accepts all three confidence levels', () => {
    for (const confidence of ['low', 'medium', 'high'] as const) {
      expect(estimateResultSchema.safeParse({ ...validResult, confidence }).success).toBe(true);
    }
  });
});
