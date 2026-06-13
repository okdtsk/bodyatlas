# BodyAtlas Public Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BodyAtlas "responsible personal/invite"-ready: data export, account deletion, rate limiting, a public privacy page, and a first-run onboarding wizard.

**Architecture:** New protected `accountRoutes` (`/api/account`) for export + deletion; a key-deriving rate-limit middleware over Cloudflare's GA `ratelimit` bindings; a public `/privacy` SPA route (router restructured so it renders without auth); and a first-run wizard gated on a new `users.onboardedAt` column (migration 0008).

**Tech Stack:** Hono + Drizzle + D1 + KV, shared Zod schemas, React SPA (react-router v7), Cloudflare `ratelimit` bindings, vitest (workers pool + jsdom). Source of truth: `docs/superpowers/specs/2026-06-13-bodyatlas-public-hardening-design.md`.

---

## File structure (new / changed)

```
worker/src/routes/account.ts          # GET /export, DELETE / (new protected group)
worker/src/lib/rate-limit.ts          # key-deriving middleware factory over a limiter binding
worker/src/index.ts                   # mount accountRoutes; wire rate-limit middleware
worker/src/types.ts                   # RateLimiter interface + RL_* bindings
worker/src/db/schema.ts               # users.onboardedAt
worker/src/routes/me.ts               # map onboarded:true -> onboardedAt=now
worker/migrations/0008_user_onboarded_at.sql
worker/wrangler.jsonc                 # ratelimit bindings RL_API/RL_AI/RL_AUTH/RL_MCP
worker/test/account.test.ts           # export + delete
worker/test/rate-limit.test.ts        # middleware behavior with a fake limiter
worker/test/me.test.ts                # onboarded flag (extend)
shared/src/user.ts                    # onboarded flag on updateMeSchema
app/src/lib/account.ts                # export/delete client helpers
app/src/pages/PrivacyPage.tsx         # public privacy page
app/src/components/OnboardingWizard.tsx
app/src/App.tsx                       # public /privacy route + onboarding gating
app/src/pages/SettingsPage.tsx        # export button, delete danger zone, privacy link
app/src/pages/{TodayPage,TrainPage,HealthPage,TrendsPage}.tsx  # empty-state hints
app/src/i18n/{en,ja}.ts               # all new strings
```

---

### Task 1: Data export endpoint

**Files:**
- Create: `worker/src/routes/account.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/account.test.ts`

- [ ] **Step 1: Write the failing test.** Create `worker/test/account.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedCustomExercise, seedTemplate, seedUser, seedWorkout, sessionCookieFor } from './helpers';
import { env } from 'cloudflare:test';
import { getDb, schema } from '../src/db';

describe('GET /api/account/export', () => {
  it('returns 401 without a session', async () => {
    const res = await SELF.fetch('https://example.com/api/account/export');
    expect(res.status).toBe(401);
  });

  it("exports the user's data as a JSON attachment, excluding secrets", async () => {
    await seedUser('u1', { targetKcal: 2000 });
    await seedCustomExercise('ex1', 'u1');
    await seedWorkout('w1', 'u1', 'ex1', [{ reps: 5, weightKg: 100 }]);
    await seedTemplate('t1', 'u1', 'Push', ['ex1']);
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm1', userId: 'u1', name: 'Eggs' });
    await db.insert(schema.apiTokens).values({ id: 'tok1', userId: 'u1', name: 'cli', tokenHash: 'SECRET_HASH' });
    await db.insert(schema.aiSettings).values({
      userId: 'u1', provider: 'claude', model: 'claude-opus-4-8', encryptedKey: 'SECRET_KEY', keyIv: 'SECRET_IV',
    });

    const res = await SELF.fetch('https://example.com/api/account/export', {
      headers: { Cookie: await sessionCookieFor('u1') },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');

    const data = (await res.json()) as Record<string, any>;
    expect(data.user.email).toBe('u1@example.com');
    expect(data.user).not.toHaveProperty('googleSub');
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].workoutExercises[0].sets[0].reps).toBe(5);
    expect(data.templates[0].name).toBe('Push');
    expect(data.meals[0].name).toBe('Eggs');
    expect(data.exercises).toHaveLength(1); // custom only

    const blob = JSON.stringify(data);
    expect(blob).not.toContain('SECRET_HASH');
    expect(blob).not.toContain('SECRET_KEY');
    expect(blob).not.toContain('SECRET_IV');
    expect(data.apiTokens[0]).toMatchObject({ name: 'cli' });
    expect(data.apiTokens[0]).not.toHaveProperty('tokenHash');
    expect(data.aiSettings).toMatchObject({ provider: 'claude', model: 'claude-opus-4-8' });
  });

  it('never exports another user’s rows', async () => {
    await seedUser('u1');
    await seedUser('u2');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm2', userId: 'u2', name: 'Other' });
    const res = await SELF.fetch('https://example.com/api/account/export', {
      headers: { Cookie: await sessionCookieFor('u1') },
    });
    const data = (await res.json()) as Record<string, any>;
    expect(data.meals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure.** Run: `npm test --workspace worker -- account`
Expected: FAIL (route not found → 404/401 mismatch).

- [ ] **Step 3: Implement the export route.** Create `worker/src/routes/account.ts`:

```ts
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

export const accountRoutes = new Hono<ProtectedEnv>().get('/export', async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get('userId');

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
  const { googleSub: _g, ...userExport } = user;

  const workouts = await db.query.workouts.findMany({
    where: eq(schema.workouts.userId, userId),
    with: { workoutExercises: { with: { sets: true } } },
  });
  const templates = await db.query.templates.findMany({
    where: eq(schema.templates.userId, userId),
    with: { templateExercises: true },
  });
  const meals = await db.select().from(schema.meals).where(eq(schema.meals.userId, userId));
  const sleep = await db.select().from(schema.sleepRecords).where(eq(schema.sleepRecords.userId, userId));
  const measurements = await db
    .select()
    .from(schema.bodyMeasurements)
    .where(eq(schema.bodyMeasurements.userId, userId));
  const exercises = await db.select().from(schema.exercises).where(eq(schema.exercises.userId, userId));

  // Secrets excluded: tokens expose name + timestamps only; ai settings expose provider + model only.
  const tokenRows = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, userId));
  const apiTokens = tokenRows.map((t) => ({ name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }));
  const ai = await db.query.aiSettings.findFirst({ where: eq(schema.aiSettings.userId, userId) });
  const aiSettings = ai ? { provider: ai.provider, model: ai.model } : null;

  const payload = {
    exportedAt: new Date().toISOString(),
    user: userExport,
    workouts,
    templates,
    meals,
    sleep,
    measurements,
    exercises,
    apiTokens,
    aiSettings,
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="bodyatlas-export-${date}.json"`,
    },
  });
});
```

> NOTE: `db.query.aiSettings` / `db.query.workouts` require the Drizzle relations to be registered (they are, in `schema.ts`). If `db.query.X` is not available for a table, fall back to `db.select().from(schema.X)` and assemble nesting manually — but check first; the relations exist for workouts/workoutExercises/sets and templates/templateExercises.

- [ ] **Step 4: Mount the route.** In `worker/src/index.ts`, add the import and the `.route` line on `apiApp` (after `requireAuth`, alongside the others):

```ts
import { accountRoutes } from './routes/account';
// ...in the apiApp chain, add:
    .route('/account', accountRoutes)
```

- [ ] **Step 5: Run to confirm pass.** Run: `npm test --workspace worker -- account`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add worker/src/routes/account.ts worker/src/index.ts worker/test/account.test.ts
git commit -m "feat: account data export endpoint (excludes secrets)"
```

---

### Task 2: Export button in Settings

**Files:**
- Create: `app/src/lib/account.ts`
- Modify: `app/src/pages/SettingsPage.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`

- [ ] **Step 1: Implement the export helper.** Create `app/src/lib/account.ts`:

```ts
/**
 * Trigger a download of the user's full data export. Uses a raw fetch + blob
 * because the response is a file attachment, not a typed JSON RPC body.
 */
export async function downloadExport(): Promise<void> {
  const res = await fetch('/api/account/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `bodyatlas-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 2: Add i18n strings.** In `app/src/i18n/en.ts` add `'account.section': 'Account'`, `'account.export': 'Export my data'`, `'account.exportError': 'Export failed. Please try again.'`. In `app/src/i18n/ja.ts` add the parity keys: `'account.section': 'アカウント'`, `'account.export': 'データをエクスポート'`, `'account.exportError': 'エクスポートに失敗しました。'`.

- [ ] **Step 3: Add the button to Settings.** In `app/src/pages/SettingsPage.tsx` (read the file first to match its section markup), add an "Account" section with an Export button:

```tsx
import { downloadExport } from '../lib/account';
// component state:
const [exportError, setExportError] = useState(false);
// in JSX, a new section:
<section>
  <h2>{t('account.section')}</h2>
  <button
    type="button"
    onClick={async () => {
      setExportError(false);
      try { await downloadExport(); } catch { setExportError(true); }
    }}
  >
    {t('account.export')}
  </button>
  {exportError && <p style={{ color: 'var(--negative)' }}>{t('account.exportError')}</p>}
</section>
```

Match the existing section heading/button styling in the file.

- [ ] **Step 4: Typecheck + tests + parity.** Run: `npm run typecheck --workspace app` then `npm test --workspace app -- i18n SettingsPage`
Expected: PASS (i18n parity green; existing SettingsPage tests still pass).

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/account.ts app/src/pages/SettingsPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: export-my-data button in settings"
```

---

### Task 3: Account deletion endpoint

**Files:**
- Modify: `worker/src/routes/account.ts`, `worker/test/account.test.ts`

The deletion deletes children before parents explicitly (not relying on FK cascade, which depends on SQLite pragma state), then revokes the session.

- [ ] **Step 1: Write the failing test.** Append to `worker/test/account.test.ts`:

```ts
import { inArray } from 'drizzle-orm';

describe('DELETE /api/account', () => {
  it('returns 401 without a session', async () => {
    const res = await SELF.fetch('https://example.com/api/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('deletes all the user’s rows and revokes the session', async () => {
    await seedUser('u1');
    await seedCustomExercise('ex1', 'u1');
    await seedWorkout('w1', 'u1', 'ex1', [{ reps: 5 }]);
    await seedTemplate('t1', 'u1', 'Push', ['ex1']);
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm1', userId: 'u1', name: 'Eggs' });
    await db.insert(schema.sleepRecords).values({
      id: 's1', userId: 'u1', bedAt: new Date('2026-06-01T23:00:00Z'), wokeAt: new Date('2026-06-02T07:00:00Z'),
    });
    await db.insert(schema.bodyMeasurements).values({ id: 'bm1', userId: 'u1', weightKg: 70 });
    await db.insert(schema.apiTokens).values({ id: 'tok1', userId: 'u1', name: 'cli', tokenHash: 'h' });
    await db.insert(schema.aiSettings).values({
      userId: 'u1', provider: 'claude', model: 'm', encryptedKey: 'k', keyIv: 'iv',
    });

    const cookie = await sessionCookieFor('u1');
    const res = await SELF.fetch('https://example.com/api/account', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    // Every owned row is gone.
    expect(await db.select().from(schema.users).where(eq(schema.users.id, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.workouts).where(eq(schema.workouts.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.sets)).toHaveLength(0);
    expect(await db.select().from(schema.workoutExercises)).toHaveLength(0);
    expect(await db.select().from(schema.templates).where(eq(schema.templates.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.meals).where(eq(schema.meals.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.exercises).where(eq(schema.exercises.userId, 'u1'))).toHaveLength(0);

    // Session revoked: the same cookie no longer authenticates.
    const after = await SELF.fetch('https://example.com/api/me', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it('does not delete another user’s data', async () => {
    await seedUser('u1');
    await seedUser('u2');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm2', userId: 'u2', name: 'Keep' });
    await SELF.fetch('https://example.com/api/account', { method: 'DELETE', headers: { Cookie: await sessionCookieFor('u1') } });
    expect(await db.select().from(schema.meals).where(eq(schema.meals.userId, 'u2'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure.** Run: `npm test --workspace worker -- account`
Expected: FAIL (DELETE route missing).

- [ ] **Step 3: Implement deletion.** In `worker/src/routes/account.ts`, add imports and the `.delete('/')` handler to the chain. Update the top imports:

```ts
import { eq, inArray } from 'drizzle-orm';
import { getCookie, deleteCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../auth/middleware';
import { deleteSession } from '../auth/session';
```

Add the handler (chain it onto `accountRoutes` after `.get('/export', ...)`):

```ts
  .delete('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');

    // Delete children before parents (explicit; do not rely on FK cascade).
    const workoutIds = (
      await db.select({ id: schema.workouts.id }).from(schema.workouts).where(eq(schema.workouts.userId, userId))
    ).map((r) => r.id);
    if (workoutIds.length > 0) {
      const weIds = (
        await db
          .select({ id: schema.workoutExercises.id })
          .from(schema.workoutExercises)
          .where(inArray(schema.workoutExercises.workoutId, workoutIds))
      ).map((r) => r.id);
      if (weIds.length > 0) {
        await db.delete(schema.sets).where(inArray(schema.sets.workoutExerciseId, weIds));
        await db.delete(schema.workoutExercises).where(inArray(schema.workoutExercises.id, weIds));
      }
      await db.delete(schema.workouts).where(eq(schema.workouts.userId, userId));
    }

    const templateIds = (
      await db.select({ id: schema.templates.id }).from(schema.templates).where(eq(schema.templates.userId, userId))
    ).map((r) => r.id);
    if (templateIds.length > 0) {
      await db.delete(schema.templateExercises).where(inArray(schema.templateExercises.templateId, templateIds));
      await db.delete(schema.templates).where(eq(schema.templates.userId, userId));
    }

    await db.delete(schema.meals).where(eq(schema.meals.userId, userId));
    await db.delete(schema.sleepRecords).where(eq(schema.sleepRecords.userId, userId));
    await db.delete(schema.bodyMeasurements).where(eq(schema.bodyMeasurements.userId, userId));
    await db.delete(schema.apiTokens).where(eq(schema.apiTokens.userId, userId));
    await db.delete(schema.aiSettings).where(eq(schema.aiSettings.userId, userId));
    await db.delete(schema.exercises).where(eq(schema.exercises.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    // Revoke the current session and clear the cookie.
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.env.SESSIONS, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });

    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run to confirm pass.** Run: `npm test --workspace worker -- account`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add worker/src/routes/account.ts worker/test/account.test.ts
git commit -m "feat: account deletion with FK-safe cascade and session revocation"
```

---

### Task 4: Delete-account danger zone (UI)

**Files:**
- Modify: `app/src/lib/account.ts`, `app/src/pages/SettingsPage.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`

- [ ] **Step 1: Add the delete helper.** Append to `app/src/lib/account.ts`:

```ts
/** Permanently delete the account; the server revokes the session. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/account', { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
```

- [ ] **Step 2: Add i18n strings.** EN (`app/src/i18n/en.ts`): `'account.dangerZone': 'Danger zone'`, `'account.delete': 'Delete account'`, `'account.deleteWarning': 'This permanently deletes your account and all your data. This cannot be undone.'`, `'account.deleteConfirmLabel': 'Type DELETE to confirm'`, `'account.deleteConfirmWord': 'DELETE'`, `'account.deleteError': 'Could not delete your account. Please try again.'`. JA (`app/src/i18n/ja.ts`) parity: `'account.dangerZone': '危険な操作'`, `'account.delete': 'アカウントを削除'`, `'account.deleteWarning': 'アカウントとすべてのデータが完全に削除されます。元に戻せません。'`, `'account.deleteConfirmLabel': '確認のため DELETE と入力してください'`, `'account.deleteConfirmWord': 'DELETE'`, `'account.deleteError': 'アカウントを削除できませんでした。もう一度お試しください。'`.

- [ ] **Step 3: Add the danger zone to Settings.** In `app/src/pages/SettingsPage.tsx`, add a danger-zone block. The destructive button is disabled until the user types the confirmation word; on success, redirect to the login screen via a full reload (clears all in-memory state):

```tsx
import { deleteAccount } from '../lib/account';
// state:
const [confirmText, setConfirmText] = useState('');
const [deleteError, setDeleteError] = useState(false);
const [deleting, setDeleting] = useState(false);
const confirmWord = t('account.deleteConfirmWord');
// JSX, inside the Account section (after Export):
<div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
  <h3 style={{ color: 'var(--negative)' }}>{t('account.dangerZone')}</h3>
  <p style={{ color: 'var(--text-muted)' }}>{t('account.deleteWarning')}</p>
  <label>
    {t('account.deleteConfirmLabel')}
    <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
  </label>
  <button
    type="button"
    disabled={confirmText !== confirmWord || deleting}
    onClick={async () => {
      setDeleteError(false);
      setDeleting(true);
      try {
        await deleteAccount();
        window.location.href = '/';
      } catch {
        setDeleteError(true);
        setDeleting(false);
      }
    }}
    style={{ background: 'var(--negative)', color: 'var(--accent-contrast)' }}
  >
    {t('account.delete')}
  </button>
  {deleteError && <p style={{ color: 'var(--negative)' }}>{t('account.deleteError')}</p>}
</div>
```

- [ ] **Step 4: Typecheck + tests.** Run: `npm run typecheck --workspace app` then `npm test --workspace app -- i18n SettingsPage`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/account.ts app/src/pages/SettingsPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: delete-account danger zone with typed confirmation"
```

---

### Task 5: Rate-limit middleware

**Files:**
- Create: `worker/src/lib/rate-limit.ts`
- Modify: `worker/src/types.ts`
- Test: `worker/test/rate-limit.test.ts`

- [ ] **Step 1: Add the limiter type + bindings.** In `worker/src/types.ts`, add a minimal limiter interface (avoids depending on the ambient `RateLimit` type) and the four bindings:

```ts
/** Minimal shape of a Cloudflare Workers rate-limit binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
```

Add to the `Bindings` type:

```ts
  RL_API: RateLimiter;
  RL_AI: RateLimiter;
  RL_AUTH: RateLimiter;
  RL_MCP: RateLimiter;
```

- [ ] **Step 2: Write the failing test.** Create `worker/test/rate-limit.test.ts`:

```ts
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { rateLimit } from '../src/lib/rate-limit';
import type { RateLimiter } from '../src/types';

function appWith(limiter: RateLimiter, getKey: (c: any) => string | null) {
  const app = new Hono();
  app.use('*', rateLimit((env) => (env as any).LIM as RateLimiter, getKey));
  app.get('/', (c) => c.text('ok'));
  return app;
}

const allow: RateLimiter = { limit: async () => ({ success: true }) };
const deny: RateLimiter = { limit: async () => ({ success: false }) };

describe('rateLimit middleware', () => {
  it('passes through when under the limit', async () => {
    const app = appWith(allow, () => 'k');
    const res = await app.request('/', {}, { LIM: allow });
    expect(res.status).toBe(200);
  });

  it('returns 429 with Retry-After when over the limit', async () => {
    const app = appWith(deny, () => 'k');
    const res = await app.request('/', {}, { LIM: deny });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('calls the limiter with the derived key', async () => {
    const spy = vi.fn(async () => ({ success: true }));
    const lim: RateLimiter = { limit: spy };
    const app = appWith(lim, () => 'user-42');
    await app.request('/', {}, { LIM: lim });
    expect(spy).toHaveBeenCalledWith({ key: 'user-42' });
  });

  it('fails open (allows) when no key can be derived', async () => {
    const spy = vi.fn(async () => ({ success: false }));
    const lim: RateLimiter = { limit: spy };
    const app = appWith(lim, () => null);
    const res = await app.request('/', {}, { LIM: lim });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to confirm failure.** Run: `npm test --workspace worker -- rate-limit`
Expected: FAIL (`rateLimit` not defined).

- [ ] **Step 4: Implement the middleware.** Create `worker/src/lib/rate-limit.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../types';

/**
 * Build a rate-limit middleware over a limiter binding.
 * - getBinding picks the limiter from the env.
 * - getKey derives the bucket key (user id, IP, token). Returning null fails OPEN
 *   (allow) so a missing key never blocks legitimate traffic.
 * The binding is enforced only on deployed Cloudflare, not in local dev/tests.
 */
export function rateLimit(
  getBinding: (env: unknown) => RateLimiter,
  getKey: (c: Context) => string | null,
): MiddlewareHandler {
  return async (c, next) => {
    const key = getKey(c);
    if (key) {
      const { success } = await getBinding(c.env).limit({ key });
      if (!success) {
        return c.json(
          { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
          429,
          { 'Retry-After': '60' },
        );
      }
    }
    await next();
  };
}
```

- [ ] **Step 5: Run to confirm pass.** Run: `npm test --workspace worker -- rate-limit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add worker/src/lib/rate-limit.ts worker/src/types.ts worker/test/rate-limit.test.ts
git commit -m "feat: rate-limit middleware over a limiter binding"
```

---

### Task 6: Wire rate limiting into the app + wrangler

**Files:**
- Modify: `worker/src/index.ts`, `worker/wrangler.jsonc`

- [ ] **Step 1: Apply the middleware.** In `worker/src/index.ts`, import the middleware and the route helpers, then apply limiters. The default API limiter runs before `requireAuth` would not have a userId, so derive the user key AFTER auth — apply `RL_API` on the `apiApp` chain after `.use(requireAuth)` (userId is set), and `RL_AI` scoped to `/ai`. Apply `RL_AUTH` (IP) on the `/auth` mount. Apply `RL_MCP` (token) in the `default.fetch` MCP branch.

```ts
import { rateLimit } from './lib/rate-limit';

// apiApp: after `.use(requireAuth)`, add the per-user API limiter, and a stricter AI one on /ai:
export const apiApp = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use(requireAuth)
  .use(rateLimit((env) => (env as Bindings).RL_API, (c) => c.get('userId') ?? null))
  .route('/me', meRoutes)
  // ... other routes ...
  .use('/ai/*', rateLimit((env) => (env as Bindings).RL_AI, (c) => c.get('userId') ?? null))
  .route('/ai', aiRoutes)
  .route('/account', accountRoutes);
```

> NOTE: middleware order in Hono is registration order. Register the `/ai/*` strict limiter BEFORE `.route('/ai', aiRoutes)`. The general `RL_API` use() (registered before all routes) covers every `/api/*` route including `/ai`, so AI requests consult both buckets. Verify with the test in the next step and `npm run typecheck --workspace worker`.

For `/auth` (per-IP), wrap the mount:

```ts
app.use('/auth/*', rateLimit((env) => (env as Bindings).RL_AUTH, (c) => c.req.header('CF-Connecting-IP') ?? null));
app.route('/auth', authRoutes);
app.route('/auth', testLoginRoutes);
```

For `/mcp` (per token), in `default.fetch`, after deriving `token`, call the limiter before serving:

```ts
      const userId = token ? await verifyToken(env.DB, token) : null;
      if (!userId) { /* existing 401 */ }
      const { success } = await env.RL_MCP.limit({ key: token });
      if (!success) {
        return Response.json({ error: { code: 'rate_limited', message: 'Too many requests.' } }, { status: 429, headers: { 'Retry-After': '60' } });
      }
```

- [ ] **Step 2: Add a smoke test** that the limiter doesn’t break normal requests (the test env has no real binding, so inject a permissive fake via the existing pattern OR confirm middleware is skipped when binding is absent). Add to `worker/test/account.test.ts` (or a new `worker/test/rate-limit-wiring.test.ts`) a check that `/api/me` still returns 200 with a session — this proves wiring didn’t 500. In the vitest workers pool, define the `RL_*` bindings in `worker/test/env` setup as permissive fakes if the harness requires them; if `env.RL_API` is undefined in tests, guard the middleware call: `const b = getBinding(c.env); if (b) { ... }`. **Update `rate-limit.ts` to no-op when the binding is undefined** (add `if (!b) { await next(); return; }`) and add a test for that. Re-run `npm test --workspace worker`.

- [ ] **Step 3: Configure the wrangler bindings.** In `worker/wrangler.jsonc`, add the `ratelimit` bindings. VERIFY the exact config key + shape against the current docs (`https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/`) before finalizing — the GA shape is roughly:

```jsonc
"ratelimits": [
  { "name": "RL_API",  "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } },
  { "name": "RL_AI",   "namespace_id": "1002", "simple": { "limit": 10,  "period": 60 } },
  { "name": "RL_AUTH", "namespace_id": "1003", "simple": { "limit": 20,  "period": 60 } },
  { "name": "RL_MCP",  "namespace_id": "1004", "simple": { "limit": 60,  "period": 60 } }
]
```

`namespace_id` values must be unique integers; `period` must be 10 or 60. Confirm the config validates with `npx wrangler deploy --dry-run --config worker/wrangler.jsonc` (no deploy).

- [ ] **Step 4: Full worker gate.** Run: `npm test --workspace worker` and `npm run typecheck --workspace worker`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add worker/src/index.ts worker/src/lib/rate-limit.ts worker/wrangler.jsonc worker/test/
git commit -m "feat: wire per-route rate limiting (api/ai/auth/mcp)"
```

---

### Task 7: Public privacy page

**Files:**
- Create: `app/src/pages/PrivacyPage.tsx`
- Modify: `app/src/App.tsx`, `app/src/pages/LoginPage.tsx`, `app/src/pages/SettingsPage.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`

- [ ] **Step 1: Write the privacy page.** Create `app/src/pages/PrivacyPage.tsx`. Use the i18n catalog for the body so EN/JA both render; keep the content plain-language and owned by the user:

```tsx
import { Link } from 'react-router';
import { useI18n } from '../i18n';

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, lineHeight: 1.6 }}>
      <h1>{t('privacy.title')}</h1>
      <p>{t('privacy.intro')}</p>
      <h2>{t('privacy.dataTitle')}</h2>
      <p>{t('privacy.dataBody')}</p>
      <h2>{t('privacy.storageTitle')}</h2>
      <p>{t('privacy.storageBody')}</p>
      <h2>{t('privacy.rightsTitle')}</h2>
      <p>{t('privacy.rightsBody')}</p>
      <h2>{t('privacy.sharingTitle')}</h2>
      <p>{t('privacy.sharingBody')}</p>
      <p style={{ marginTop: 24 }}>{t('privacy.contact')}</p>
      <Link to="/">{t('privacy.back')}</Link>
    </main>
  );
}
```

- [ ] **Step 2: Add i18n strings.** Add a `privacy.*` block to BOTH `app/src/i18n/en.ts` and `app/src/i18n/ja.ts` with matching keys: `title`, `intro`, `dataTitle`, `dataBody` (stored: workouts, meals, sleep, body measurements, plus Google name + email), `storageTitle`, `storageBody` (Cloudflare D1 + KV; AI provider keys are bring-your-own and encrypted at rest), `rightsTitle`, `rightsBody` (export + delete available in Settings), `sharingTitle`, `sharingBody` (not sold or shared; no ads/tracking), `contact` (a contact line), `back` ('Back' / '戻る'), plus `privacy.link` ('Privacy' / 'プライバシー'). Keep EN and JA key sets identical (parity test).

- [ ] **Step 3: Make `/privacy` a public route.** In `app/src/App.tsx`, restructure so the router always mounts and `/privacy` renders regardless of auth. Replace the current `isPending ? ... : me === null ? <LoginPage/> : <BrowserRouter>...` with a single `BrowserRouter` containing a public `/privacy` route and an auth-gated catch-all:

```tsx
return (
  <I18nProvider locale={locale}>
    <ThemeProvider theme={theme}>
      <BrowserRouter>
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
          {isPending ? (
            <Route path="*" element={<Loading />} />
          ) : me == null ? (
            <Route path="*" element={<LoginPage />} />
          ) : (
            <Route element={<AppLayout />}>
              <Route index element={<TodayPage />} />
              {/* ...existing nested routes unchanged... */}
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </I18nProvider>
);
```

Import `PrivacyPage`. (Onboarding gating is added in Task 9 by branching the authed catch-all.)

- [ ] **Step 4: Link to it.** In `app/src/pages/LoginPage.tsx` add a footer `<a href="/privacy">{t('privacy.link')}</a>` (or `<Link>`), and in `app/src/pages/SettingsPage.tsx` add a `<Link to="/privacy">{t('privacy.link')}</Link>` in the Account section.

- [ ] **Step 5: Typecheck + tests.** Run: `npm run typecheck --workspace app` then `npm test --workspace app`
Expected: PASS (i18n parity green; existing routing tests still pass — the LoginPage now sits under a Router, which it already tolerated in tests via MemoryRouter).

- [ ] **Step 6: Commit.**

```bash
git add app/src/pages/PrivacyPage.tsx app/src/App.tsx app/src/pages/LoginPage.tsx app/src/pages/SettingsPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: public privacy policy page"
```

---

### Task 8: Onboarding schema + me flag

**Files:**
- Create: `worker/migrations/0008_user_onboarded_at.sql`
- Modify: `worker/src/db/schema.ts`, `shared/src/user.ts`, `worker/src/routes/me.ts`, `worker/test/me.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `worker/test/me.test.ts`:

```ts
it('PATCH onboarded:true stamps onboardedAt server-side', async () => {
  await seedUser('user-ob');
  const before = await SELF.fetch('https://example.com/api/me', { headers: { Cookie: await sessionCookieFor('user-ob') } });
  expect((await before.json() as any).onboardedAt).toBeNull();

  const res = await SELF.fetch('https://example.com/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: await sessionCookieFor('user-ob') },
    body: JSON.stringify({ onboarded: true }),
  });
  expect(res.status).toBe(200);
  expect((await res.json() as any).onboardedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run to confirm failure.** Run: `npm test --workspace worker -- me`
Expected: FAIL (`onboardedAt` not present / `onboarded` rejected).

- [ ] **Step 3: Add the column + migration.** In `worker/src/db/schema.ts`, add to the `users` table definition:

```ts
  onboardedAt: integer('onboarded_at', { mode: 'timestamp' }),
```

Create `worker/migrations/0008_user_onboarded_at.sql`:

```sql
ALTER TABLE `users` ADD COLUMN `onboarded_at` integer;
```

- [ ] **Step 4: Accept the flag + map it.** In `shared/src/user.ts`, extend `updateMeSchema` to also accept the boolean flag (it must NOT be a stored timestamp from the client):

```ts
export const updateMeSchema = userPrefsSchema.partial().extend({
  onboarded: z.boolean().optional(),
});
```

In `worker/src/routes/me.ts`, in the PATCH handler, separate the `onboarded` flag from the stored prefs and map it to a timestamp:

```ts
      const { onboarded, ...prefs } = c.req.valid('json');
      const db = getDb(c.env.DB);
      const patch: Record<string, unknown> = { ...prefs };
      if (onboarded) patch.onboardedAt = new Date();
      if (Object.keys(patch).length > 0) {
        await db.update(schema.users).set(patch).where(eq(schema.users.id, c.get('userId')));
      }
```

(`toMe` already returns all non-stripped columns, so `onboardedAt` flows to the client automatically. Confirm `toMe` does not strip it.)

- [ ] **Step 5: Apply migration locally + run tests.** Run: `npx wrangler d1 migrations apply bodyatlas --local --config worker/wrangler.jsonc --persist-to app/.wrangler/state` then `npm test --workspace worker -- me`
Expected: migration applies; tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add worker/migrations/0008_user_onboarded_at.sql worker/src/db/schema.ts shared/src/user.ts worker/src/routes/me.ts worker/test/me.test.ts
git commit -m "feat: users.onboardedAt + onboarded flag on PATCH /me"
```

---

### Task 9: Onboarding wizard + first-run gating

**Files:**
- Create: `app/src/components/OnboardingWizard.tsx`
- Modify: `app/src/App.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Test: `app/src/components/OnboardingWizard.test.tsx`

- [ ] **Step 1: Write a failing test.** Create `app/src/components/OnboardingWizard.test.tsx` — render the wizard, click through, assert the final "Finish" calls the me-update with `onboarded: true`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { OnboardingWizard } from './OnboardingWizard';
import { api } from '../lib/api';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider locale="en">{ui}</I18nProvider></QueryClientProvider>);
}

describe('OnboardingWizard', () => {
  afterEach(() => vi.restoreAllMocks());
  it('finishing stamps onboarded:true via PATCH /me', async () => {
    const patch = vi.spyOn(api.me, '$patch').mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    const me = { id: 'u', email: 'a@b.c', name: 'A', locale: 'en', theme: 'gym-dark', unit: 'kg', timezone: 'UTC', onboardedAt: null, targetKcal: null, targetProteinG: null, targetFatG: null, targetCarbsG: null };
    wrap(<OnboardingWizard me={me as any} />);
    // Advance through steps to Finish.
    const next = () => userEvent.click(screen.getByRole('button', { name: /next|finish|start/i }));
    await next(); await next(); await next(); await next();
    expect(patch).toHaveBeenCalled();
    const arg = patch.mock.calls.at(-1)?.[0] as any;
    expect(arg.json.onboarded).toBe(true);
  });
});
```

> NOTE: adapt the number of `next()` clicks and the button name regex to the wizard you build. The assertion that matters: the final action calls `api.me.$patch` with `json.onboarded === true`. If `vi.spyOn(api.me, '$patch')` fails because the Hono client is a Proxy (as seen elsewhere in this codebase), mock `globalThis.fetch` instead and assert the PATCH body contains `"onboarded":true`.

- [ ] **Step 2: Run to confirm failure.** Run: `npm test --workspace app -- OnboardingWizard`
Expected: FAIL (`OnboardingWizard` not defined).

- [ ] **Step 3: Implement the wizard.** Create `app/src/components/OnboardingWizard.tsx` — a small multi-step component (welcome → preferences → targets → timezone → finish) using the existing me-update hook (`useUpdateMe` from `app/src/lib/useMe.ts`; read it for the exact hook name/signature). On Finish (and on a "Skip" link), call the update mutation with the chosen prefs plus `onboarded: true`. Keep each step minimal; prefill from the passed `me`. Steps use local state; only the final mutation persists.

```tsx
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useUpdateMe } from '../lib/useMe'; // confirm the exact export name
import type { Me } from '../lib/useMe';     // confirm the exact type name

export function OnboardingWizard({ me }: { me: Me }) {
  const { t } = useI18n();
  const update = useUpdateMe();
  const [step, setStep] = useState(0);
  const [targetKcal, setTargetKcal] = useState(me.targetKcal != null ? String(me.targetKcal) : '');

  const finish = (extra: Record<string, unknown> = {}) =>
    update.mutate({ onboarded: true, ...extra }, { onSuccess: () => { /* App re-renders when me.onboardedAt updates */ } });

  // Render the current step with Next/Skip/Finish buttons. On the final step call finish(prefs).
  // Minimal example skeleton — flesh out the 4 steps with the prefilled inputs:
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: 24 }}>
      {/* step content by `step` */}
      <button onClick={() => (step < 3 ? setStep(step + 1) : finish({ targetKcal: targetKcal ? Number(targetKcal) : null }))}>
        {step < 3 ? t('onboarding.next') : t('onboarding.finish')}
      </button>
      <button onClick={() => finish()}>{t('onboarding.skip')}</button>
    </main>
  );
}
```

Read `useMe.ts` first to use the real hook + type names and the real me fields.

- [ ] **Step 4: Gate first-run in App.tsx.** In `app/src/App.tsx`, in the authed branch from Task 7, render the wizard when `me.onboardedAt == null`, else the normal `AppLayout` tree:

```tsx
) : me.onboardedAt == null ? (
  <Route path="*" element={<OnboardingWizard me={me} />} />
) : (
  <Route element={<AppLayout />}>{/* ...routes... */}</Route>
)
```

- [ ] **Step 5: i18n.** Add `onboarding.*` keys to EN + JA (parity): `welcome`, `welcomeBody`, `prefsTitle`, `targetsTitle`, `timezoneTitle`, `next`, `finish`, `skip`. Keep key sets identical.

- [ ] **Step 6: Run tests.** Run: `npm test --workspace app` and `npm run typecheck --workspace app`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add app/src/components/OnboardingWizard.tsx app/src/components/OnboardingWizard.test.tsx app/src/App.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: first-run onboarding wizard gated on onboardedAt"
```

---

### Task 10: Empty-state hints

**Files:**
- Modify: `app/src/pages/TodayPage.tsx`, `app/src/pages/TrainPage.tsx`, `app/src/pages/HealthPage.tsx`, `app/src/pages/TrendsPage.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`

- [ ] **Step 1: Survey existing empty states.** Read each page; several already render partial empty states (e.g. HealthPage "No sleep logged."). The goal is a consistent first-run hint when the page has NO data for a new user — do not duplicate existing ones, standardize them.

- [ ] **Step 2: Add i18n hint strings.** EN + JA (parity): `empty.today` ('Log your first workout or meal to see your day take shape.' / JA), `empty.train` ('Start your first workout from a template or scratch.' / JA), `empty.health` ('Log a meal, sleep, or body measurement to get started.' / JA), `empty.trends` ('Trends appear once you have a few days of data.' / JA).

- [ ] **Step 3: Render the hint when empty.** In each page, when its primary queries return no rows (and not loading), show the hint text in a muted callout above/instead of the bare empty list. Example for TrendsPage:

```tsx
import { useI18n } from '../i18n';
// when all series are empty:
{hasNoData && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('empty.trends')}</p>}
```

Apply the analogous minimal change to Today/Train/Health using each page's existing "no data" condition. Keep it to one hint per page; reuse existing empty-state markup where present.

- [ ] **Step 4: Run tests.** Run: `npm test --workspace app` and `npm run typecheck --workspace app`
Expected: PASS (existing page tests still green; i18n parity green).

- [ ] **Step 5: Commit.**

```bash
git add app/src/pages/TodayPage.tsx app/src/pages/TrainPage.tsx app/src/pages/HealthPage.tsx app/src/pages/TrendsPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: first-run empty-state hints on primary tabs"
```

---

### Task 11: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck.** Run: `npm run typecheck` → PASS across shared/worker/app.
- [ ] **Step 2: Full suite.** Run: `npm test` → PASS (shared, worker incl. account + rate-limit + me, app incl. onboarding).
- [ ] **Step 3: Build.** Run: `npm run build` → clean.
- [ ] **Step 4: Wrangler config check.** Run: `npx wrangler deploy --dry-run --config worker/wrangler.jsonc` → validates the `ratelimit` bindings (no deploy).
- [ ] **Step 5: Finish the branch** with superpowers:finishing-a-development-branch. Deployment additionally requires applying migration 0008 to remote D1 (`wrangler d1 migrations apply bodyatlas --remote`) before `npm run deploy` — note this for the user; do not run it without explicit approval.

## Plan self-review (authoring time)

- **Spec coverage:** Data export → Tasks 1–2 (excludes `tokenHash`/`encryptedKey`/`keyIv`/`googleSub`, scoped per user). Account deletion → Tasks 3–4 (FK-safe explicit order, session revocation, typed-confirm UI). Rate limiting → Tasks 5–6 (`RL_API`/`RL_AI`/`RL_AUTH`/`RL_MCP`, per-route key derivation, 429 + Retry-After, fail-open, fake-limiter tests, wrangler bindings). Privacy policy → Task 7 (public `/privacy` route via App.tsx restructure, EN/JA, login+settings links). Onboarding → Tasks 8–9 (migration 0008, `onboarded` flag mapped server-side, wizard gated on `onboardedAt`, skippable) + Task 10 (empty states). Every spec section maps to a task.
- **Placeholder scan:** No "TBD"/"add error handling" placeholders; each code step shows real code. Two explicit verify-points (the wrangler `ratelimit` config key in Task 6 Step 3, and the `api.me.$patch` spy vs fetch-mock in Task 9 Step 1) name exactly what to confirm and the fallback — not hand-waving.
- **Type consistency:** `RateLimiter` interface (Task 5) is used unchanged in Tasks 5–6. `accountRoutes` (Task 1) is extended in Task 3 and mounted in Task 1/6. `updateMeSchema.onboarded` (Task 8) is consumed by the wizard (Task 9). `downloadExport`/`deleteAccount` (Tasks 2/4) live in the same `app/src/lib/account.ts`. The `onboardedAt` field name matches across schema (Task 8), me projection, and App gating (Task 9).
- **YAGNI:** No soft-delete, no per-user session index, no emailed receipts, no full feature tour — all deferred per the spec's out-of-scope list.
```
