# Schedule Lab API — setup

This is what turns "update the schedule" from "run a script, commit a file,
push" into "run a script" — full stop. Data lives in Postgres on Fly.io;
git is only for code changes from here on.

Everything below needs to be run by you, since I don't have access to your
Fly.io account. I've tested everything that doesn't require a live
database connection (request validation against your actual 84-game
dataset, auth/scope enforcement, the upsert query logic) — see the test
commands throughout this session's history if you want to re-run them
yourself with `pip install fastapi httpx` locally.

## 1. Create the Postgres database

```
fly postgres create --name schedule-lab-db
```

Note the connection string it prints — you'll need it in step 3.

## 2. Apply the schema

From your local machine, with `psql` pointed at the connection string:

```
psql "<connection string>" -f api/migrations/001_init.sql
```

## 3. Deploy the API

```
cd api
fly launch --no-deploy   # creates fly.toml, review it, keep the app name
fly postgres attach schedule-lab-db   # wires DATABASE_URL as a secret automatically
fly secrets set ALLOWED_ORIGIN=https://lenz-lb.github.io
fly deploy
```

Confirm it's alive:

```
curl https://<your-app>.fly.dev/health
# {"status":"ok"}
```

## 4. Generate API keys

```
python scripts/make_key.py admin "GitHub Action pipeline"
python scripts/make_key.py editor "Game editor browser key"
```

Each prints a raw key (copy it immediately, it's not shown again) and an
`INSERT` statement — run that against your Postgres via `psql` to register
the key's hash. The raw key itself is never stored anywhere in the database.

## 5. Backfill existing data

For each season you want to migrate:

```
DATABASE_URL="<connection string>" python scripts/backfill.py 20262027
```

Use `--dry-run` first if you want to sanity-check the counts before writing.

## 6. Point the pipeline at the API

Add two GitHub Actions secrets (Settings → Secrets → Actions):
- `SCHEDULE_API_URL` — your Fly app's URL
- `SCHEDULE_API_ADMIN_KEY` — the admin key from step 4

The existing workflow (`update-data.yml`) already checks for these — once
they're set, the next scheduled run posts straight to the database instead
of writing a file. If you ever unset them, it falls back to the old
file-based behavior automatically, so there's no risk of breaking things
mid-migration.

## 7. Point the frontend at the API

In `docs/config.js`:

```js
window.SCHEDULE_API_URL = "https://<your-app>.fly.dev";
```

That's the only file that needs to change. `app.js` already checks this
value and switches from `data/<season>.json` to the live API automatically.

## What's NOT done yet

The game editor (`editor.html`) still saves manual flags (MDO, early
arrival, etc.) via the GitHub Contents API with a personal access token —
that mechanism keeps working exactly as it does today. Wiring the editor
to write to the new `manual_flags` table via the API instead (using the
editor key from step 4) is a real next step, but a separate piece of work
from what this round covers.
