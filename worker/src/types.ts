export type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  BODYATLAS_MCP: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AI_KEY_SECRET: string;
  E2E_TEST_LOGIN?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { userId?: string };
};

/** For sub-apps mounted behind the auth middleware, where userId is guaranteed. */
export type ProtectedEnv = {
  Bindings: Bindings;
  Variables: { userId: string };
};
