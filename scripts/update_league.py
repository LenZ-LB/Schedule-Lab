#!/usr/bin/env python3
"""
update_league.py — builds a league-wide (all 32 teams) schedule-structure
dataset from the NHL API: rest/B2B/density patterns, travel miles, rolling
game segments, opponent counts, and month/day distribution.

This does NOT include a "fatigue score" or "special games" (notable/
broadcast games) list. An earlier version of this data existed in a
hardcoded tool and included both — the fatigue score turned out to be
fabricated (not a real, defined formula) rather than something recoverable,
and the special-games list has the same unverified provenance, so neither
is reproduced here. If a real formula/source for either surfaces later,
they can be added back in cleanly; until then, every field in this output
is either pulled directly from the NHL API or computed by inspectable,
documented arithmetic (grep for the field name to find the computation).

Usage:
    python scripts/update_league.py                # season from config.json
    python scripts/update_league.py 20262027        # explicit season
"""
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
ROOT = Path(__file__).resolve().parent.parent

# Tri-code -> full city/team name, matching the public reference data below.
TEAM_CITY = {
    "ANA": "Anaheim", "BOS": "Boston", "BUF": "Buffalo", "CGY": "Calgary",
    "CAR": "Carolina", "CHI": "Chicago", "COL": "Colorado", "CBJ": "Columbus",
    "DAL": "Dallas", "DET": "Detroit", "EDM": "Edmonton", "FLA": "Florida",
    "LAK": "Los Angeles", "MIN": "Minnesota", "MTL": "Montreal",
    "NYI": "NY Islanders", "NYR": "NY Rangers", "NSH": "Nashville",
    "NJD": "New Jersey", "OTT": "Ottawa", "PHI": "Philadelphia",
    "PIT": "Pittsburgh", "SJS": "San Jose", "SEA": "Seattle",
    "STL": "St. Louis", "TBL": "Tampa Bay", "TOR": "Toronto", "UTA": "Utah",
    "VAN": "Vancouver", "VGK": "Vegas", "WSH": "Washington", "WPG": "Winnipeg",
}
CITY_TEAM = {v: k for k, v in TEAM_CITY.items()}

TEAM_IANA = {
    "BOS": "America/New_York", "BUF": "America/New_York", "CAR": "America/New_York",
    "CBJ": "America/New_York", "DET": "America/Detroit", "FLA": "America/New_York",
    "MTL": "America/Toronto", "NJD": "America/New_York", "NYI": "America/New_York",
    "NYR": "America/New_York", "OTT": "America/Toronto", "PHI": "America/New_York",
    "PIT": "America/New_York", "TBL": "America/New_York", "TOR": "America/Toronto",
    "WSH": "America/New_York",
    "CHI": "America/Chicago", "DAL": "America/Chicago", "MIN": "America/Chicago",
    "NSH": "America/Chicago", "STL": "America/Chicago", "WPG": "America/Winnipeg",
    "CGY": "America/Edmonton", "COL": "America/Denver", "EDM": "America/Edmonton",
    "UTA": "America/Denver",
    "ANA": "America/Los_Angeles", "LAK": "America/Los_Angeles", "SJS": "America/Los_Angeles",
    "SEA": "America/Los_Angeles", "VAN": "America/Vancouver", "VGK": "America/Los_Angeles",
}

# Public geographic facts (arena city coordinates) -- not derived analysis,
# safe to hardcode. lat, lon.
CITY_COORDS = {
    "Anaheim": [33.8, -117.9], "Boston": [42.4, -71.1], "Buffalo": [42.9, -78.9],
    "Calgary": [51.0, -114.1], "Carolina": [35.8, -78.7], "Chicago": [41.9, -87.7],
    "Colorado": [39.7, -105.1], "Columbus": [40.0, -83.0], "Dallas": [32.8, -96.8],
    "Detroit": [42.3, -83.1], "Edmonton": [53.5, -113.5], "Florida": [26.2, -80.3],
    "Los Angeles": [34.0, -118.3], "Minnesota": [44.9, -93.1], "Montreal": [45.5, -73.6],
    "NY Islanders": [40.7, -73.6], "NY Rangers": [40.8, -74.0], "Nashville": [36.2, -86.8],
    "New Jersey": [40.7, -74.2], "Ottawa": [45.3, -75.7], "Philadelphia": [40.0, -75.2],
    "Pittsburgh": [40.4, -80.0], "San Jose": [37.3, -121.9], "Seattle": [47.6, -122.3],
    "St. Louis": [38.6, -90.2], "Tampa Bay": [27.9, -82.5], "Toronto": [43.6, -79.4],
    "Utah": [40.8, -111.9], "Vancouver": [49.3, -123.1], "Vegas": [36.1, -115.2],
    "Washington": [38.9, -77.0], "Winnipeg": [49.9, -97.1],
}
CITY_COLORS = None  # team_colors is purely cosmetic (branding hex codes);
                     # intentionally not carried into this anonymized build.


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "schedule-lab/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def haversine_miles(c1, c2):
    lat1, lon1, lat2, lon2 = map(math.radians, [c1[0], c1[1], c2[0], c2[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(a))  # earth radius in miles


def longest_run(seq, value):
    """Longest run of consecutive equal `value` entries in seq."""
    best = cur = 0
    for x in seq:
        cur = cur + 1 if x == value else 0
        best = max(best, cur)
    return best


def games_in_window(dates, window_nights, min_count):
    """Count how many dates have >= min_count games (incl. itself) within
    the trailing window_nights-night span ending on that date."""
    count = 0
    for i, d in enumerate(dates):
        n = sum(1 for d2 in dates if 0 <= (d - d2).days <= window_nights)
        if n >= min_count:
            count += 1
    return count


def build_team_schedule(team, season_id):
    """Fetch + lightly process one team's regular-season schedule."""
    sched = fetch(f"{API}/club-schedule-season/{team}/{season_id}")
    raw = [g for g in sched.get("games", []) if g.get("gameType") == 2]
    start_year = int(season_id[:4])
    season_start = f"{start_year}-08-01"
    season_end = f"{start_year + 1}-07-01"
    raw = [g for g in raw if season_start < g.get("gameDate", "") < season_end]
    raw.sort(key=lambda g: g.get("gameDate", ""))

    home_iana = TEAM_IANA.get(team, "America/New_York")
    games = []
    for g in raw:
        home = g.get("homeTeam", {}) or {}
        away = g.get("awayTeam", {}) or {}
        is_home = home.get("abbrev") == team
        opp = away.get("abbrev") if is_home else home.get("abbrev")
        venue_team = team if is_home else opp
        venue_iana = TEAM_IANA.get(venue_team, "America/New_York")
        d = datetime.strptime(g["gameDate"], "%Y-%m-%d")

        tz_change = 0
        st = g.get("startTimeUTC")
        if st and games:
            try:
                utc_dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
                cur_off = utc_dt.astimezone(ZoneInfo(venue_iana)).utcoffset().total_seconds() / 3600
                prev_venue_team = team if games[-1]["isHome"] else games[-1]["opponent"]
                prev_iana = TEAM_IANA.get(prev_venue_team, "America/New_York")
                prev_off = utc_dt.astimezone(ZoneInfo(prev_iana)).utcoffset().total_seconds() / 3600
                tz_change = round(cur_off - prev_off)
            except Exception:
                pass

        games.append({
            "date": g["gameDate"], "dateObj": d, "opponent": opp,
            "isHome": is_home, "tzChange": tz_change,
            "venueCity": TEAM_CITY.get(venue_team, venue_team),
        })
    return games


def compute_team_summary(team, games, all_dates_for_opp):
    """games: this team's own processed game list (see build_team_schedule).
    all_dates_for_opp: {opponentCode: sorted list of that opponent's own
    game dates} -- needed to compute the opponent's rest at each matchup."""
    n = len(games)
    dates = [g["dateObj"] for g in games]
    rest_days = []
    for i, g in enumerate(games):
        rest_days.append(None if i == 0 else (dates[i] - dates[i - 1]).days - 1)
    b2b_flags = [r == 0 for r in rest_days if r is not None]
    b2b_count = sum(b2b_flags)
    avg_rest = (sum(r for r in rest_days if r is not None) / (n - 1)) if n > 1 else 0

    home_flags = [g["isHome"] for g in games]
    longest_homestand = longest_run(home_flags, True)
    longest_roadtrip = longest_run(home_flags, False)

    three_in_4 = games_in_window(dates, 3, 3)
    four_in_6 = games_in_window(dates, 5, 4)
    five_in_8 = games_in_window(dates, 7, 5)

    tz_hours_total = sum(abs(g["tzChange"]) for g in games)

    # travel miles: distance from each game's venue city to the next one
    miles_total = 0.0
    for i in range(1, n):
        c1 = CITY_COORDS.get(games[i - 1]["venueCity"])
        c2 = CITY_COORDS.get(games[i]["venueCity"])
        if c1 and c2:
            miles_total += haversine_miles(c1, c2)

    # opponent rest + our rest-advantage per game, using the opponent's own
    # full schedule dates (same technique as the single-team pipeline)
    opp_rest = []
    for g in games:
        opp_dates = all_dates_for_opp.get(g["opponent"], [])
        if g["date"] in opp_dates:
            idx = opp_dates.index(g["date"])
            if idx > 0:
                prev = datetime.strptime(opp_dates[idx - 1], "%Y-%m-%d")
                cur = datetime.strptime(g["date"], "%Y-%m-%d")
                opp_rest.append((cur - prev).days - 1)
                continue
        opp_rest.append(None)

    rest_advantage = []
    for r, o in zip(rest_days, opp_rest):
        rest_advantage.append(None if r is None or o is None else r - o)
    rest_vs_sum = sum(x for x in rest_advantage if x is not None)
    # tired_count: games where the opponent had strictly less rest than us
    # (we caught them tired). waiting_count: the reverse (they were fresher).
    tired_count = sum(1 for x in rest_advantage if x is not None and x > 0)
    waiting_count = sum(1 for x in rest_advantage if x is not None and x < 0)

    opponent_counts = {}
    opponent_home = {}
    for g in games:
        opponent_counts[g["opponent"]] = opponent_counts.get(g["opponent"], 0) + 1
        if g["isHome"]:
            opponent_home[g["opponent"]] = opponent_home.get(g["opponent"], 0) + 1
    opponent_matchups = {
        opp: {"total": c, "home": opponent_home.get(opp, 0), "away": c - opponent_home.get(opp, 0)}
        for opp, c in opponent_counts.items()
    }

    month_counts, dow_counts = {}, {}
    for g in games:
        mk = g["dateObj"].strftime("%b %Y")
        month_counts[mk] = month_counts.get(mk, 0) + 1
        dk = g["dateObj"].strftime("%A")
        dow_counts[dk] = dow_counts.get(dk, 0) + 1

    # segments: rolling non-overlapping windows of 5 games (last one may be
    # 1-4 games if the season doesn't divide evenly)
    segments = []
    for idx, start in enumerate(range(0, n, 5), start=1):
        chunk = games[start:start + 5]
        chunk_rest = rest_days[start:start + 5]
        chunk_adv = rest_advantage[start:start + 5]
        chunk_tz = [g["tzChange"] for g in chunk]
        seg_miles = 0.0
        for i in range(start + 1, min(start + 5, n)):
            c1 = CITY_COORDS.get(games[i - 1]["venueCity"])
            c2 = CITY_COORDS.get(games[i]["venueCity"])
            if c1 and c2:
                seg_miles += haversine_miles(c1, c2)
        road = sum(1 for g in chunk if not g["isHome"])
        valid_rest = [r for r in chunk_rest if r is not None]
        tags = []
        if road == len(chunk): tags.append("All Road")
        elif road == 0: tags.append("Homestand")
        elif road >= len(chunk) - 1: tags.append("Road Heavy")
        else: tags.append("Balanced")
        chunk_b2b = sum(1 for r in chunk_rest if r == 0)
        if chunk_b2b >= 2: tags.append("B2B Heavy")
        segments.append({
            "index": idx,
            "startDate": chunk[0]["date"], "endDate": chunk[-1]["date"],
            "games": len(chunk),
            "opponents": [g["opponent"] for g in chunk],
            "isHome": [g["isHome"] for g in chunk],
            "roadGames": road, "homeGames": len(chunk) - road,
            "b2bCount": chunk_b2b,
            "tzHours": sum(abs(t) for t in chunk_tz),
            "miles": round(seg_miles),
            "restVs": sum(x for x in chunk_adv if x is not None),
            "avgRestDays": round(sum(valid_rest) / len(valid_rest), 2) if valid_rest else None,
            "tags": tags,
        })

    # toughest stretch: the segment with the fewest average rest days
    # (transparent, real-data ranking -- see module docstring on why this
    # replaces the original tool's fabricated "fatigue score")
    scored = [s for s in segments if s["avgRestDays"] is not None]
    toughest = min(scored, key=lambda s: s["avgRestDays"]) if scored else None

    return {
        "games": n, "home": sum(home_flags), "away": n - sum(home_flags),
        "b2bCount": b2b_count,
        "avgRestDays": round(avg_rest, 2),
        "longestHomestand": longest_homestand, "longestRoadtrip": longest_roadtrip,
        "threeInFourCount": three_in_4, "fourInSixCount": four_in_6, "fiveInEightCount": five_in_8,
        "tzHours": tz_hours_total,
        "totalTravelMiles": round(miles_total),
        "restVs": rest_vs_sum, "tiredCount": tired_count, "waitingCount": waiting_count,
        "toughestStretch": toughest,
        "segments": segments,
        "opponentCounts": opponent_counts, "opponentMatchups": opponent_matchups,
        "monthCounts": month_counts, "dowCounts": dow_counts,
    }


def build_league(season_id):
    all_games = {}
    all_dates = {}
    for code in sorted(TEAM_CITY.keys()):
        print(f"  fetching {code}...")
        try:
            games = build_team_schedule(code, season_id)
        except Exception as e:
            print(f"  ! failed to fetch {code}: {e}", file=sys.stderr)
            games = []
        all_games[code] = games
        all_dates[code] = [g["date"] for g in games]

    team_summary = {}
    for code, games in all_games.items():
        if not games:
            continue
        team_summary[TEAM_CITY[code]] = compute_team_summary(code, games, all_dates)

    # league-wide aggregates
    total_games = sum(s["games"] for s in team_summary.values()) // 2  # each game counted by both teams
    total_b2b_team_games = sum(s["b2bCount"] for s in team_summary.values())
    all_dates_flat = [g["date"] for games in all_games.values() for g in games]
    season_start = min(all_dates_flat) if all_dates_flat else None
    season_end = max(all_dates_flat) if all_dates_flat else None

    league_month_counts, league_dow_counts = {}, {}
    for s in team_summary.values():
        for k, v in s["monthCounts"].items():
            league_month_counts[k] = league_month_counts.get(k, 0) + v
        for k, v in s["dowCounts"].items():
            league_dow_counts[k] = league_dow_counts.get(k, 0) + v

    max_segments = max((len(s["segments"]) for s in team_summary.values()), default=0)
    league_segment_avg = []
    for idx in range(max_segments):
        vals = [s["segments"][idx] for s in team_summary.values() if idx < len(s["segments"])]
        if not vals:
            continue
        league_segment_avg.append({
            "index": idx + 1,
            "roadGames": round(sum(v["roadGames"] for v in vals) / len(vals), 2),
            "b2bCount": round(sum(v["b2bCount"] for v in vals) / len(vals), 2),
            "tzHours": round(sum(v["tzHours"] for v in vals) / len(vals), 2),
            "miles": round(sum(v["miles"] for v in vals) / len(vals), 1),
            "restVs": round(sum(v["restVs"] for v in vals) / len(vals), 2),
        })

    return {
        "seasonId": season_id,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "teams": [TEAM_CITY[c] for c in sorted(TEAM_CITY.keys())],
        "teamCodes": {TEAM_CITY[c]: c for c in TEAM_CITY},
        "cityCoords": CITY_COORDS,
        "totalGames": total_games, "totalB2bTeamGames": total_b2b_team_games,
        "seasonStart": season_start, "seasonEnd": season_end,
        "leagueMonthCounts": league_month_counts, "leagueDowCounts": league_dow_counts,
        "leagueSegmentAvg": league_segment_avg,
        "teamSummary": team_summary,
    }


def main():
    cfg = json.loads((ROOT / "config.json").read_text())
    season_id = sys.argv[1] if len(sys.argv) > 1 else cfg.get("currentSeason")
    if not season_id:
        sys.exit("No season specified. Pass it as an argument or set currentSeason in config.json.")
    print(f"Building league-wide dataset for {season_id}...")
    out = build_league(season_id)
    outdir = ROOT / "docs" / "data" / "league"
    outdir.mkdir(parents=True, exist_ok=True)
    outpath = outdir / f"{season_id}.json"
    outpath.write_text(json.dumps(out, indent=1))
    print(f"Wrote {outpath} -- {len(out['teamSummary'])} teams, {out['totalGames']} total games")


if __name__ == "__main__":
    main()
