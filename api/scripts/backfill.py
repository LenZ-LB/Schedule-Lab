#!/usr/bin/env python3
"""
One-time backfill: reads the existing docs/data/<season>.json and
docs/data/manual/<season>.json files and loads them into Postgres.

Run this once per season, after the schema migration (001_init.sql) has
been applied, and before switching the frontend/pipeline over to the API.

Usage:
    DATABASE_URL=postgresql://... python scripts/backfill.py 20262027
    DATABASE_URL=postgresql://... python scripts/backfill.py 20262027 --dry-run
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parent.parent.parent  # repo root


async def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python backfill.py <season_id> [--dry-run]")
    season_id = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    games_path = ROOT / "docs" / "data" / f"{season_id}.json"
    manual_path = ROOT / "docs" / "data" / "manual" / f"{season_id}.json"

    if not games_path.exists():
        sys.exit(f"No such file: {games_path}")

    games = json.loads(games_path.read_text())["games"]
    manual = {}
    if manual_path.exists():
        raw_manual = json.loads(manual_path.read_text())
        manual = {k: v for k, v in raw_manual.items() if not k.startswith("_")}

    print(f"Loaded {len(games)} games and {len(manual)} manual-flag entries for {season_id}")

    if dry_run:
        print("--dry-run: not writing to the database.")
        return

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        sys.exit("Set DATABASE_URL to your Fly Postgres connection string first.")

    conn = await asyncpg.connect(database_url)
    try:
        async with conn.transaction():
            for g in games:
                await conn.execute(
                    """
                    INSERT INTO games (
                        season_id, date, game_number, game_id, day_of_week, home_away,
                        opponent, opponent_name, time_local, venue_time_local, result,
                        gf, ga, diff, margin_bucket, rest_days, b2b, three_in_4,
                        tz_change, venue_tz, lead_after_1, lead_after_2, scored_first,
                        won_third, fo50, fo_pct, moon, opp_rest_days, opp_b2b,
                        opp_three_in_4, rest_advantage
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
                    )
                    ON CONFLICT (season_id, date) DO NOTHING
                    """,
                    season_id, g["date"], g["game"], g.get("gameId"), g.get("dayOfWeek"),
                    g["homeAway"], g["opponent"], g.get("opponentName"), g.get("timeLocal"),
                    g.get("venueTimeLocal"), g.get("result"), g.get("gf"), g.get("ga"),
                    g.get("diff"), g.get("marginBucket"), g.get("restDays"),
                    g.get("b2b", False), g.get("threeIn4", False), g.get("tzChange", 0),
                    g.get("venueTz"), g.get("leadAfter1"), g.get("leadAfter2"),
                    g.get("scoredFirst"), g.get("wonThird"), g.get("fo50"), g.get("foPct"),
                    g.get("moon"), g.get("oppRestDays"), g.get("oppB2B"),
                    g.get("oppThreeIn4"), g.get("restAdvantage"),
                )

            for game_date, flags in manual.items():
                await conn.execute(
                    """
                    INSERT INTO manual_flags (
                        season_id, date, mdo, morning_skate, day_before_skate,
                        early_arrival, hotel_far, special_teams_win, special_teams_tie,
                        contested_fo_win, eleven_f7d, notes
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    ON CONFLICT (season_id, date) DO NOTHING
                    """,
                    season_id, game_date, flags.get("mdo"), flags.get("morningSkate"),
                    flags.get("dayBeforeSkate"), flags.get("earlyArrival"),
                    flags.get("hotelFar"), flags.get("specialTeamsWin"),
                    flags.get("specialTeamsTie"), flags.get("contestedFoWin"),
                    flags.get("elevenF7D"), flags.get("notes"),
                )
        print(f"Backfill complete for {season_id}.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
