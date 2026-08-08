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
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://api-web.nhle.com/v1"
ROOT = Path(__file__).resolve().parent.parent

# venue timezone LABEL by home team — for display chips/grouping only.
TEAM_TZ = {
    "BOS": "ET", "BUF": "ET", "CAR": "ET", "CBJ": "ET", "DET": "ET", "FLA": "ET",
    "MTL": "ET", "NJD": "ET", "NYI": "ET", "NYR": "ET", "OTT": "ET", "PHI": "ET",
    "PIT": "ET", "TBL": "ET", "TOR": "ET", "WSH": "ET",
    "CHI": "CT", "DAL": "CT", "MIN": "CT", "NSH": "CT", "STL": "CT", "WPG": "CT",
    "CGY": "MT", "COL": "MT", "EDM": "MT", "ARI": "MT", "UTA": "MT", "UTM": "MT",
    "ANA": "PT", "LAK": "PT", "SJS": "PT", "SEA": "PT", "VAN": "PT", "VGK": "PT",
}

# Real IANA zone per team's arena — the source of truth for all time-of-day
# math. Converting a UTC timestamp through this handles daylight saving
# correctly on its own, with no dependence on any offset field the API
# returns. Arizona doesn't observe DST; every other NHL market does, on the
# same dates, so this is exact everywhere it matters.
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
    "ARI": "America/Phoenix", "UTA": "America/Denver", "UTM": "America/Denver",
    "ANA": "America/Los_Angeles", "LAK": "America/Los_Angeles", "SJS": "America/Los_Angeles",
    "SEA": "America/Los_Angeles", "VAN": "America/Vancouver", "VGK": "America/Los_Angeles",
}
TZ_OFFSET = {"ET": 0, "CT": -1, "MT": -2, "PT": -3}  # relative hours vs ET (display grouping only)

MANUAL_FIELDS = ("mdo", "morningSkate", "dayBeforeSkate", "earlyArrival",
                 "elevenF7D", "contestedFoWin", "specialTeamsWin",
                 "specialTeamsTie", "notes")


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
    """Fetch gamecenter landing for period leads, first goal, and the
    special-teams goal battle (PP + SH goals for vs against)."""
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
            continue
        us_cum += p.get(us_key, 0) or 0
        them_cum += p.get(them_key, 0) or 0
        per.append((us_cum, them_cum))
    if len(per) >= 1:
        out["leadAfter1"] = per[0][0] > per[0][1]
    if len(per) >= 2:
        out["leadAfter2"] = per[1][0] > per[1][1]
    if len(per) >= 3:
        out["wonThird"] = (per[2][0] - per[1][0]) > (per[2][1] - per[1][1])

    # first goal + special-teams battle, from scoring plays
    st_for = st_against = 0
    first_done = False
    try:
        for period in (summ.get("scoring") or []):
            for goal in (period.get("goals") or []):
                ab = goal.get("teamAbbrev")
                if isinstance(ab, dict):
                    ab = ab.get("default")
                ours = (ab == team)
                if not first_done:
                    out["scoredFirst"] = ours
                    first_done = True
                strength = (goal.get("strength") or goal.get("goalModifier") or "").lower()
                # NHL API marks non-even goals as "pp" / "sh"; even as "ev"/"even"
                if strength in ("pp", "powerplay", "power-play", "sh", "shorthanded", "short-handed"):
                    if ours:
                        st_for += 1
                    else:
                        st_against += 1
        out["specialTeamsWin"] = st_for > st_against
        out["specialTeamsTie"] = st_for == st_against and (st_for + st_against) > 0
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
    # gameType 2 = regular season, but some feeds include preseason exhibition
    # games tagged as 2. Filter to Oct-Apr using the season year as anchor.
    start_year = int(season_id[:4])
    # regular season runs Oct of start_year through Apr of start_year+1
    season_start = f"{start_year}-09-30"   # nothing before Oct 1
    season_end   = f"{start_year + 1}-05-01"  # nothing after Apr 30
    raw = [
        g for g in sched.get("games", [])
        if g.get("gameType") == 2
        and season_start < g.get("gameDate", "") < season_end
    ]
    raw.sort(key=lambda g: g.get("gameDate", ""))
    print(f"{season_id}: {len(raw)} regular-season games (Oct–Apr)")

    games = []
    prev_date = None
    home_iana = TEAM_IANA.get(team, "America/New_York")
    prev_venue_iana = home_iana  # season starts from home base
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
        venue_iana = TEAM_IANA.get(h_ab, "America/New_York")

        rest = None if prev_date is None else (d - prev_date).days - 1
        recent_dates.append(d)
        recent_dates = [x for x in recent_dates if (d - x).days <= 3]
        three_in4 = len(recent_dates) >= 3

        # local start time in the club's home timezone — converted straight
        # from the UTC timestamp via the IANA database, so DST is handled
        # correctly for the actual game date without trusting any offset
        # field from the API.
        time_local = None
        utc_dt = None
        st = g.get("startTimeUTC")
        if st:
            try:
                utc_dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
                time_local = utc_dt.astimezone(ZoneInfo(home_iana)).strftime("%H:%M")
            except Exception:
                pass

        # TZ change vs the previous game's venue, in real (DST-aware) hours
        tz_change = 0
        if utc_dt is not None:
            try:
                cur_off = utc_dt.astimezone(ZoneInfo(venue_iana)).utcoffset().total_seconds() / 3600
                prev_off = utc_dt.astimezone(ZoneInfo(prev_venue_iana)).utcoffset().total_seconds() / 3600
                tz_change = round(cur_off - prev_off)
            except Exception:
                pass

        game = {
            "game": i,
            "gameId": g.get("id"),
            "date": date_str,
            "dayOfWeek": d.strftime("%A"),
            "homeAway": "h" if is_home else "a",
            "opponent": opp,
            "opponentName": opp,
            "timeLocal": time_local,
            "result": None, "gf": None, "ga": None, "diff": None,
            "marginBucket": None,
            "restDays": rest,
            "b2b": rest == 0 if rest is not None else False,
            "threeIn4": three_in4,
            "earlyArrival": None,
            "tzChange": tz_change,
            "venueTz": venue_tz,
            "leadAfter1": None, "leadAfter2": None,
            "scoredFirst": None, "wonThird": None,
            "specialTeamsWin": None, "specialTeamsTie": None,
            "fo50": None, "foPct": None, "contestedFoWin": None,
            "elevenF7D": None, "mdo": None, "morningSkate": None,
            "dayBeforeSkate": None,
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
                m = abs(gf - ga)
                game["marginBucket"] = None if m == 0 else (1 if m == 1 else 2 if m == 2 else 3)
                game.update(linescore_fields(g.get("id"), team, game["homeAway"]))
                game.update(faceoff_fields(g.get("id"), game["homeAway"]))

        games.append(game)
        prev_date = d
        prev_venue_iana = venue_iana

    return games


def merge_manual(games, season_id):
    path = ROOT / "data" / "manual_flags" / f"{season_id}.json"
    if not path.exists():
        return 0
    flags = json.loads(path.read_text())
    by_date = {g["date"]: g for g in games}
    n = 0
    for date_str, fields in flags.items():
        if date_str.startswith("_"):
            continue  # comment/metadata keys
        g = by_date.get(date_str)
        if not g:
            print(f"  ! manual flag date {date_str} not on schedule", file=sys.stderr)
            continue
        for k, v in fields.items():
            if k in MANUAL_FIELDS:
                g[k] = v
                n += 1
    return n


def update_index(season_id):
    """Keep docs/data/index.json listing all available seasons."""
    idx_path = ROOT / "docs" / "data" / "index.json"
    try:
        idx = json.loads(idx_path.read_text()) if idx_path.exists() else {"seasons": []}
    except Exception as e:
        print(f"  ! could not read index.json, creating fresh: {e}", file=sys.stderr)
        idx = {"seasons": []}
    ids = {s["seasonId"] for s in idx.get("seasons", [])}
    if season_id not in ids:
        idx.setdefault("seasons", []).append({
            "seasonId": season_id,
            "label": f"{season_id[:4]}-{season_id[6:]}",
        })
        print(f"  Added {season_id} to index.json")
    else:
        print(f"  {season_id} already in index.json")
    idx["seasons"].sort(key=lambda s: s["seasonId"], reverse=True)
    try:
        idx_path.write_text(json.dumps(idx, indent=1))
        print(f"  index.json updated: {[s['seasonId'] for s in idx['seasons']]}")
    except Exception as e:
        print(f"  ! failed to write index.json: {e}", file=sys.stderr)
        raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("season", nargs="?", default=None, help="e.g. 20262027")
    ap.add_argument("--team", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch + compute, write to /tmp instead of docs/data")
    ap.add_argument("--force", action="store_true",
                    help="allow overwriting a hand-imported season")
    args = ap.parse_args()

    import os
    cfg = json.loads((ROOT / "config.json").read_text())
    team = args.team or os.environ.get("TEAM_CODE")
    if not team:
        local = ROOT / "config.local.json"
        if local.exists():
            team = json.loads(local.read_text()).get("team")
    if not team:
        sys.exit("No team configured. Pass --team XXX, set the TEAM_CODE env var, "
                 "or create config.local.json (see config.local.json.example). "
                 "The team code is deliberately kept out of the repository.")
    team = team.upper()
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
        "source": "nhl-api",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
    }
    outpath = ROOT / "docs" / "data" / f"{season_id}.json"
    if args.dry_run:
        outpath = Path("/tmp") / f"{season_id}.dryrun.json"
        outpath.write_text(json.dumps(out, indent=1))
        print(f"[dry run] wrote {outpath} — docs/data untouched")
        return
    if outpath.exists() and not args.force:
        existing = json.loads(outpath.read_text())
        if existing.get("source") == "manual-import":
            sys.exit(f"{outpath.name} was imported from the original workbooks and "
                     "contains hand-tracked fields the API can't reproduce. "
                     "Refusing to overwrite it. Use --force if you really mean to.")
    outpath.write_text(json.dumps(out, indent=1))
    update_index(season_id)
    print(f"Wrote {outpath}")


if __name__ == "__main__":
    main()
