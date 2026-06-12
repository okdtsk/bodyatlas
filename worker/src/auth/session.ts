export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, rolling

const key = (token: string) => `session:${token}`;

export async function createSession(
  kv: KVNamespace,
  userId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  await kv.put(key(token), userId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function getSessionUserId(
  kv: KVNamespace,
  token: string,
): Promise<string | null> {
  const userId = await kv.get(key(token));
  if (userId !== null) {
    // Rolling expiry: refresh the TTL on every authenticated request.
    await kv.put(key(token), userId, { expirationTtl: SESSION_TTL_SECONDS });
  }
  return userId;
}

export async function deleteSession(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(key(token));
}
