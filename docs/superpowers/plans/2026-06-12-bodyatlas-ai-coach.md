# BodyAtlas AI Coach Implementation Plan (Phase 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BYO-key AI features per the spec's Phase 2: encrypted per-user AI provider settings (Claude / OpenAI / Gemini), meal-nutrition estimation from a text description (✨ button in the meal form), and an on-demand weekly coach review over the last 4 weeks of training/nutrition/sleep data (card at the top of Trends).

**Architecture:** API keys are encrypted at rest with AES-256-GCM (WebCrypto) using a Worker secret `AI_KEY_SECRET` (32-byte base64) — never returned to any client, never logged. A thin provider adapter (`worker/src/lib/llm.ts`, raw `fetch` — uniform across three providers; user-supplied keys make per-provider SDKs poor fits) exposes one `complete()` call. AI endpoints live under the authed `/api/ai/*`. All AI outputs are advisory text/JSON parsed defensively — a provider failure returns a 502 `ai_error` envelope, never a crash.

**Provider request shapes (validated against current docs via the claude-api skill):**
- Claude: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`; body `{ model, max_tokens, system, messages: [{role:'user', content}] }`; response text = concat of `content[].text` where `type==='text'`; treat empty content or `stop_reason==='refusal'` as an error. Default model `claude-opus-4-8` (per current model catalog; user-editable — do not downgrade silently).
- OpenAI: `POST https://api.openai.com/v1/chat/completions`, `Authorization: Bearer`; body `{ model, max_completion_tokens, messages: [{role:'system'},{role:'user'}] }`; text = `choices[0].message.content`. No default model — free-text field (placeholder "e.g. gpt-…"), required when provider selected.
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`; body `{ systemInstruction: {parts:[{text}]}, contents: [{role:'user', parts:[{text}]}], generationConfig: { maxOutputTokens } }`; text = concat `candidates[0].content.parts[].text`. No default model (placeholder "e.g. gemini-…").

**Conventions:** all established (TDD, envelopes, ProtectedEnv chain, InferResponseType hooks, i18n parity). Tests at start: 23 shared / 104 worker / 62 app + 3 e2e.

## Domain decisions

- **One AI config per user** (`ai_settings`, user_id pk): provider, model, encrypted key + IV, last_review text + timestamp. PUT replaces; apiKey optional on PUT when a key already exists (keep stored key; provider/model still updatable). DELETE wipes the row.
- **GET /api/ai/settings** → `{ provider, model, hasKey: boolean, lastReviewAt }` — never key material, not even masked.
- **POST /api/ai/test** → runs `complete()` with a trivial prompt ("Reply with exactly: ok"), returns `{ ok: true }` or 502 `{ error: { code: 'ai_error', message: <provider message, truncated 300 chars, never echoing the key> } }`.
- **POST /api/ai/estimate-meal** `{ description: 1..300 chars }` → strict-JSON prompt (system instructs: minified JSON only, fields calories int, proteinG/fatG/carbsG numbers (g), confidence low|medium|high, note ≤100 chars, no code fences) → defensive parse (strip ``` fences if present → JSON.parse → zod validate `estimateResultSchema`) → 200 with the parsed object; parse failure → 502 ai_error. maxTokens 400.
- **POST /api/ai/coach-review** `{}` → server gathers a compact 28-day summary (JS object → JSON in the prompt): workouts count, weekly set volume by muscle group, top-3 most-trained exercises with first→last est1RM from `strengthSeries`, daily kcal/protein averages vs targets, sleep avg duration + quality. Prompt: friendly evidence-based coach; respond in the user's locale (`users.locale` — Japanese when `ja`); sections: wins / focus areas / suggestions for next week; ≤300 words; plain text with simple headings. maxTokens 1500. Result stored in `ai_settings.last_review` (+`last_review_at`) and returned — the Trends card shows the stored review on load and regenerates on demand.
- **UI placement:** Settings gains an "AI coach" section (provider select, model input, key password-input, save, test button with ok/error feedback, disconnect). MealFormSheet shows a ✨ estimate button (only when `hasKey`) next to the name field — fills kcal/P/F/C (still editable) using name + notes as the description. TrendsPage gains a Coach `glow-card` at the top (only when `hasKey`): stored review text (pre-line), generated-at timestamp, "Generate weekly review" button with a loading state (these calls take seconds).
- **Never log prompts or responses containing user data at error level beyond status codes; never log keys anywhere.**

## File structure (new/changed)

```
worker/migrations/0006_ai_settings.sql
worker/src/db/schema.ts             # + aiSettings
worker/src/lib/crypto.ts            # AES-256-GCM encrypt/decrypt (WebCrypto)
worker/src/lib/llm.ts               # complete() — three providers, raw fetch
worker/src/routes/ai.ts             # settings CRUD + test + estimate-meal + coach-review
worker/src/index.ts                 # mount /ai; Bindings + AI_KEY_SECRET
worker/test/{crypto,llm,ai}.test.ts
shared/src/ai.ts                    # provider enum, aiSettingsInputSchema, estimate schemas
shared/src/ai.test.ts
app/src/lib/ai.ts                   # hooks
app/src/pages/SettingsPage.tsx      # AI section
app/src/components/MealFormSheet.tsx# ✨ estimate
app/src/pages/TrendsPage.tsx        # coach card
docs/mcp-setup.md untouched; .dev.vars += AI_KEY_SECRET (local)
```

---

### Task 1: Crypto + schema + shared schemas

- [ ] **Shared** (`shared/src/ai.ts` + tests): `AI_PROVIDERS = ['claude','openai','gemini'] as const` + type; `aiSettingsInputSchema = z.object({ provider: z.enum(AI_PROVIDERS), model: z.string().trim().min(1).max(80), apiKey: z.string().trim().min(8).max(200).optional() })`; `estimateMealInputSchema = z.object({ description: z.string().trim().min(1).max(300) })`; `estimateResultSchema = z.object({ calories: z.number().int().min(0).max(10000), proteinG: z.number().min(0).max(1000), fatG: z.number().min(0).max(1000), carbsG: z.number().min(0).max(1000), confidence: z.enum(['low','medium','high']), note: z.string().max(150).optional() })` + inferred types; export from index. Tests: valid/invalid rounds (bad provider, short key, estimate bounds).
- [ ] **Schema:** `aiSettings` table — `userId` text pk ref users, `provider` text `$type<AiProvider>` notNull, `model` text notNull, `encryptedKey` text notNull, `keyIv` text notNull, `lastReview` text, `lastReviewAt` timestamp, `updatedAt` timestamp notNull defaultFn now. Migration `ai_settings` (additive). reset-db: add `ai_settings` before `users`.
- [ ] **Crypto** (`worker/src/lib/crypto.ts`, TDD):

```ts
function b64ToBytes(b64: string): Uint8Array { /* atob → Uint8Array */ }
function bytesToB64(bytes: Uint8Array): string { /* btoa(String.fromCharCode(...)) */ }

async function importKey(secretB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(secretB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plain: string, secretB64: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(secretB64);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { ciphertext: bytesToB64(new Uint8Array(ct)), iv: bytesToB64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string, secretB64: string): Promise<string> {
  const key = await importKey(secretB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(iv) }, key, b64ToBytes(ciphertext));
  return new TextDecoder().decode(plain);
}
```

Tests (worker/test/crypto.test.ts): round-trip; distinct IVs per call; tampered ciphertext throws; wrong key throws. Test secret: any fixed 32-byte base64 (e.g. `btoa` of 32 'a's) — also add `AI_KEY_SECRET` to the vitest miniflare bindings and `Bindings` type (`AI_KEY_SECRET: string`), and append a real generated value to `worker/.dev.vars` (`openssl rand -base64 32`).
- [ ] Gate (root tests + typecheck) + commit `feat: add encrypted ai settings storage primitives`

### Task 2: LLM adapter + /api/ai settings routes

- [ ] **Adapter** (`worker/src/lib/llm.ts`, TDD with `vi.spyOn(globalThis, 'fetch')` per the established auth-test pattern):

```ts
export class AiError extends Error {}
export async function complete(opts: {
  provider: AiProvider; model: string; apiKey: string;
  system: string; prompt: string; maxTokens: number;
}): Promise<string>
```

Per-provider request/response per the shapes in the header of this plan. Non-OK responses: read body text, truncate 300 chars, strip anything resembling the key, throw `AiError('provider <p> returned <status>: <body>')`. Empty text → AiError. 60s timeout via `AbortSignal.timeout(60_000)`.
Tests: one happy-path per provider asserting URL/headers/body shape (Claude: x-api-key + anthropic-version headers, system + single user message; OpenAI: bearer + max_completion_tokens; Gemini: x-goog-api-key + systemInstruction) and text extraction; one non-OK → AiError without key leakage (assert error message does NOT contain the key).
- [ ] **Routes** (`worker/src/routes/ai.ts`, mounted `.route('/ai', aiRoutes)` after `/tokens`): GET /settings (row → {provider, model, hasKey: true, lastReviewAt} or `{ provider: null, hasKey: false }`); PUT /settings (validate aiSettingsInputSchema; apiKey present → encrypt+store; absent → require existing row else 422; upsert with updatedAt); DELETE /settings; POST /test (load+decrypt key → complete(trivial) → {ok:true} / 502 ai_error). Tests: settings CRUD round-trip (hasKey true, key never in any response — assert deep), PUT without key on empty → 422, test endpoint happy (mock fetch) + provider-down 502.
- [ ] Gate + commit `feat: add ai provider adapter and settings api`

### Task 3: estimate-meal + coach-review endpoints

- [ ] **estimate-meal**: prompt per Domain decisions; parse helper `parseStrictJson(text)` (trim; strip leading/trailing ``` fences with optional language tag; JSON.parse; return unknown) → `estimateResultSchema.safeParse` → 200 data / 502 `{error:{code:'ai_parse_error',…}}`. Tests: happy path (mock fetch returning Claude-shaped response with the JSON), fenced-JSON tolerance, garbage → 502, no AI settings → 409 `{error:{code:'ai_not_configured'}}`.
- [ ] **coach-review**: summary builder `buildCoachSummary(db, userId): Promise<object>` in `worker/src/lib/coach.ts` — 28-day window (UTC now−28d): workouts count; per-muscle set totals (volume-style join); top-3 exercises by set count with `strengthSeries` first/last est1rm; meal daily averages (kcal, proteinG — sum/28) + targets from users; sleep avg durationMin + avg quality. Unit-test the builder against seeded data (counts/averages exact). Endpoint: load settings (409 if none) → build summary → complete() with the locale-aware coach prompt → store lastReview/lastReviewAt → return `{ review, generatedAt }`. Tests: happy path persists + returns; provider failure → 502 and does NOT overwrite a previously stored review.
- [ ] Gate + commit `feat: add meal estimation and coach review endpoints`

### Task 4: App UI — settings section, ✨ estimate, coach card

- [ ] **i18n** (both catalogs): `ai.title` 'AI coach'/'AIコーチ', `ai.provider` 'Provider'/'プロバイダー', `ai.model` 'Model'/'モデル', `ai.apiKey` 'API key'/'APIキー', `ai.apiKeyHint` 'Stored encrypted. Leave blank to keep the current key.'/'暗号化して保存されます。空欄で現在のキーを保持。', `ai.save` 'Save'/'保存', `ai.test` 'Test connection'/'接続テスト', `ai.testOk` 'Connection OK'/'接続OK', `ai.disconnect` 'Disconnect'/'連携解除', `ai.estimate` 'Estimate nutrition'/'栄養を推定', `ai.estimating` 'Estimating…'/'推定中…', `ai.confidence.low` 'Low confidence'/'信頼度: 低', `.medium` 'Medium confidence'/'信頼度: 中', `.high` 'High confidence'/'信頼度: 高', `ai.review` 'Weekly review'/'週間レビュー', `ai.generate` 'Generate weekly review'/'週間レビューを生成', `ai.generating` 'Generating…'/'生成中…', `ai.noReview` 'No review yet — generate your first one!'/'まだレビューがありません — 最初のレビューを生成しましょう！', `ai.notConfigured` 'Configure the AI coach in Settings to enable this.'/'設定でAIコーチを連携すると利用できます。', `ai.error` 'The AI request failed. Check your settings.'/'AIリクエストが失敗しました。設定を確認してください。'
- [ ] **Hooks** (`app/src/lib/ai.ts`): useAiSettings (key ['ai-settings']), useSaveAiSettings, useDeleteAiSettings, useTestAi, useEstimateMeal, useCoachReview (invalidates ['ai-settings'] for lastReviewAt) — InferResponseType throughout; estimate/coach are POSTs via RPC (verify param shapes compile; raw-fetch fallback per precedent).
- [ ] **SettingsPage**: AI section under tokens — provider select (3 options), model input (defaultValue per provider: claude → 'claude-opus-4-8', others empty with placeholder), password-type key input + hint, save (disabled until provider+model and, when hasKey false, key), test button (renders ai.testOk green / ai.error red), disconnect with confirm. Test: save flow PUTs {provider, model, apiKey}.
- [ ] **MealFormSheet**: when `useAiSettings().data?.hasKey`, render ✨ `ai.estimate` button beside the name field (create AND edit); onClick → useEstimateMeal with `${name} ${notes}`.trim(); on success fill kcal (rounded int)/P/F/C input STATES (user-editable after) + show confidence chip via muted text; pending state label ai.estimating; error → error-text ai.error. Test: mock estimate response fills the kcal field.
- [ ] **TrendsPage**: Coach glow-card ABOVE the range chips: when not configured → muted ai.notConfigured (link to /settings); else stored review (`white-space: pre-line`) or ai.noReview, generate button (pending → ai.generating, disabled), error state. Review text comes from useCoachReview result + the GET settings lastReviewAt; simplest: coach-review GET? No — store review text server-side but GET /settings deliberately omits it… ADD `GET /api/ai/review` → `{ review, generatedAt } | null` (worker Task 3 — include it there with a test). Test: configured + stored review renders; generate button POSTs.
- [ ] Full root gate + commit `feat: add ai coach ui`

### Task 5: Deploy

- [ ] `npx wrangler d1 migrations apply bodyatlas --remote --config worker/wrangler.jsonc` (0006).
- [ ] `openssl rand -base64 32 | npx wrangler secret put AI_KEY_SECRET --name bodyatlas` then `npm run deploy`.
- [ ] User smoke: configure Claude provider with a real key in Settings → test connection → ✨ estimate「カツ丼 並盛り」→ generate a weekly review (JA locale → JA review).
- [ ] CLAUDE.md status + commit `docs: ai coach shipped`.

## Plan self-review (authoring time)

- Spec Phase-2 AI coach scope: BYO key 3 providers ✓ encrypted at rest ✓; feature 1 meal estimation ✓; feature 2 weekly review over trends data ✓ (on-demand; cron later if wanted). Claude request shape + model id validated against the claude-api skill (raw HTTP justified: uniform 3-provider adapter with user-supplied keys in a Worker).
- Key safety: AES-GCM w/ Worker secret; key never in responses/logs/error messages (tested); test endpoint never echoes provider body containing the key.
- Defensive boundaries: AiError → 502 envelopes; parse failures distinct code; coach failure preserves prior review (tested).
- Risk: provider API drift for OpenAI/Gemini (no default models shipped — user supplies; adapter errors surface provider messages).
