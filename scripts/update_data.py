#!/usr/bin/env python3
"""
update_data.py — pulls the season schedule + results from the NHL API
(api-web.nhle.com), computes every derivable situational field from the
original spreadsheet workflow, merges manual team-ops flags, and writes
docs/data/<seasonId>.json for the site.

Usage:
    python scripts/update_data.py                # auto-detect current season
    python scripts/update_data.py 20262027       # explicit season
    python scripts/update_data.py 20262027 --team EDM

Manual flags (MDO, morning skate, early arrival, 11F/7D, faceoff-ties)
live in data/manual_flags/<seasonId>.json keyed by game date — they are
merged in on every run, so re-running never wipes your hand-entered data.
"""
import argparse
import json
from datetime import timedelta
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api-web.nhle.com/v1"
ROOT = Path(__file__).resolve().parent.parent

# venue timezone by home team (regular-season arenas)
TEAM_TZ = {
    "BOS": "ET", "BUF": "ET", "CAR": "ET", "CBJ": "ET", "DET": "ET", "FLA": "ET",
    "MTL": "ET", "NJD": "ET", "NYI": "ET", "NYR": "ET", "OTT": "ET", "PHI": "ET",
    "PIT": "ET", "TBL": "ET", "TOR": "ET", "WSH": "ET",
    "CHI": "CT", "DAL": "CT", "MIN": "CT", "NSH": "CT", "STL": "CT", "WPG": "CT",
    "CGY": "MT", "COL": "MT", "EDM": "MT", "ARI": "MT", "UTA": "MT", "UTM": "MT",
    "ANA": "PT", "LAK": "PT", "SJS": "PT", "SEA": "PT", "VAN": "PT", "VGK": "PT",
}
TZ_OFFSET = {"ET": 0, "CT": -1, "MT": -2, "PT": -3}  # relative hours vs ET

TEAM_NAMES = {
    "ANA": "Anaheim Ducks", "ARI": "Arizona Coyotes", "BOS": "Boston Bruins",
    "BUF": "Buffalo Sabres", "CGY": "Calgary Flames", "CAR": "Carolina Hurricanes",
    "CHI": "Chicago Blackhawks", "COL": "Colorado Avalanche",
    "CBJ": "Columbus Blue Jackets", "DAL": "Dallas Stars", "DET": "Detroit Red Wings",
    "EDM": "Edmonton Oilers", "FLA": "Florida Panthers", "LAK": "Los Angeles Kings",
    "MIN": "Minnesota Wild", "MTL": "Montreal Canadiens", "NSH": "Nashville Predators",
    "NJD": "New Jersey Devils", "NYI": "New York Islanders", "NYR": "New York Rangers",
    "OTT": "Ottawa Senators", "PHI": "Philadelphia Flyers", "PIT": "Pittsburgh Penguins",
    "SJS": "San Jose Sharks", "SEA": "Seattle Kraken", "STL": "St. Louis Blues",
    "TBL": "Tampa Bay Lightning", "TOR": "Toronto Maple Leafs", "UTA": "Utah Hockey Club",
    "UTM": "Utah Mammoth", "VAN": "Vancouver Canucks", "VGK": "Vegas Golden Knights",
    "WSH": "Washington Capitals", "WPG": "Winnipeg Jets",
}

MANUAL_FIELDS = ("mdo", "morningSkate", "skate", "earlyArrival",
                 "elevenF7D", "foTies", "notes")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "schedule-lab/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


FULL_MOON_NAMES = {1: "full wolf moon", 2: "full snow moon", 3: "full worm moon",
                   4: "full pink moon", 5: "full flower moon", 6: "full strawberry moon",
                   7: "full buck moon", 8: "full sturgeon moon", 9: "full corn moon",
                   10: "full hunter's moon", 11: "full beaver moon", 12: "full cold moon"}


def moon_phase(date_str, tz_offset_hours=-7):
    """Moon phase for a local calendar date.

    Convention (matches the original spreadsheets): a date is a principal
    phase (new / first quarter / full / last quarter) only if that exact
    event falls on that local calendar date; otherwise it's the
    intermediate phase (crescent / gibbous). Full moons get their
    traditional monthly names. Uses ephem when available, else a
    synodic approximation (may drift +/- 1 day near principal events).
    """
    d0 = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    day_start = d0 - timedelta(hours=tz_offset_hours)
    day_end = day_start + timedelta(days=1)
    noon = day_start + timedelta(hours=12)

    def full_name():
        return FULL_MOON_NAMES.get(d0.month, "full moon")

    try:
        import ephem
        n = noon.replace(tzinfo=None)
        events = [
            (ephem.previous_new_moon(n), "new moon"),
            (ephem.next_new_moon(n), "new moon"),
            (ephem.previous_first_quarter_moon(n), "first quarter"),
            (ephem.next_first_quarter_moon(n), "first quarter"),
            (ephem.previous_full_moon(n), "full"),
            (ephem.next_full_moon(n), "full"),
            (ephem.previous_last_quarter_moon(n), "last quarter"),
            (ephem.next_last_quarter_moon(n), "last quarter"),
        ]
        for ev, name in events:
            ev_dt = ev.datetime().replace(tzinfo=timezone.utc)
            if day_start <= ev_dt < day_end:
                return full_name() if name == "full" else name
        # intermediate: position within the lunation
        prev_new = ephem.previous_new_moon(n).datetime().replace(tzinfo=timezone.utc)
        next_new = ephem.next_new_moon(n).datetime().replace(tzinfo=timezone.utc)
        full = ephem.next_full_moon(prev_new.replace(tzinfo=None)).datetime().replace(tzinfo=timezone.utc)
        if noon < full:
            fq = ephem.next_first_quarter_moon(prev_new.replace(tzinfo=None)).datetime().replace(tzinfo=timezone.utc)
            return "waxing crescent" if noon < fq else "waxing gibbous"
        lq = ephem.previous_last_quarter_moon(next_new.replace(tzinfo=None)).datetime().replace(tzinfo=timezone.utc)
        return "waning gibbous" if noon < lq else "waning crescent"
    except ImportError:
        pass

    # fallback: constant synodic period
    ref = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)  # known new moon
    synodic = 29.530588853
    age = ((noon - ref).total_seconds() / 86400.0) % synodic
    f = age / synodic
    for target, name in ((0.0, "new moon"), (0.25, "first quarter"),
                         (0.5, "full"), (0.75, "last quarter"), (1.0, "new moon")):
        event = noon + timedelta(days=(target - f) * synodic)
        if day_start <= event < day_end:
            return full_name() if name == "full" else name
    if f < 0.25:
        return "waxing crescent"
    if f < 0.5:
        return "waxing gibbous"
    if f < 0.75:
        return "waning gibbous"
    return "waning crescent"


def season_auto():
    now = datetime.now()
    y = now.year if now.month >= 8 else now.year - 1
    return f"{y}{y+1}"


def classify_result(us, them, last_period):
    if us > them:
        return {"REG": "W", "OT": "OTW", "SO": "SOW"}.get(last_period, "W")
    return {"REG": "L", "OT": "OTL", "SO": "SOL"}.get(last_period, "L")


def linescore_fields(game_id, team, home_away):
    """Fetch gamecenter landing for period scores + first goal. Best-effort."""
    out = {}
    try:
        landing = fetch(f"{API}/gamecenter/{game_id}/landing")
    except Exception as e:
        print(f"  ! landing fetch failed for {game_id}: {e}", file=sys.stderr)
        return out
    summ = landing.get("summary", {}) or {}
    ls = (summ.get("linescore") or {}).get("byPeriod") or []
    us_key = "home" if home_away == "h" else "away"
    them_key = "away" if home_away == "h" else "home"
    us_cum = them_cum = 0
    per = []
    for p in ls:
        ptype = (p.get("periodDescriptor") or {}).get("periodType", "REG")
        if ptype == "SO":
            continue  # shootout excluded from goal totals (matches sheet convention)
        us_cum += p.get(us_key, 0) or 0
        them_cum += p.get(them_key, 0) or 0
        per.append((us_cum, them_cum))
    if len(per) >= 1:
        out["leadAfter1"] = per[0][0] > per[0][1]
    if len(per) >= 2:
        out["leadAfter2"] = per[1][0] > per[1][1]
        out["leadIntoThird"] = per[1][0] > per[1][1]
        out["tiedIntoThird"] = per[1][0] == per[1][1]
    if len(per) >= 3:
        p3_us = per[2][0] - per[1][0]
        p3_them = per[2][1] - per[1][1]
        out["wonThird"] = p3_us > p3_them
    # first goal scorer's team
    try:
        for period in (summ.get("scoring") or []):
            goals = period.get("goals") or []
            if goals:
                first = goals[0]
                abbrev = first.get("teamAbbrev")
                if isinstance(abbrev, dict):
                    abbrev = abbrev.get("default")
                out["scoredFirst"] = (abbrev == team)
                break
    except Exception:
        pass
    return out


def faceoff_fields(game_id, home_away):
    """Team faceoff win % from right-rail. Best-effort."""
    try:
        rail = fetch(f"{API}/gamecenter/{game_id}/right-rail")
        for stat in rail.get("teamGameStats", []) or []:
            if stat.get("category") == "faceoffWinningPctg":
                v = stat.get("homeValue" if home_away == "h" else "awayValue")
                if v is not None:
                    v = float(v)
                    if v > 1:  # some responses use 0-100
                        v /= 100.0
                    return {"foPct": round(v, 4), "fo50": v >= 0.5}
    except Exception as e:
        print(f"  ! right-rail fetch failed for {game_id}: {e}", file=sys.stderr)
    return {}


def build_season(season_id, team):
    sched = fetch(f"{API}/club-schedule-season/{team}/{season_id}")
    raw = [g for g in sched.get("games", []) if g.get("gameType") == 2]
    raw.sort(key=lambda g: g.get("gameDate", ""))
    print(f"{team} {season_id}: {len(raw)} regular-season games on schedule")

    games = []
    prev_date = None
    prev_venue_tz = TEAM_TZ.get(team)  # season starts from home base
    recent_dates = []

    for i, g in enumerate(raw, start=1):
        date_str = g["gameDate"]
        d = datetime.strptime(date_str, "%Y-%m-%d")
        home = g.get("homeTeam", {}) or {}
        away = g.get("awayTeam", {}) or {}
        h_ab = home.get("abbrev")
        is_home = h_ab == team
        opp = away.get("abbrev") if is_home else h_ab
        venue_tz = TEAM_TZ.get(h_ab, "ET")

        rest = None if prev_date is None else (d - prev_date).days - 1
        recent_dates.append(d)
        recent_dates = [x for x in recent_dates if (d - x).days <= 3]
        three_in4 = len(recent_dates) >= 3

        # local start time in the club's home timezone
        time_local = None
        st = g.get("startTimeUTC")
        if st:
            try:
                utc = datetime.fromisoformat(st.replace("Z", "+00:00"))
                offset = g.get("venueUTCOffset")  # e.g. "-06:00" (venue local)
                # show in club home tz: ET base offset unknown from API alone,
                # so use venue offset then shift venue->home tz difference
                if offset:
                    sign = -1 if offset.startswith("-") else 1
                    hh, mm = offset.lstrip("+-").split(":")
                    venue_off = sign * (int(hh) + int(mm) / 60)
                    home_off = venue_off + (TZ_OFFSET[TEAM_TZ.get(team, "ET")]
                                            - TZ_OFFSET.get(venue_tz, 0))
                    lt = utc.timestamp() + home_off * 3600
                    time_local = datetime.fromtimestamp(lt, tz=timezone.utc).strftime("%H:%M")
            except Exception:
                pass

        game = {
            "game": i,
            "gameId": g.get("id"),
            "date": date_str,
            "dayOfWeek": d.strftime("%A"),
            "homeAway": "h" if is_home else "a",
            "opponent": opp,
            "opponentName": TEAM_NAMES.get(opp, opp),
            "timeLocal": time_local,
            "result": None, "gf": None, "ga": None, "diff": None,
            "restDays": rest,
            "b2b": rest == 0 if rest is not None else False,
            "threeIn4": three_in4,
            "earlyArrival": None,
            "tzChange": TZ_OFFSET.get(venue_tz, 0) - TZ_OFFSET.get(prev_venue_tz, 0),
            "venueTz": venue_tz,
            "leadAfter1": None, "leadAfter2": None,
            "leadIntoThird": None, "tiedIntoThird": None,
            "scoredFirst": None, "wonThird": None,
            "fo50": None, "foPct": None, "foTies": None,
            "elevenF7D": None, "mdo": None, "morningSkate": None, "skate": None,
            "moon": moon_phase(date_str),
        }

        # completed games: results + linescore + faceoffs
        state = g.get("gameState")
        if state in ("OFF", "FINAL", "F"):
            us = (home if is_home else away).get("score")
            them = (away if is_home else home).get("score")
            last = ((g.get("gameOutcome") or {}).get("lastPeriodType")) or "REG"
            if us is not None and them is not None:
                # sheet convention: shootout decider excluded from GF/GA
                gf, ga = us, them
                if last == "SO":
                    if us > them:
                        gf -= 1
                    else:
                        ga -= 1
                game.update({
                    "result": classify_result(us, them, last),
                    "gf": gf, "ga": ga, "diff": gf - ga,
                })
                game.update(linescore_fields(g.get("id"), team, game["homeAway"]))
                game.update(faceoff_fields(g.get("id"), game["homeAway"]))

        games.append(game)
        prev_date = d
        prev_venue_tz = venue_tz

    return games


def merge_manual(games, season_id):
    path = ROOT / "data" / "manual_flags" / f"{season_id}.json"
    if not path.exists():
        return 0
    flags = json.loads(path.read_text())
    by_date = {g["date"]: g for g in games}
    n = 0
    for date_str, fields in flags.items():
        g = by_date.get(date_str)
        if not g:
            print(f"  ! manual flag date {date_str} not on schedule", file=sys.stderr)
            continue
        for k, v in fields.items():
            if k in MANUAL_FIELDS:
                g[k] = v
                n += 1
    return n


def update_index(season_id, team):
    """Keep docs/data/index.json listing all available seasons."""
    idx_path = ROOT / "docs" / "data" / "index.json"
    idx = {"team": team, "teamName": TEAM_NAMES.get(team, team), "seasons": []}
    if idx_path.exists():
        idx = json.loads(idx_path.read_text())
    ids = {s["seasonId"] for s in idx["seasons"]}
    if season_id not in ids:
        idx["seasons"].append({
            "seasonId": season_id,
            "label": f"{season_id[:4]}-{season_id[6:]}",
        })
    idx["seasons"].sort(key=lambda s: s["seasonId"], reverse=True)
    idx_path.write_text(json.dumps(idx, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("season", nargs="?", default=None, help="e.g. 20262027")
    ap.add_argument("--team", default=None)
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config.json").read_text())
    team = args.team or cfg.get("team", "EDM")
    season_id = args.season or cfg.get("currentSeason") or season_auto()

    games = build_season(season_id, team)
    if not games:
        print("No regular-season games published yet for this season — nothing to write.")
        return

    n = merge_manual(games, season_id)
    played = sum(1 for g in games if g["result"])
    print(f"  {played} completed games, {n} manual flag values merged")

    out = {
        "seasonId": season_id,
        "label": f"{season_id[:4]}-{season_id[6:]}",
        "team": team,
        "teamName": TEAM_NAMES.get(team, team),
        "source": "nhl-api",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
    }
    outpath = ROOT / "docs" / "data" / f"{season_id}.json"
    outpath.write_text(json.dumps(out, indent=1))
    update_index(season_id, team)
    print(f"Wrote {outpath}")


if __name__ == "__main__":
    main()
