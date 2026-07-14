#!/usr/bin/env python3
"""
One-time importer: converts the original Schedule_Data_*.xlsx workbooks
into the site's JSON schema (docs/data/<seasonId>.json).

Field names match the workbook's real meaning:
  Win ST / Tie ST  -> specialTeamsWin / specialTeamsTie  (PP/PK goal battle)
  Ties?            -> contestedFoWin  (won more of the 50/50 draws)
  Skate?           -> dayBeforeSkate
  1G/2G/3+G Diff   -> margin bucket
Usage:
    python scripts/convert_xlsx.py <file.xlsx> <seasonId> <outdir>
"""
import json
import sys
from datetime import datetime, time

import openpyxl

TEAMS = {
    "ANA","ARI","BOS","BUF","CGY","CAR","CHI","COL","CBJ","DAL","DET","EDM","FLA",
    "LAK","MIN","MTL","NSH","NJD","NYI","NYR","OTT","PHI","PIT","SJS","SEA","STL",
    "TBL","TOR","UTA","UTM","VAN","VGK","WSH","WPG",
}

def norm_opponent(v):
    if v is None:
        return None
    s = str(v).strip().upper()
    return "MTL" if s == "MTL2" else s

def flag(v):
    if v in (1, "1", True):
        return True
    if v in (0, "0", False):
        return False
    return None  # 'x' / blank = not applicable

def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None

def convert(path, season_id, outdir):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Schedule"]
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h).strip() if h is not None else None for h in rows[0]]
    idx = {h: i for i, h in enumerate(headers) if h}

    def get(row, col):
        i = idx.get(col)
        return row[i] if i is not None and i < len(row) else None

    tz_cols = [c for c in ("ET", "CT", "MT", "PT") if c in idx]
    games = []
    for row in rows[1:]:
        if get(row, "Game #") is None:
            continue
        d = get(row, "Full Date")
        date_str = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)
        t = get(row, "Time (MTN)")
        time_str = t.strftime("%H:%M") if isinstance(t, (time, datetime)) else (str(t) if t else None)

        venue_tz = next((c for c in tz_cols if flag(get(row, c))), None)

        # margin bucket from the 1G/2G/3+G flags
        margin = None
        if flag(get(row, "1 G Diff")):
            margin = 1
        elif flag(get(row, "2 G Diff")):
            margin = 2
        elif flag(get(row, "3+ G Diff")):
            margin = 3

        moon = get(row, "Moon")
        gf, ga = to_int(get(row, "GF")), to_int(get(row, "GA"))
        game = {
            "game": to_int(get(row, "Game #")),
            "date": date_str,
            "dayOfWeek": get(row, "Day of Week"),
            "homeAway": (get(row, "h/a") or "").strip().lower() or None,
            "opponent": norm_opponent(get(row, "Opponent")),
            "timeLocal": time_str,
            "result": (str(get(row, "Result")).strip().upper() if get(row, "Result") else None),
            "gf": gf, "ga": ga,
            "diff": (gf - ga) if gf is not None and ga is not None else None,
            "marginBucket": margin,
            "restDays": to_int(get(row, "Off Days Btwn")),
            "b2b": flag(get(row, "B2B")),
            "threeIn4": flag(get(row, "3 in 4")),
            "earlyArrival": flag(get(row, "Early Arrival")),
            "tzChange": to_int(get(row, "TZ Change")),
            "venueTz": venue_tz,
            "leadAfter1": flag(get(row, "Lead After 1")),
            "leadAfter2": flag(get(row, "Lead After 2")),
            "scoredFirst": flag(get(row, "Score 1st")),
            "wonThird": flag(get(row, "Win 3rd")),
            "specialTeamsWin": flag(get(row, "Win ST")),
            "specialTeamsTie": flag(get(row, "Tie ST")),
            "fo50": flag(get(row, "FO 50+")),
            "contestedFoWin": flag(get(row, "Ties?")),
            "elevenF7D": flag(get(row, "11F/7D")),
            "mdo": flag(get(row, "MDO")),
            "morningSkate": flag(get(row, "MS?")),
            "dayBeforeSkate": flag(get(row, "Skate?")),
            "moon": str(moon).strip().lower() if moon else None,
        }
        games.append(game)

    out = {
        "seasonId": season_id,
        "label": f"{season_id[:4]}-{season_id[6:]}",
        "source": "manual-import",
        "updated": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
    }
    with open(f"{outdir}/{season_id}.json", "w") as f:
        json.dump(out, f, indent=1)
    print(f"{outdir}/{season_id}.json: {len(games)} games")


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2], sys.argv[3])
