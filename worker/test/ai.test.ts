import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

async function authed(userId = 'ai-user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

function json(headers: Record<string, string>, body: unknown, method = 'PUT') {
  return {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('GET /api/ai/settings — unconfigured', () => {
  it('returns { provider: null, hasKey: false } when no settings stored', async () => {
    const headers = await authed('ai-get-empty');
    const res = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBeNull();
    expect(body.hasKey).toBe(false);
  });
});

describe('PUT /api/ai/settings', () => {
  it('stores settings and GET returns provider/model/hasKey=true/lastReviewAt=null', async () => {
    const headers = await authed('ai-put-1');
    const putRes = await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: 'sk-ant-api03-testapikey',
      }),
    );
    expect(putRes.status).toBe(200);

    const getRes = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body.provider).toBe('claude');
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.hasKey).toBe(true);
    expect(body.lastReviewAt).toBeNull();
  });

  it('NEVER returns key material (apiKey, encryptedKey, keyIv, ciphertext) in GET response', async () => {
    const apiKey = 'sk-ant-api03-my-super-secret-key-value-here';
    const headers = await authed('ai-put-nokey');
    await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey,
      }),
    );

    const getRes = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    const rawBody = await getRes.text();

    // The actual key value must not appear anywhere in the response
    expect(rawBody).not.toContain(apiKey);
    // Neither should ciphertext-related field names
    expect(rawBody).not.toContain('encryptedKey');
    expect(rawBody).not.toContain('keyIv');
    expect(rawBody).not.toContain('encrypted_key');
    expect(rawBody).not.toContain('key_iv');
  });

  it('NEVER returns key material in PUT response', async () => {
    const apiKey = 'sk-ant-api03-put-secret-check';
    const headers = await authed('ai-put-noleakput');
    const putRes = await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey,
      }),
    );
    const rawBody = await putRes.text();
    expect(rawBody).not.toContain(apiKey);
    expect(rawBody).not.toContain('encryptedKey');
    expect(rawBody).not.toContain('keyIv');
  });

  it('updates model only when no apiKey provided, keeps stored key', async () => {
    const headers = await authed('ai-update-model');
    // First PUT with key
    await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: 'sk-ant-api03-initial-key',
      }),
    );

    // Second PUT without key — just update model
    const updateRes = await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-sonnet-4-5',
      }),
    );
    expect(updateRes.status).toBe(200);

    const getRes = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.hasKey).toBe(true); // key was preserved
  });

  it('returns 422 when no apiKey and no existing row', async () => {
    const headers = await authed('ai-422-no-key');
    const res = await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-opus-4-8',
        // no apiKey
      }),
    );
    expect(res.status).toBe(422);
  });

  it('returns 422 on invalid provider', async () => {
    const headers = await authed('ai-422-provider');
    const res = await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'invalid-llm',
        model: 'some-model',
        apiKey: 'sk-ant-api03-somekey-1234',
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/ai/settings', () => {
  it('wipes the row and subsequent GET returns unconfigured', async () => {
    const headers = await authed('ai-delete');
    // Store settings first
    await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        apiKey: 'AIza-test-key-1234567890',
      }),
    );

    // Confirm stored
    const getRes1 = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    expect(((await getRes1.json()) as Record<string, unknown>).hasKey).toBe(true);

    // Delete
    const delRes = await SELF.fetch('https://example.com/api/ai/settings', {
      method: 'DELETE',
      headers,
    });
    expect(delRes.status).toBe(200);

    // Confirm wiped
    const getRes2 = await SELF.fetch('https://example.com/api/ai/settings', { headers });
    const body = (await getRes2.json()) as Record<string, unknown>;
    expect(body.provider).toBeNull();
    expect(body.hasKey).toBe(false);
  });
});

describe('POST /api/ai/test', () => {
  it('returns { ok: true } when provider responds successfully', async () => {
    // Store settings with a real (mocked) provider
    const headers = await authed('ai-test-ok');
    await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'claude',
        model: 'claude-opus-4-8',
        apiKey: 'sk-ant-api03-test-ok-key-12345678',
      }),
    );

    // Mock the upstream Claude call to return "ok".
    // Must use mockImplementationOnce so the Response is constructed
    // inside the Worker's request context (avoids cross-request I/O restriction).
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const testRes = await SELF.fetch('https://example.com/api/ai/test', {
      method: 'POST',
      headers,
    });
    expect(testRes.status).toBe(200);
    const body = (await testRes.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it('returns 409 when no settings configured', async () => {
    const headers = await authed('ai-test-nocfg');
    const res = await SELF.fetch('https://example.com/api/ai/test', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ai_not_configured');
  });

  it('returns 502 ai_error when provider returns non-OK', async () => {
    const headers = await authed('ai-test-502');
    await SELF.fetch(
      'https://example.com/api/ai/settings',
      json(headers, {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-openai-test-502-key-abcdef',
      }),
    );

    // Mock upstream returning 401 (constructed inside worker context)
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response('{"error":{"message":"Invalid API key"}}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const testRes = await SELF.fetch('https://example.com/api/ai/test', {
      method: 'POST',
      headers,
    });
    expect(testRes.status).toBe(502);
    const body = (await testRes.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ai_error');
    // The api key must not appear in the error message
    expect(body.error.message).not.toContain('sk-openai-test-502-key-abcdef');
  });
});
