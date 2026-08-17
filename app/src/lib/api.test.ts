import { describe, expect, it } from 'vitest';
import { ApiError, expectOk } from './api';

/** Minimal stand-in for the Hono client's ClientResponse. */
const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('expectOk', () => {
  it('returns the parsed body on success', async () => {
    await expect(expectOk(Promise.resolve(response(200, { id: 'x' })))).resolves.toEqual({
      id: 'x',
    });
  });

  it('throws an ApiError carrying the structured error body', async () => {
    const promise = expectOk(
      Promise.resolve(
        response(409, {
          error: { code: 'duplicate', message: 'already exists', existingName: 'Back Squat' },
        }),
      ),
    );
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      code: 'duplicate',
      existingName: 'Back Squat',
    });
  });

  it('still throws an ApiError when the body has no error shape', async () => {
    const err = await expectOk(Promise.resolve(response(500, 'boom'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, code: undefined });
    expect((err as ApiError).message).toContain('500');
  });

  it('still throws an ApiError when the body is not JSON at all', async () => {
    const err = await expectOk(
      Promise.resolve({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502 });
  });

  it('is an Error, so existing catch-all call sites keep working', async () => {
    const err = await expectOk(Promise.resolve(response(404, {}))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });
});
