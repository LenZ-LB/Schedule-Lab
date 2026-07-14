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
NHL API (api-web.nhle.com)          data/manual_flags/<season>.json
        |                                     |  (team-ops flags, hand-entered)
        v                                     v
scripts/update_data.py  ----------------------+
        |
        v
docs/data/<season>.json  ->  docs/ (GitHub Pages, no build step)
```

A GitHub Action runs nightly during the season (and on demand) and commits
refreshed JSON. The site reads the JSON directly.

## Setup

1. Push to GitHub (pick a neutral repo name).
2. Settings -> Secrets and variables -> Actions -> New repository secret:
   `TEAM_CODE` = your club's tri-code.
3. Settings -> Pages -> Deploy from branch -> `main` / `docs/`.
4. Settings -> Actions -> General -> Workflow permissions -> Read and write.

### Run the updater by hand

```bash
pip install -r requirements.txt
cp config.local.json.example config.local.json   # put your tri-code in it
python scripts/update_data.py                    # season from config.json
python scripts/update_data.py 20262027           # explicit season
TEAM_CODE=XXX python scripts/update_data.py      # or via env var
```

Preview locally:

```bash
cd docs && python -m http.server   # http://localhost:8000
```

## What's automated vs hand-entered

| Field | Source |
|---|---|
| Schedule, opponent, home/away, start time | NHL API |
| Result (W/OTW/SOW/L/OTL/SOL), GF/GA | NHL API |
| Lead after 1st/2nd, into-3rd state, won 3rd, scored first | NHL API linescore |
| Faceoff % / FO 50+ | NHL API right-rail |
| Rest days, back-to-backs, 3-in-4 | computed from schedule |
| Venue timezone, TZ change vs previous game | computed (league tz map) |
| Moon phase (incl. traditional full-moon names) | computed (ephem, club-local dates) |
| MDO, morning skate, skate, early arrival, 11F/7D, faceoff ties | `data/manual_flags/<season>.json` |

Manual flags are keyed by game date and merged on every run, so re-running the
updater never wipes hand-entered values:

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
- **TZ change** = venue timezone minus previous game's venue timezone, in hours.
- **Moon phase** uses the astronomical event's club-local calendar date;
  principal phases (new/full/quarters) only on the exact event day. Computed
  precisely, so it may differ by a day from older hand-entered rows.
- One rest-bucket flag in the imported 2025-26 season (game 27) followed the
  raw rest-days column where the source workbook's indicator disagreed with it.

## Repo layout

```
config.json                     current season only (no team identifier)
config.local.json.example       template for local team config (git-ignored)
scripts/update_data.py          NHL API -> season JSON (the whole pipeline)
data/manual_flags/              hand-entered team-ops flags per season
docs/                           the site (GitHub Pages root)
docs/data/                      one JSON per season + index.json
docs/robots.txt                 deny-all for crawlers
.github/workflows/update-data.yml   nightly + manual automation
```
