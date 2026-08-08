# Schedule Lab

Situational schedule analytics for an NHL club: rest, travel, game states, and
results — updated automatically from the NHL API and rendered as a static
GitHub Pages site. Three seasons of hand-tracked data are imported as history;
from the current season onward the pipeline fills everything derivable on its own.

## Privacy posture

This repo is deliberately keyword-anonymous:

- The club is never named in code, data, config, README, or page content.
- The team tri-code lives only in a repo **secret** (`TEAM_CODE`), which GitHub
  masks in workflow logs, or in a git-ignored `config.local.json` for local runs.
- The site ships `<meta name="robots" content="noindex, nofollow, noarchive">`
  and a deny-all `robots.txt`, so well-behaved search engines won't index it.
- Scripts never print the team code, and generated data files don't contain it.

Know the limits: none of this is access control. Anyone who reaches the URL can
infer the club from the schedule itself, and rogue crawlers ignore robots rules.
If you need actual gating, use a private repo with GitHub Pro (Pages on private
repos requires a paid plan) or put the site behind Cloudflare Access.

## How it works

```
NHL API (api-web.nhle.com)          docs/data/manual/<season>.json
        |                                     ^  (hand-entered fields)
        v                                     |
scripts/update_data.py                  docs/editor.html + editor.js
        |                                (edits here, or by hand)
        v
docs/data/<season>.json  --[merged live, in the browser]-->  docs/index.html
```

A GitHub Action runs nightly during the season (and on demand) and commits
the automated fields. Hand-entered fields live in a **separate** file and are
merged into the page **live, in your browser** — so editing them takes effect
on the next page load, with no pipeline run required.

## Setup

1. Push to GitHub (pick a neutral repo name).
2. Settings -> Secrets and variables -> Actions -> New repository secret:
   `TEAM_CODE` = your club's tri-code.
3. Settings -> Pages -> Deploy from branch -> `main` / `docs/`.
4. Settings -> Actions -> General -> Workflow permissions -> Read and write.

### Entering game info (MDO, skates, special teams, etc.)

Open `editor.html` on the live site (linked from the top of the main page).
Pick a season and game, fill in the form, and save. Two ways to save:

- **Connected** (recommended): ⚙ Connection settings -> enter your GitHub
  username, this repo's name, and a
  [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
  scoped to just this repo with **Contents: Read and write**. The token is
  stored only in your browser (`localStorage`) and talks directly to
  `api.github.com` — it never goes anywhere else. Saving commits straight to
  the repo; refresh the site and it's there.
- **Not connected**: fill the form and hit Download — it saves a corrected
  `docs/data/manual/<season>.json` you replace and push yourself, same as
  editing the file by hand, just with a form instead of raw JSON.

The editor works before the season starts too (enter things game-by-game as
they're decided) and after (fill in what happened post-game).

### Run the schedule updater by hand

```bash
pip install -r requirements.txt
cp config.local.json.example config.local.json   # put your tri-code in it
python scripts/update_data.py                    # season from config.json
python scripts/update_data.py 20262027           # explicit season
TEAM_CODE=XXX python scripts/update_data.py      # or via env var
```

This only touches the automated fields (`docs/data/<season>.json`) — it never
touches `docs/data/manual/`, so it's always safe to re-run.

Preview locally:

```bash
cd docs && python -m http.server   # http://localhost:8000
```

## What's automated vs hand-entered

| Field | Source |
|---|---|
| Schedule, opponent, home/away, start time | NHL API, converted to the club's home timezone via the real IANA timezone database (handles daylight saving automatically, every season, with no code changes needed even if DST rules change) |
| Result (W/OTW/SOW/L/OTL/SOL), GF/GA | NHL API |
| Lead after 1st/2nd, won 3rd, scored first | NHL API linescore |
| Faceoff % / FO 50+ | NHL API right-rail |
| Rest days, back-to-backs, 3-in-4 | computed from schedule |
| Venue timezone, TZ change vs previous game | computed (real per-date UTC offsets, DST-aware) |
| Moon phase (incl. traditional full-moon names) | computed (ephem, club-local dates) |
| MDO, morning skate, day-before skate, early arrival, 11F/7D, special teams (Win ST/Tie ST), contested (50/50) faceoffs | **hand-entered** via `docs/editor.html` → `docs/data/manual/<season>.json` |

Special teams moved to hand-entered: the API's goal-strength tagging doesn't
reliably match how special-teams goals are called by eye (delayed penalties,
4-on-3, etc.), so rather than guess, it's a form field now.

Hand-entered fields are keyed by game date and merge into the page at load
time, so editing them never requires re-running the schedule pipeline:

```json
{
  "2026-10-07": { "mdo": false, "morningSkate": true, "notes": "optional" }
}
```

## Data conventions (carried over from the original workbooks)

- **Shootout games:** the SO-deciding goal is excluded from GF/GA, so an SOL
  shows the regulation/OT tie score (e.g. `SOL 3-3`).
- **Records** are shown W-L-OTL(+SOL); OTW/SOW count as wins for points.
- **Rest days** = full days between games (0 = back-to-back).
- **3-in-4** = third game within any 4-night window.
- **TZ change** = venue's UTC offset minus previous game's venue offset, in
  real hours for that specific date (correctly handles DST transition weeks).
- **Moon phase** uses the astronomical event's club-local calendar date;
  principal phases (new/full/quarters) only on the exact event day. Computed
  precisely, so it may differ by a day from older hand-entered rows.
- One rest-bucket flag in the imported 2025-26 season (game 27) followed the
  raw rest-days column where the source workbook's indicator disagreed with it.

## Repo layout

```
config.json                     current season only (no team identifier)
config.local.json.example       template for local team config (git-ignored)
scripts/update_data.py          NHL API -> automated season JSON
scripts/convert_xlsx.py         one-time importer for the original workbooks
docs/                            the site (GitHub Pages root)
docs/index.html, app.js          main dashboard
docs/editor.html, editor.js      hand-entry form + GitHub save
docs/shared.js                   manual-field list + merge logic (used by both pages)
docs/data/<season>.json          automated fields, written by update_data.py
docs/data/manual/<season>.json   hand-entered fields, written by the editor
docs/data/index.json             season list for the dropdown
docs/robots.txt                  deny-all for crawlers
.github/workflows/update-data.yml   nightly + manual automation
```

