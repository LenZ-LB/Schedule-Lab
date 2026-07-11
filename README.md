# Schedule Lab — Edmonton Oilers

Situational schedule analytics: rest, travel, game states, and results, updated
automatically from the NHL API and rendered as a static GitHub Pages site.

Three seasons of hand-built spreadsheet tracking (2023-24 → 2025-26) are imported
as historical data; from 2026-27 onward the pipeline fills everything derivable
on its own.

## How it works

```
NHL API (api-web.nhle.com)          data/manual_flags/<season>.json
        │                                     │  (MDO, skates, arrivals — hand-entered)
        ▼                                     ▼
scripts/update_data.py  ──────────────────────┤
        │                                     │
        ▼                                     │
docs/data/<season>.json  ◄────────merged──────┘
        │
        ▼
docs/index.html  (GitHub Pages — no build step, vanilla JS)
```

A GitHub Action runs nightly during the season (and on demand) and commits the
refreshed JSON. The site reads the JSON directly — no server, no build.

## Setup

1. Push this repo to GitHub.
2. Settings → Pages → Deploy from branch → `main` / `docs/`.
3. Settings → Actions → General → Workflow permissions → "Read and write
   permissions" (the workflow commits data updates).
4. Done. The workflow runs nightly Oct–Apr, or trigger it from the Actions tab.

### Run the updater by hand

```bash
pip install -r requirements.txt
python scripts/update_data.py              # season from config.json
python scripts/update_data.py 20262027     # explicit season
python scripts/update_data.py 20262027 --team EDM
```

Then preview the site locally:

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
| Venue timezone, TZ change vs previous game | computed (team → tz map) |
| Moon phase (incl. traditional full-moon names) | computed (ephem, Edmonton local dates) |
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
  shows the regulation/OT tie score (e.g. `SOL 3–3`).
- **Records** are shown W-L-OTL(+SOL); OTW/SOW count as wins for points.
- **Rest days** = full days between games (0 = back-to-back).
- **3-in-4** = third game within any 4-night window.
- **TZ change** = venue timezone minus previous game's venue timezone, in hours.
- **Moon phase** uses the astronomical event's Edmonton-local calendar date;
  principal phases (new/full/quarters) only on the exact event day. Note: this
  is computed precisely, so it may differ by a day from older hand-entered rows.

## Repo layout

```
config.json                     team + current season
scripts/update_data.py          NHL API → season JSON (the whole pipeline)
scripts/convert_xlsx.py         one-time importer for the original workbooks
data/manual_flags/              hand-entered team-ops flags per season
docs/                           the site (GitHub Pages root)
docs/data/                      one JSON per season + index.json
.github/workflows/update-data.yml   nightly + manual automation
```

## Extending to other teams

Everything is keyed off `config.json` (`team`, tri-code) and the team maps in
`scripts/update_data.py` — point it at any club and the automated fields all
work. Manual-ops flags are per-team by nature.

## Known quirk found during import

The 2025-26 workbook's "1 Day Off" indicator for Game 27 (Dec 2 vs MIN, L)
disagrees with its own "Off Days Btwn" column (which correctly says 2 days).
The imported data follows the raw rest-days column, so the site's rest buckets
differ from the workbook's Reporting tab by one loss: 1-day-off is 28-17-3 and
2-days-off is 8-6-2 here.
