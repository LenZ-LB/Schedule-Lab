#!/usr/bin/env python3
"""
One-time importer: converts the original Schedule_Data_*.xlsx workbooks
into the JSON schema used by the site (docs/data/<seasonId>.json).

Usage:
    python scripts/convert_xlsx.py <file.xlsx> <seasonId e.g. 20232024> <outdir>
"""
import json
import sys
from datetime import datetime, time

import openpyxl

# ---- NHL team normalization -------------------------------------------------
TEAMS = {
    "ANA": "Anaheim Ducks", "ARI": "Arizona Coyotes", "BOS": "Boston Bruins",
    "BUF": "Buffalo Sabres", "CGY": "Calgary Flames", "CAR": "Carolina Hurricanes",
    "CHI": "Chicago Blackhawks", "COL": "Colorado Avalanche",
    "CBJ": "Columbus Blue Jackets", "DAL": "Dallas Stars", "DET": "Detroit Red Wings",
    "EDM": "Edmonton Oilers", "FLA": "Florida Panthers", "LAK": "Los Angeles Kings",
    "MIN": "Minnesota Wild", "MTL": "Montreal Canadiens", "MTL2": "Montréal Canadiens",
    "NSH": "Nashville Predators", "NJD": "New Jersey Devils",
    "NYI": "New York Islanders", "NYR": "New York Rangers", "OTT": "Ottawa Senators",
    "PHI": "Philadelphia Flyers", "PIT": "Pittsburgh Penguins",
    "SJS": "San Jose Sharks", "SEA": "Seattle Kraken", "STL": "St. Louis Blues",
    "TBL": "Tampa Bay Lightning", "TOR": "Toronto Maple Leafs",
    "UTA": "Utah Hockey Club", "UTM": "Utah Mammoth", "VAN": "Vancouver Canucks",
    "VGK": "Vegas Golden Knights", "WSH": "Washington Capitals", "WPG": "Winnipeg Jets",
}
NAME_TO_CODE = {}
for code, name in TEAMS.items():
    NAME_TO_CODE[name.lower()] = "MTL" if code == "MTL2" else code
NAME_TO_CODE["st louis blues"] = "STL"
NAME_TO_CODE["utah hc"] = "UTA"

def norm_opponent(v):
    if v is None:
        return None, None
    s = str(v).strip()
    if s.upper() in TEAMS:
        code = "MTL" if s.upper() == "MTL2" else s.upper()
        return code, TEAMS[s.upper()]
    code = NAME_TO_CODE.get(s.lower())
    if code:
        return code, TEAMS.get(code, s)
    return s, s  # unknown, keep as-is


def flag(v):
    """0/1/'x'/None -> True/False/None (x and blank = not applicable / unknown)"""
    if v in (1, "1", True):
        return True
    if v in (0, "0", False):
        return False
    return None


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

        venue_tz = None
        for c in tz_cols:
            if flag(get(row, c)):
                venue_tz = c
                break

        moon = get(row, "Moon")
        game = {
            "game": to_int(get(row, "Game #")),
            "date": date_str,
            "dayOfWeek": get(row, "Day of Week"),
            "homeAway": (get(row, "h/a") or "").strip().lower() or None,
            "opponent": None, "opponentName": None,
            "timeLocal": time_str,
            "result": (str(get(row, "Result")).strip().upper() if get(row, "Result") else None),
            "gf": to_int(get(row, "GF")), "ga": to_int(get(row, "GA")),
            "restDays": to_int(get(row, "Off Days Btwn")),
            "b2b": flag(get(row, "B2B")),
            "threeIn4": flag(get(row, "3 in 4")),
            "earlyArrival": flag(get(row, "Early Arrival")),
            "tzChange": to_int(get(row, "TZ Change")),
            "venueTz": venue_tz,
            "leadAfter1": flag(get(row, "Lead After 1")),
            "leadAfter2": flag(get(row, "Lead After 2")),
            "leadIntoThird": flag(get(row, "Win ST")),
            "tiedIntoThird": flag(get(row, "Tie ST")),
            "scoredFirst": flag(get(row, "Score 1st")),
            "wonThird": flag(get(row, "Win 3rd")),
            "fo50": flag(get(row, "FO 50+")),
            "foTies": flag(get(row, "Ties?")),
            "elevenF7D": flag(get(row, "11F/7D")),
            "mdo": flag(get(row, "MDO")),
            "morningSkate": flag(get(row, "MS?")),
            "skate": flag(get(row, "Skate?")) if "Skate?" in idx else None,
            "moon": str(moon).strip().lower() if moon else None,
        }
        game["opponent"], game["opponentName"] = norm_opponent(get(row, "Opponent"))
        if game["gf"] is not None and game["ga"] is not None:
            game["diff"] = game["gf"] - game["ga"]
        else:
            game["diff"] = None
        games.append(game)

    out = {
        "seasonId": season_id,
        "label": f"{season_id[:4]}-{season_id[6:]}",
        "team": "EDM",
        "teamName": "Edmonton Oilers",
        "source": "manual-import",
        "updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
    }
    outpath = f"{outdir}/{season_id}.json"
    with open(outpath, "w") as f:
        json.dump(out, f, indent=1)
    print(f"{outpath}: {len(games)} games")


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2], sys.argv[3])
