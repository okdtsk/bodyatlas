import type { AiProvider } from '@bodyatlas/shared';

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export type CompleteOptions = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
};

/**
 * Strips any occurrence of the api key from a string to prevent key leakage in error messages.
 * Also truncates to 300 chars.
 */
function sanitizeError(text: string, apiKey: string): string {
  const stripped = text.replaceAll(apiKey, '[REDACTED]');
  return stripped.slice(0, 300);
}

async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export async function complete(opts: CompleteOptions): Promise<string> {
  const { provider, model, apiKey, system, prompt, maxTokens } = opts;
  const signal = AbortSignal.timeout(60_000);

  let url: string;
  let headers: Record<string, string>;
  let body: unknown;

  if (provider === 'claude') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
    body = {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
  } else {
    // gemini
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers = {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await readBodyText(res);
    const safe = sanitizeError(errText, apiKey);
    throw new AiError(`provider ${provider} returned ${res.status}: ${safe}`);
  }

  const data = (await res.json()) as unknown;
  let text = '';

  if (provider === 'claude') {
    const typed = data as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };
    if (typed.stop_reason === 'refusal') {
      throw new AiError(`provider claude refused: refusal stop_reason`);
    }
    text = (typed.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
  } else if (provider === 'openai') {
    const typed = data as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    text = typed.choices?.[0]?.message?.content ?? '';
  } else {
    // gemini
    const typed = data as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    text = (typed.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
  }

  if (!text) {
    throw new AiError(`provider ${provider} returned empty text`);
  }

  return text;
}
