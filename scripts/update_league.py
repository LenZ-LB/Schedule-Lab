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
    "Helsinki": [60.2, 24.9], "Dusseldorf": [51.2, 6.8],
}
# Global Series games route through the actual host city for mileage
# purposes, not either team's home city -- confirmed via the tool's key/
# glossary. Dates match the curated special-events list. Host city
# coordinates are merged into CITY_COORDS above.
GLOBAL_SERIES_GAMES = [
    {"start": "2026-11-12", "end": "2026-11-14", "teams": {"CAR", "SEA"}, "city": "Helsinki"},
    {"start": "2026-12-18", "end": "2026-12-20", "teams": {"CHI", "OTT"}, "city": "Dusseldorf"},
]

def global_series_city(team, opponent, date_str):
    for g in GLOBAL_SERIES_GAMES:
        if {team, opponent} == g["teams"] and g["start"] <= date_str <= g["end"]:
            return g["city"]
    return None


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
            "venueCity": global_series_city(team, opp, g["gameDate"]) or TEAM_CITY.get(venue_team, venue_team),
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

    # League-mandated pauses shouldn't inflate a team's average rest --
    # exclude any gap that fully spans one of these fixed windows,
    # regardless of how much extra buffer a specific team has on either side.
    BREAK_WINDOWS = [
        (datetime(2026, 12, 23), datetime(2026, 12, 25)),
        (datetime(2027, 2, 4), datetime(2027, 2, 7)),
    ]
    def spans_break(prev_date, cur_date):
        return any(prev_date <= b_start and cur_date >= b_end for b_start, b_end in BREAK_WINDOWS)

    rest_for_avg = []
    for i in range(1, n):
        if spans_break(dates[i - 1], dates[i]):
            continue
        rest_for_avg.append(rest_days[i])
    avg_rest = (sum(rest_for_avg) / len(rest_for_avg)) if rest_for_avg else 0

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
    # Rest Vs: +1/-1/0 per game (sign only, not the day-count magnitude) --
    # confirmed via the tool's own glossary ("league-wide this always nets
    # to exactly 0"), which only holds for a zero-sum +1/-1 scheme.
    rest_vs_sum = sum((x > 0) - (x < 0) for x in rest_advantage if x is not None)
    # Waiting: this team had >=1 day rest AND the opponent was on a B2B.
    # Tired: the exact mirror -- this team on a B2B AND the opponent rested.
    # (Not a general rest-advantage comparison -- confirmed via glossary,
    # this is specifically about the opponent's B2B status.)
    waiting_count = sum(1 for r, o in zip(rest_days, opp_rest)
                        if r is not None and o is not None and r >= 1 and o == 0)
    tired_count = sum(1 for r, o in zip(rest_days, opp_rest)
                      if r is not None and o is not None and r == 0 and o >= 1)

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
        chunk_opp_rest = opp_rest[start:start + 5]
        chunk_tz = [g["tzChange"] for g in chunk]
        seg_miles = 0.0
        for i in range(start + 1, min(start + 5, n)):
            c1 = CITY_COORDS.get(games[i - 1]["venueCity"])
            c2 = CITY_COORDS.get(games[i]["venueCity"])
            if c1 and c2:
                seg_miles += haversine_miles(c1, c2)
        road = sum(1 for g in chunk if not g["isHome"])
        valid_rest = [r for r in chunk_rest if r is not None]
        seg_tz_total = sum(abs(t) for t in chunk_tz)
        seg_waiting = sum(1 for r, o in zip(chunk_rest, chunk_opp_rest)
                          if r is not None and o is not None and r >= 1 and o == 0)
        seg_tired = sum(1 for r, o in zip(chunk_rest, chunk_opp_rest)
                        if r is not None and o is not None and r == 0 and o >= 1)
        tags = []
        if road == len(chunk): tags.append("All Road")
        elif road == 0: tags.append("Homestand")
        elif road >= len(chunk) - 1: tags.append("Road Heavy")
        else: tags.append("Balanced")
        chunk_b2b = sum(1 for r in chunk_rest if r == 0)
        if chunk_b2b >= 2: tags.append("B2B Heavy")
        if seg_tz_total >= 8: tags.append("Time Zone Grind")
        if seg_waiting > seg_tired: tags.append("Catching Tired Teams")
        elif seg_tired > seg_waiting: tags.append("Grinding Through Fatigue")
        segments.append({
            "index": idx,
            "startDate": chunk[0]["date"], "endDate": chunk[-1]["date"],
            "games": len(chunk),
            "opponents": [g["opponent"] for g in chunk],
            "isHome": [g["isHome"] for g in chunk],
            "roadGames": road, "homeGames": len(chunk) - road,
            "b2bCount": chunk_b2b,
            "tzHours": seg_tz_total,
            "miles": round(seg_miles),
            "restVs": sum((x > 0) - (x < 0) for x in chunk_adv if x is not None),
            "avgRestDays": round(sum(valid_rest) / len(valid_rest), 2) if valid_rest else None,
            "tags": tags,
        })

    # Toughest stretch: EVERY possible 5-game sliding window (not the fixed
    # non-overlapping segments above -- confirmed via the tool's own
    # glossary, which explicitly distinguishes the two). Each window is
    # scored on road games, B2B count, TZ hours, and miles *within that
    # window*, each min-max normalized against this team's own other
    # windows (so miles, being a much bigger raw number, doesn't
    # automatically dominate the score). The highest-scoring window wins.
    toughest = None
    if n >= 5:
        windows = []
        for start in range(0, n - 4):
            chunk = games[start:start + 5]
            chunk_rest = rest_days[start:start + 5]
            w_road = sum(1 for g in chunk if not g["isHome"])
            w_b2b = sum(1 for r in chunk_rest if r == 0)
            w_tz = sum(abs(g["tzChange"]) for g in chunk)
            w_miles = 0.0
            for i in range(start + 1, start + 5):
                c1 = CITY_COORDS.get(games[i - 1]["venueCity"])
                c2 = CITY_COORDS.get(games[i]["venueCity"])
                if c1 and c2:
                    w_miles += haversine_miles(c1, c2)
            valid = [r for r in chunk_rest if r is not None]
            windows.append({
                "startDate": chunk[0]["date"], "endDate": chunk[-1]["date"],
                "opponents": [g["opponent"] for g in chunk], "isHome": [g["isHome"] for g in chunk],
                "games": 5, "roadGames": w_road, "b2bCount": w_b2b,
                "tzHours": w_tz, "miles": round(w_miles),
                "avgRestDays": round(sum(valid) / len(valid), 2) if valid else None,
            })

        def norm(vals):
            lo, hi = min(vals), max(vals)
            return [0.5] * len(vals) if hi == lo else [(v - lo) / (hi - lo) for v in vals]

        road_n = norm([w["roadGames"] for w in windows])
        b2b_n = norm([w["b2bCount"] for w in windows])
        tz_n = norm([w["tzHours"] for w in windows])
        miles_n = norm([w["miles"] for w in windows])
        scores = [road_n[i] + b2b_n[i] + tz_n[i] + miles_n[i] for i in range(len(windows))]
        best_i = max(range(len(windows)), key=lambda i: scores[i])
        toughest = windows[best_i]

    game_log = [{
        "date": g["date"], "opponent": g["opponent"], "isHome": g["isHome"],
        "restDays": rest_days[i], "b2b": rest_days[i] == 0,
        "venueCity": g["venueCity"],
    } for i, g in enumerate(games)]

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
        "gameLog": game_log,
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


def diff_schedules(old_data, new_data):
    """
    Compare the previous league dataset against what the API just returned.
    Returns a dict of changes, structured for easy logging and optional alerting.

    We diff at the game level: for every team, compare each game by date and
    check for date shifts, opponent changes, and home/away flips. These are the
    real schedule amendments the league actually makes (postponements, date moves,
    venue swaps). Result counts and derived stats (B2B, rest, travel) change as
    a downstream consequence and don't need their own diff.
    """
    changes = {}
    for city, new_summary in new_data["teamSummary"].items():
        code = new_data["teamCodes"].get(city)
        old_summary = old_data.get("teamSummary", {}).get(city)
        if not old_summary or not code:
            continue

        old_log = {g["date"]: g for g in old_summary.get("gameLog", [])}
        new_log = {g["date"]: g for g in new_summary.get("gameLog", [])}
        old_dates = set(old_log)
        new_dates = set(new_log)

        team_changes = []

        # Removed games (date no longer in new schedule -- postponed or moved)
        for d in sorted(old_dates - new_dates):
            g = old_log[d]
            team_changes.append({
                "type": "game_removed",
                "date": d,
                "opponent": g.get("opponent"),
                "isHome": g.get("isHome"),
                "detail": f"Game vs {g.get('opponent')} on {d} no longer in schedule",
            })

        # Added games (new date not previously scheduled)
        for d in sorted(new_dates - old_dates):
            g = new_log[d]
            team_changes.append({
                "type": "game_added",
                "date": d,
                "opponent": g.get("opponent"),
                "isHome": g.get("isHome"),
                "detail": f"New game vs {g.get('opponent')} on {d} added to schedule",
            })

        # Changed games (same date, different opponent or home/away)
        for d in sorted(old_dates & new_dates):
            og, ng = old_log[d], new_log[d]
            if og.get("opponent") != ng.get("opponent"):
                team_changes.append({
                    "type": "opponent_changed",
                    "date": d,
                    "old": og.get("opponent"),
                    "new": ng.get("opponent"),
                    "detail": f"{d}: opponent changed from {og.get('opponent')} to {ng.get('opponent')}",
                })
            if og.get("isHome") != ng.get("isHome"):
                team_changes.append({
                    "type": "venue_flipped",
                    "date": d,
                    "old_isHome": og.get("isHome"),
                    "new_isHome": ng.get("isHome"),
                    "detail": f"{d}: home/away flipped (was {'home' if og.get('isHome') else 'away'})",
                })

        if team_changes:
            changes[city] = team_changes

    # Also flag total game-count changes
    old_total = old_data.get("totalGames", 0)
    new_total = new_data.get("totalGames", 0)
    if old_total != new_total:
        changes["__league__"] = [{
            "type": "total_games_changed",
            "old": old_total,
            "new": new_total,
            "detail": f"Total games changed from {old_total} to {new_total}",
        }]

    return changes


def main():
    cfg = json.loads((ROOT / "config.json").read_text())
    season_id = sys.argv[1] if len(sys.argv) > 1 else cfg.get("currentSeason")
    detect_only = "--detect-only" in sys.argv   # report changes without writing
    quiet = "--quiet" in sys.argv               # suppress per-team progress
    if not season_id:
        sys.exit("No season specified. Pass it as an argument or set currentSeason in config.json.")

    outdir = ROOT / "docs" / "data" / "league"
    outdir.mkdir(parents=True, exist_ok=True)
    outpath = outdir / f"{season_id}.json"

    # Load existing data for change detection (may not exist on first run)
    existing = None
    if outpath.exists():
        try:
            existing = json.loads(outpath.read_text())
        except Exception as e:
            print(f"  ! could not read existing data for diff: {e}", file=sys.stderr)

    if not quiet:
        print(f"Pulling league schedule from NHL API for {season_id}...")

    new_out = build_league(season_id)

    # Run change detection against previous data
    if existing:
        changes = diff_schedules(existing, new_out)
        if changes:
            print(f"\n{'='*60}")
            print(f"SCHEDULE CHANGES DETECTED ({sum(len(v) for v in changes.values())} total)")
            print(f"{'='*60}")
            for team, team_changes in sorted(changes.items()):
                print(f"\n{team}:")
                for c in team_changes:
                    print(f"  [{c['type'].upper()}] {c['detail']}")
            print(f"{'='*60}\n")

            # Write a changes log alongside the data file for audit purposes
            changes_path = outdir / f"{season_id}_changes_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
            changes_log = {
                "detected": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "seasonId": season_id,
                "changes": changes,
            }
            changes_path.write_text(json.dumps(changes_log, indent=1))
            print(f"Changes log written to {changes_path.name}")
        else:
            print("No schedule changes detected.")
    else:
        print("No existing data to diff against — first run, writing full dataset.")

    if detect_only:
        print("--detect-only: not writing updated data file.")
        return

    new_out["source"] = "nhl-api-live"
    new_out.pop("sourceNote", None)
    outpath.write_text(json.dumps(new_out, indent=1))
    print(f"Wrote {outpath} — {len(new_out['teamSummary'])} teams, {new_out['totalGames']} total games")


if __name__ == "__main__":
    main()
