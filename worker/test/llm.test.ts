import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, complete } from '../src/lib/llm';

const TEST_API_KEY = 'sk-ant-api03-secret-test-key-1234567890';

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper to mock fetch with a given JSON response.
// Uses mockImplementationOnce so the Response is constructed
// inside the Worker's request context (avoids cross-request I/O restriction).
function mockFetch(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function mockFetchText(body: string, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

describe('complete() — Claude', () => {
  it('sends correct URL, headers, body and extracts text', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'Hello from Claude' },
            { type: 'tool_use', id: 'ignored' },
          ],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await complete({
      provider: 'claude',
      model: 'claude-opus-4-8',
      apiKey: TEST_API_KEY,
      system: 'You are a helpful assistant.',
      prompt: 'Say hello',
      maxTokens: 100,
    });

    expect(result).toBe('Hello from Claude');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');

    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(TEST_API_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.max_tokens).toBe(100);
    expect(body.system).toBe('You are a helpful assistant.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
  });

  it('concatenates multiple text content items', async () => {
    mockFetch({
      content: [
        { type: 'text', text: 'Part 1 ' },
        { type: 'text', text: 'Part 2' },
      ],
      stop_reason: 'end_turn',
    });

    const result = await complete({
      provider: 'claude',
      model: 'claude-opus-4-8',
      apiKey: TEST_API_KEY,
      system: 'sys',
      prompt: 'prompt',
      maxTokens: 100,
    });

    expect(result).toBe('Part 1 Part 2');
  });

  it('throws AiError on non-OK response and does NOT include the api key in the message', async () => {
    mockFetchText(`Error: invalid api key ${TEST_API_KEY}`, 401);

    await expect(
      complete({
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: TEST_API_KEY,
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AiError);
      const msg = (err as AiError).message;
      expect(msg).toContain('401');
      expect(msg).not.toContain(TEST_API_KEY);
      return true;
    });
  });

  it('throws AiError when text content is empty', async () => {
    mockFetch({
      content: [{ type: 'tool_use', id: 'call_123' }],
      stop_reason: 'end_turn',
    });

    await expect(
      complete({
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: TEST_API_KEY,
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it('throws AiError when stop_reason is refusal', async () => {
    mockFetch({
      content: [{ type: 'text', text: 'I cannot do that.' }],
      stop_reason: 'refusal',
    });

    await expect(
      complete({
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: TEST_API_KEY,
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });
});

describe('complete() — OpenAI', () => {
  it('sends correct URL, headers, body and extracts text', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from OpenAI' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const openaiKey = 'sk-openai-test-key-abcdefg';
    const result = await complete({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: openaiKey,
      system: 'You are helpful.',
      prompt: 'Say hello',
      maxTokens: 200,
    });

    expect(result).toBe('Hello from OpenAI');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${openaiKey}`);
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_completion_tokens).toBe(200);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Say hello' },
    ]);
  });

  it('throws AiError on non-OK response without key leakage', async () => {
    const openaiKey = 'sk-openai-super-secret-key';
    mockFetchText(`{"error":{"message":"Incorrect API key: ${openaiKey}"}}`, 401);

    await expect(
      complete({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: openaiKey,
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AiError);
      const msg = (err as AiError).message;
      expect(msg).toContain('401');
      expect(msg).not.toContain(openaiKey);
      return true;
    });
  });

  it('throws AiError when content is empty string', async () => {
    mockFetch({
      choices: [{ message: { content: '' } }],
    });

    await expect(
      complete({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-openai-key',
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });
});

describe('complete() — Gemini', () => {
  it('sends correct URL, headers, body and extracts text', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello from ' }, { text: 'Gemini' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const geminiKey = 'AIza-gemini-test-key-1234567';
    const result = await complete({
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      apiKey: geminiKey,
      system: 'You are helpful.',
      prompt: 'Say hello',
      maxTokens: 300,
    });

    expect(result).toBe('Hello from Gemini');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
    );

    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(geminiKey);
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Say hello' }] }]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 300 });
  });

  it('throws AiError on non-OK response without key leakage', async () => {
    const geminiKey = 'AIza-super-secret-gemini-key';
    mockFetchText(`API_KEY_INVALID: ${geminiKey} not authorized`, 403);

    await expect(
      complete({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        apiKey: geminiKey,
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AiError);
      const msg = (err as AiError).message;
      expect(msg).toContain('403');
      expect(msg).not.toContain(geminiKey);
      return true;
    });
  });

  it('throws AiError when parts text is empty', async () => {
    mockFetch({
      candidates: [
        {
          content: {
            parts: [],
          },
        },
      ],
    });

    await expect(
      complete({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        apiKey: 'AIza-key',
        system: 'sys',
        prompt: 'prompt',
        maxTokens: 100,
      }),
    ).rejects.toBeInstanceOf(AiError);
  });
});
