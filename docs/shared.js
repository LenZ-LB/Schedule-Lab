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
