import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

/** Minimal shape of a Cloudflare Workers rate-limit binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type Bindings = {
  ALLOWED_EMAILS?: string;
  ENVIRONMENT?: 'development' | 'production';
  DB: D1Database;
  SESSIONS: KVNamespace;
  BODYATLAS_MCP: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AI_KEY_SECRET: string;
  E2E_TEST_LOGIN?: string;
  PUBLIC_SITE?: string;
  RL_API?: RateLimiter;
  RL_AI?: RateLimiter;
  RL_AUTH?: RateLimiter;
  RL_MCP?: RateLimiter;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
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
