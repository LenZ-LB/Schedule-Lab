"""
Schedule Lab API — serves game/manual-flag data from Postgres to the static
GitHub Pages frontend, and accepts writes from the pipeline (admin key) and
the editor (editor key).

Design notes (see api/README.md for the full setup walkthrough):
  - games and manual_flags are separate tables and this API never lets a
    write to one touch the other -- same separation the old file-based
    design had, now enforced structurally rather than by convention.
  - Reads are open (schedule stats aren't sensitive); writes require an
    API key sent as `X-API-Key`, checked against a hash stored in the DB
    (the raw key is never stored anywhere -- see scripts/make_key.py).
  - CORS is scoped to a specific origin (set via ALLOWED_ORIGIN), not "*",
    to keep this from being trivially embeddable/scriptable by anyone who
    stumbles on the API URL -- consistent with the site staying unlisted.
"""
import hashlib
import os
from datetime import date
from typing import Optional

import asyncpg
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATABASE_URL = os.environ["DATABASE_URL"]
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://lenz-lb.github.io")

app = FastAPI(title="Schedule Lab API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["X-API-Key", "Content-Type"],
)

pool: Optional[asyncpg.Pool] = None


@app.on_event("startup")
async def startup():
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)


@app.on_event("shutdown")
async def shutdown():
    if pool:
        await pool.close()


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def require_scope(scope: str, x_api_key: str = Header(...)):
    """Dependency that checks the provided key hashes to an active row with
    the required scope. Raises 401/403 rather than returning a bool, so a
    missing/failed check always short-circuits the request."""
    row = await pool.fetchrow(
        "SELECT scope, revoked_at FROM api_keys WHERE key_hash = $1",
        hash_key(x_api_key),
    )
    if not row or row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    if row["scope"] != scope and not (scope == "editor" and row["scope"] == "admin"):
        # admin keys can do anything an editor key can, not vice versa
        raise HTTPException(status_code=403, detail=f"Key does not have '{scope}' scope")


async def require_admin(x_api_key: str = Header(...)):
    await require_scope("admin", x_api_key)


async def require_editor(x_api_key: str = Header(...)):
    await require_scope("editor", x_api_key)


# ---- read: merged season data -------------------------------------------

# camelCase keys matching what the frontend already expects from the old
# JSON files -- this means app.js/shared.js need zero changes beyond the
# fetch URL itself.
GAME_ROW_MAP = {
    "game_number": "game", "game_id": "gameId", "date": "date",
    "day_of_week": "dayOfWeek", "home_away": "homeAway", "opponent": "opponent",
    "opponent_name": "opponentName", "time_local": "timeLocal",
    "venue_time_local": "venueTimeLocal", "result": "result", "gf": "gf",
    "ga": "ga", "diff": "diff", "margin_bucket": "marginBucket",
    "rest_days": "restDays", "b2b": "b2b", "three_in_4": "threeIn4",
    "tz_change": "tzChange", "venue_tz": "venueTz", "lead_after_1": "leadAfter1",
    "lead_after_2": "leadAfter2", "scored_first": "scoredFirst",
    "won_third": "wonThird", "fo50": "fo50", "fo_pct": "foPct", "moon": "moon",
    "opp_rest_days": "oppRestDays", "opp_b2b": "oppB2B",
    "opp_three_in_4": "oppThreeIn4", "rest_advantage": "restAdvantage",
}
MANUAL_ROW_MAP = {
    "mdo": "mdo", "morning_skate": "morningSkate", "day_before_skate": "dayBeforeSkate",
    "early_arrival": "earlyArrival", "hotel_far": "hotelFar",
    "special_teams_win": "specialTeamsWin", "special_teams_tie": "specialTeamsTie",
    "contested_fo_win": "contestedFoWin", "eleven_f7d": "elevenF7D", "notes": "notes",
}


@app.get("/api/season/{season_id}")
async def get_season(season_id: str):
    rows = await pool.fetch(
        """
        SELECT g.*, m.mdo, m.morning_skate, m.day_before_skate, m.early_arrival,
               m.hotel_far, m.special_teams_win, m.special_teams_tie,
               m.contested_fo_win, m.eleven_f7d, m.notes
        FROM games g
        LEFT JOIN manual_flags m ON m.season_id = g.season_id AND m.date = g.date
        WHERE g.season_id = $1
        ORDER BY g.date
        """,
        season_id,
    )
    games = []
    for r in rows:
        g = {}
        for col, key in GAME_ROW_MAP.items():
            v = r[col]
            g[key] = v.isoformat() if isinstance(v, date) else v
        # manual fields overlay the automated defaults -- null in manual_flags
        # (never edited) falls back to whatever games already had, matching
        # the old client-side mergeManualFlags() behavior exactly.
        for col, key in MANUAL_ROW_MAP.items():
            if r[col] is not None:
                g[key] = r[col]
        games.append(g)
    return {"seasonId": season_id, "games": games}


@app.get("/health")
async def health():
    await pool.fetchval("SELECT 1")
    return {"status": "ok"}


# ---- admin write: pipeline upserts games ---------------------------------

class GameIn(BaseModel):
    game: int
    gameId: Optional[int] = None
    date: str
    dayOfWeek: Optional[str] = None
    homeAway: str
    opponent: str
    opponentName: Optional[str] = None
    timeLocal: Optional[str] = None
    venueTimeLocal: Optional[str] = None
    result: Optional[str] = None
    gf: Optional[int] = None
    ga: Optional[int] = None
    diff: Optional[int] = None
    marginBucket: Optional[str] = None
    restDays: Optional[int] = None
    b2b: bool = False
    threeIn4: bool = False
    tzChange: int = 0
    venueTz: Optional[str] = None
    leadAfter1: Optional[bool] = None
    leadAfter2: Optional[bool] = None
    scoredFirst: Optional[bool] = None
    wonThird: Optional[bool] = None
    fo50: Optional[bool] = None
    foPct: Optional[float] = None
    moon: Optional[str] = None
    oppRestDays: Optional[int] = None
    oppB2B: Optional[bool] = None
    oppThreeIn4: Optional[bool] = None
    restAdvantage: Optional[int] = None


class SeasonIn(BaseModel):
    games: list[GameIn]


UPSERT_GAME_SQL = """
INSERT INTO games (
    season_id, date, game_number, game_id, day_of_week, home_away, opponent,
    opponent_name, time_local, venue_time_local, result, gf, ga, diff,
    margin_bucket, rest_days, b2b, three_in_4, tz_change, venue_tz,
    lead_after_1, lead_after_2, scored_first, won_third, fo50, fo_pct, moon,
    opp_rest_days, opp_b2b, opp_three_in_4, rest_advantage, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, now()
)
ON CONFLICT (season_id, date) DO UPDATE SET
    game_number = EXCLUDED.game_number, game_id = EXCLUDED.game_id,
    day_of_week = EXCLUDED.day_of_week, home_away = EXCLUDED.home_away,
    opponent = EXCLUDED.opponent, opponent_name = EXCLUDED.opponent_name,
    time_local = EXCLUDED.time_local, venue_time_local = EXCLUDED.venue_time_local,
    result = EXCLUDED.result, gf = EXCLUDED.gf, ga = EXCLUDED.ga, diff = EXCLUDED.diff,
    margin_bucket = EXCLUDED.margin_bucket, rest_days = EXCLUDED.rest_days,
    b2b = EXCLUDED.b2b, three_in_4 = EXCLUDED.three_in_4, tz_change = EXCLUDED.tz_change,
    venue_tz = EXCLUDED.venue_tz, lead_after_1 = EXCLUDED.lead_after_1,
    lead_after_2 = EXCLUDED.lead_after_2, scored_first = EXCLUDED.scored_first,
    won_third = EXCLUDED.won_third, fo50 = EXCLUDED.fo50, fo_pct = EXCLUDED.fo_pct,
    moon = EXCLUDED.moon, opp_rest_days = EXCLUDED.opp_rest_days,
    opp_b2b = EXCLUDED.opp_b2b, opp_three_in_4 = EXCLUDED.opp_three_in_4,
    rest_advantage = EXCLUDED.rest_advantage, updated_at = now()
"""


@app.post("/api/admin/season/{season_id}", dependencies=[Depends(require_admin)])
async def upsert_season(season_id: str, body: SeasonIn):
    async with pool.acquire() as conn:
        async with conn.transaction():
            for g in body.games:
                await conn.execute(
                    UPSERT_GAME_SQL,
                    season_id, g.date, g.game, g.gameId, g.dayOfWeek, g.homeAway,
                    g.opponent, g.opponentName, g.timeLocal, g.venueTimeLocal,
                    g.result, g.gf, g.ga, g.diff, g.marginBucket, g.restDays,
                    g.b2b, g.threeIn4, g.tzChange, g.venueTz, g.leadAfter1,
                    g.leadAfter2, g.scoredFirst, g.wonThird, g.fo50, g.foPct,
                    g.moon, g.oppRestDays, g.oppB2B, g.oppThreeIn4, g.restAdvantage,
                )
    return {"upserted": len(body.games)}


# ---- editor write: manual flags -------------------------------------------

class ManualFlagsIn(BaseModel):
    mdo: Optional[bool] = None
    morningSkate: Optional[bool] = None
    dayBeforeSkate: Optional[bool] = None
    earlyArrival: Optional[bool] = None
    hotelFar: Optional[bool] = None
    specialTeamsWin: Optional[bool] = None
    specialTeamsTie: Optional[bool] = None
    contestedFoWin: Optional[bool] = None
    elevenF7D: Optional[bool] = None
    notes: Optional[str] = None


class BulkManualIn(BaseModel):
    games: dict[str, ManualFlagsIn]  # date -> flags


UPSERT_MANUAL_SQL = """
INSERT INTO manual_flags (
    season_id, date, mdo, morning_skate, day_before_skate, early_arrival,
    hotel_far, special_teams_win, special_teams_tie, contested_fo_win,
    eleven_f7d, notes, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
ON CONFLICT (season_id, date) DO UPDATE SET
    mdo = EXCLUDED.mdo, morning_skate = EXCLUDED.morning_skate,
    day_before_skate = EXCLUDED.day_before_skate, early_arrival = EXCLUDED.early_arrival,
    hotel_far = EXCLUDED.hotel_far, special_teams_win = EXCLUDED.special_teams_win,
    special_teams_tie = EXCLUDED.special_teams_tie,
    contested_fo_win = EXCLUDED.contested_fo_win, eleven_f7d = EXCLUDED.eleven_f7d,
    notes = EXCLUDED.notes, updated_at = now()
"""


@app.put("/api/manual/{season_id}/{game_date}", dependencies=[Depends(require_editor)])
async def upsert_manual_flag(season_id: str, game_date: str, body: ManualFlagsIn):
    await pool.execute(
        UPSERT_MANUAL_SQL,
        season_id, game_date, body.mdo, body.morningSkate, body.dayBeforeSkate,
        body.earlyArrival, body.hotelFar, body.specialTeamsWin, body.specialTeamsTie,
        body.contestedFoWin, body.elevenF7D, body.notes,
    )
    return {"updated": game_date}


@app.put("/api/manual/{season_id}", dependencies=[Depends(require_editor)])
async def upsert_manual_flags_bulk(season_id: str, body: BulkManualIn):
    async with pool.acquire() as conn:
        async with conn.transaction():
            for game_date, flags in body.games.items():
                await conn.execute(
                    UPSERT_MANUAL_SQL,
                    season_id, game_date, flags.mdo, flags.morningSkate,
                    flags.dayBeforeSkate, flags.earlyArrival, flags.hotelFar,
                    flags.specialTeamsWin, flags.specialTeamsTie,
                    flags.contestedFoWin, flags.elevenF7D, flags.notes,
                )
    return {"updated": len(body.games)}
