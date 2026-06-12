# BodyAtlas MCP Setup

BodyAtlas exposes a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) endpoint at `/mcp`.
Any MCP client — Claude Code, claude.ai, or a custom agent — can connect to read and write your health data.

---

## 1. Create an API token

1. Open BodyAtlas and go to **Settings → API Tokens**.
2. Click **New token**, give it a name (e.g. `claude-code`), and confirm.
3. Copy the token that appears — it starts with `ba_` and is shown **only once**.
   Store it somewhere safe (e.g. your password manager).

To revoke access at any time, return to **Settings → API Tokens** and delete the token.

> **Security note:** Each token grants full read/write access to your entire account
> (all meals, workouts, measurements, and sleep records). Treat it like a password.

---

## 2. Connect Claude Code (CLI)

Run this once — Claude Code remembers the server across sessions:

```sh
claude mcp add --transport http bodyatlas https://bodyatlas.okdtsk.dev/mcp \
  --header "Authorization: Bearer ba_YOUR_TOKEN_HERE"
```

Replace `ba_YOUR_TOKEN_HERE` with the token you copied in step 1.

Verify the connection:

```sh
claude mcp list
# bodyatlas  https://bodyatlas.okdtsk.dev/mcp  (http)
```

---

## 3. Connect claude.ai (custom connector)

1. In claude.ai, open **Settings → Integrations → Custom connectors**.
2. Add a new connector:
   - **URL:** `https://bodyatlas.okdtsk.dev/mcp`
   - **Authentication:** Bearer token — paste your `ba_…` token.
3. Save. Claude will discover the tools automatically.

---

## 4. Available tools

| Tool | Description |
|------|-------------|
| `log_meal` | Log a meal with optional timestamp, calories, protein, fat, and carbs. |
| `log_workout` | Log a completed workout with exercises and sets (weight, reps, RPE, duration). |
| `log_weight` | Log a body measurement: weight (kg) and/or body-fat percentage. |
| `log_sleep` | Log a sleep record with bed time, wake time, and optional quality rating. |
| `get_recent_workouts` | Retrieve the most recent workout summaries, newest first (up to 20). |
| `get_trends` | Get trend data: strength progression, volume, nutrition vs. body, or sleep. |
| `get_today` | Get today's nutrition totals vs. targets, workout status, last sleep, and latest weight. |

---

## 5. Example prompts

Once connected you can ask Claude things like:

- *"Log that I ate oatmeal for breakfast — 350 kcal, 12 g protein."*
- *"Show me my bench press progress over the last 3 months."*
- *"Log my workout: 3 sets of 80 kg × 5 bench press at RPE 8."*
- *"How did I sleep last night? What are my nutrition totals today?"*

---

## 6. Local development

When running `npm run dev` the MCP endpoint is available at `http://localhost:5173/mcp`
(port may shift to `5174` if 5173 is occupied — check the Vite startup output).

Use `E2E_TEST_LOGIN=1` in `worker/.dev.vars` and hit `GET /auth/test-login` to establish
a session, then `POST /api/tokens` to create a local token for testing.
