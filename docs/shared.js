/* shared.js — manual-flag field list + merge logic, shared by app.js and editor.js */
"use strict";

// The fields a human enters by hand — everything else is computed from the
// NHL API. Keep this list identical to what the editor form offers.
const MANUAL_FIELDS = [
  "mdo", "morningSkate", "dayBeforeSkate", "earlyArrival", "hotelFar",
  "specialTeamsWin", "specialTeamsTie", "contestedFoWin", "elevenF7D", "notes",
];

// Merge a { "YYYY-MM-DD": {field: value, ...}, ... } manual-flags object
// into an array of game objects (matched by date). Returns the count of
// individual field values applied, for logging/debugging.
function mergeManualFlags(games, flags) {
  if (!flags) return 0;
  const byDate = {};
  for (const g of games) byDate[g.date] = g;
  let n = 0;
  for (const dateStr of Object.keys(flags)) {
    if (dateStr.startsWith("_")) continue; // comment/metadata keys
    const g = byDate[dateStr];
    if (!g) continue; // date not on this season's schedule
    const fields = flags[dateStr];
    for (const k of Object.keys(fields)) {
      if (MANUAL_FIELDS.includes(k)) { g[k] = fields[k]; n++; }
    }
  }
  return n;
}

/* ---- rank chip / diverging shading -------------------------------------
   One shared implementation for every "how does this number compare to
   the league" display, per the design system: top ~19% of the field is
   good, bottom ~19% is bad, everything else stays neutral. Always computed
   fresh from whatever the current field is -- never a hardcoded threshold. */

// Returns "good", "bad", or "" (neutral) for a value within a field of values.
function rankClass(value, allValues, lowerIsBetter) {
  const sorted = [...allValues].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 5) return ""; // too small a field for percentile ranking to mean anything
  const cut = Math.max(1, Math.round(n * 0.19));
  const lowSet = sorted.slice(0, cut);
  const highSet = sorted.slice(n - cut);
  const inLow = lowSet.includes(value);
  const inHigh = highSet.includes(value);
  if (!inLow && !inHigh) return "";
  const isGood = lowerIsBetter ? inLow : inHigh;
  return isGood ? "good" : "bad";
}

// Small badge: value + a good/bad tint when it's in the top/bottom ~19%.
function rankChip(value, allValues, lowerIsBetter, { large = false } = {}) {
  const cls = rankClass(value, allValues, lowerIsBetter);
  const base = large ? "rank-chip-lg" : "rank-chip";
  return `<span class="${base}${cls ? " rank-" + cls : ""}">${value}</span>`;
}

// Diverging background color for a table cell: intensity scales with
// distance from the field's mean, capped so near-average cells stay
// neutral and extreme cells don't go to full-saturation solid color.
function deltaBg(value, allValues, lowerIsBetter) {
  const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const maxDev = Math.max(...allValues.map(v => Math.abs(v - mean))) || 1;
  const dev = value - mean;
  if (Math.abs(dev) < maxDev * 0.03) return ""; // near-average: leave neutral
  const intensity = Math.min(Math.abs(dev) / maxDev, 1);
  const alpha = (0.08 + intensity * 0.28).toFixed(3);
  const isGood = lowerIsBetter ? dev < 0 : dev > 0;
  return isGood ? `background:rgba(10,90,180,${alpha});` : `background:rgba(192,57,43,${alpha});`;
}

// Rank position (1 = best) + league average, for the "#7 Avg 14.2" line
// under a stat card. Ties resolve to the first matching position.
function rankInfo(value, allValues, lowerIsBetter) {
  const sorted = [...allValues].sort((a, b) => lowerIsBetter ? a - b : b - a);
  const rank = sorted.indexOf(value) + 1;
  const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const round1 = Math.round(avg * 10) / 10;
  return { rank, n: allValues.length, avg: round1, cls: rankClass(value, allValues, lowerIsBetter) };
}

/* ---- data source: static JSON files (default) or a live API ------------
   SCHEDULE_API_URL is set in config.js. Empty string (the default) means
   "keep using the static JSON files" -- nothing here changes behavior until
   that's actually pointed at a deployed Fly API. This is the one place
   that decision lives, so app.js and editor.js don't need to know which
   mode they're in. */
async function fetchSeasonData(seasonId) {
  const apiUrl = window.SCHEDULE_API_URL;
  if (apiUrl) {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/season/${seasonId}`);
    if (!res.ok) throw new Error(`API returned ${res.status} for season ${seasonId}`);
    const data = await res.json();
    return { season: data, manualAlreadyMerged: true };
  }
  const res = await fetch(`data/${seasonId}.json`);
  if (!res.ok) throw new Error(`data/${seasonId}.json not found`);
  const season = await res.json();
  try {
    const mres = await fetch(`data/manual/${seasonId}.json?t=${Date.now()}`, { cache: "no-store" });
    if (mres.ok) mergeManualFlags(season.games, await mres.json());
  } catch (e) { /* no manual flags yet for this season — fine */ }
  return { season, manualAlreadyMerged: false };
}
