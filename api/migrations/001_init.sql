-- Schedule Lab database schema
--
-- Two tables, deliberately kept separate:
--   games         -- everything the pipeline computes from the NHL API.
--                    Safe to overwrite on every pipeline run.
--   manual_flags  -- everything a human enters by hand. The pipeline NEVER
--                    writes to this table. This is the same separation the
--                    old file-based design had (docs/data/*.json vs
--                    docs/data/manual/*.json) -- just enforced at the
--                    database level now instead of by convention.
--
-- Both tables are keyed on (season_id, date) rather than an opaque game id,
-- since that's the natural key the pipeline already uses and it makes the
-- upsert logic trivial to reason about.

CREATE TABLE IF NOT EXISTS games (
    season_id       text        NOT NULL,
    date            date        NOT NULL,
    game_number     integer     NOT NULL,
    game_id         bigint,
    day_of_week     text,
    home_away       text        NOT NULL CHECK (home_away IN ('h', 'a')),
    opponent        text        NOT NULL,
    opponent_name   text,
    time_local      text,
    venue_time_local text,
    result          text,
    gf              integer,
    ga              integer,
    diff            integer,
    margin_bucket   text,
    rest_days       integer,
    b2b             boolean     NOT NULL DEFAULT false,
    three_in_4      boolean     NOT NULL DEFAULT false,
    tz_change       integer     NOT NULL DEFAULT 0,
    venue_tz        text,
    lead_after_1    boolean,
    lead_after_2    boolean,
    scored_first    boolean,
    won_third       boolean,
    fo50            boolean,
    fo_pct          numeric,
    moon            text,
    opp_rest_days   integer,
    opp_b2b         boolean,
    opp_three_in_4  boolean,
    rest_advantage  integer,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season_id, date)
);

CREATE INDEX IF NOT EXISTS idx_games_season ON games (season_id);

CREATE TABLE IF NOT EXISTS manual_flags (
    season_id           text        NOT NULL,
    date                date        NOT NULL,
    mdo                 boolean,
    morning_skate        boolean,
    day_before_skate     boolean,
    early_arrival        boolean,
    hotel_far            boolean,
    special_teams_win    boolean,
    special_teams_tie    boolean,
    contested_fo_win     boolean,
    eleven_f7d           boolean,
    notes                text,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season_id, date)
);

-- API keys: one row per key, so the admin (pipeline) key and the editor
-- (hand-entry) key can be rotated independently without redeploying code.
-- "scope" gates which endpoints a key is allowed to call.
CREATE TABLE IF NOT EXISTS api_keys (
    key_hash    text        PRIMARY KEY,   -- sha256 of the actual key, never store it raw
    scope       text        NOT NULL CHECK (scope IN ('admin', 'editor')),
    label       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz
);
