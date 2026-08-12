/* overview.js — league-wide summary */
"use strict";
const $ = (s, el = document) => el.querySelector(s);

function statCard(label, value, sub) {
  return `<div class="stat-card">
    <div class="st-label">${label}</div>
    <div class="st-value">${value}</div>
    ${sub ? `<div class="st-sub">${sub}</div>` : ""}
  </div>`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function avgOf(league, key) {
  const vals = Object.values(league.teamSummary).map(s => s[key]);
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function renderStats(league) {
  const teamCount = Object.keys(league.teamSummary).length;
  $("#statRow").innerHTML = [
    statCard("Total games", league.totalGames),
    statCard("Teams", teamCount),
    statCard("Season start", fmtDate(league.seasonStart)),
    statCard("Season end", fmtDate(league.seasonEnd)),
    statCard("Total B2B team-games", league.totalB2bTeamGames,
      "Each team's own back-to-backs, summed league-wide"),
  ].join("");

  $("#avgRow").innerHTML = `
    <table class="avg-table">
      <thead><tr>
        <th>Avg B2B</th><th>Avg 3-in-4</th><th>Avg 4-in-6</th><th>Avg 5-in-8</th>
        <th>Avg Waiting</th><th>Avg Tired</th><th>Avg Longest Trip</th>
        <th>Avg Longest Home Stand</th><th>Avg Miles</th><th>Avg TZ Hrs</th>
      </tr></thead>
      <tbody><tr>
        <td>${avgOf(league,"b2bCount")}</td>
        <td>${avgOf(league,"threeInFourCount")}</td>
        <td>${avgOf(league,"fourInSixCount")}</td>
        <td>${avgOf(league,"fiveInEightCount")}</td>
        <td>${avgOf(league,"waitingCount")}</td>
        <td>${avgOf(league,"tiredCount")}</td>
        <td>${avgOf(league,"longestRoadtrip")} gm</td>
        <td>${avgOf(league,"longestHomestand")} gm</td>
        <td>${Math.round(avgOf(league,"totalTravelMiles")).toLocaleString()}</td>
        <td>${avgOf(league,"tzHours")}</td>
      </tr></tbody>
    </table>`;
}

function renderEvents(events) {
  $("#eventCards").innerHTML = events.map(ev => {
    const dateStr = ev.endDate
      ? `${fmtDateShort(ev.date)} – ${fmtDateShort(ev.endDate)}`
      : fmtDateShort(ev.date);
    return `<div class="event-card">
      <div class="ev-date">${dateStr.toUpperCase()}</div>
      <div class="ev-matchup">${ev.title}</div>
      <div class="ev-time">${ev.detail}</div>
    </div>`;
  }).join("");
}

const MONTH_ORDER = ["Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul"];
function sortMonthKeys(keys) {
  return keys.sort((a, b) => {
    const [ma, ya] = a.split(" "), [mb, yb] = b.split(" ");
    if (ya !== yb) return ya - yb;
    return MONTH_ORDER.indexOf(ma) - MONTH_ORDER.indexOf(mb);
  });
}
const DOW_ORDER = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* ---- league comparison table --------------------------------------------
   Columns and whether a LOWER value is the favorable direction for that
   column (fewer B2Bs/travel/etc is good; more rest is good).
   One shared rank/shading implementation (shared.js) used here and
   wherever else a "vs league" comparison shows up, per the design system. */
const TABLE_COLS = [
  { key: "games", lowerIsBetter: null },
  { key: "b2bCount", lowerIsBetter: true },
  { key: "threeInFourCount", lowerIsBetter: true },
  { key: "fourInSixCount", lowerIsBetter: true },
  { key: "fiveInEightCount", lowerIsBetter: true },
  { key: "avgRestDays", lowerIsBetter: false },
  { key: "waitingCount", lowerIsBetter: false },
  { key: "tiredCount", lowerIsBetter: true },
  { key: "restVs", lowerIsBetter: false },
  { key: "longestRoadtrip", lowerIsBetter: true },
  { key: "longestHomestand", lowerIsBetter: false },
  { key: "totalTravelMiles", lowerIsBetter: true },
  { key: "tzHours", lowerIsBetter: true },
];
let sortState = { key: "team", dir: 1 };

function renderLeagueTable(league) {
  const teams = Object.keys(league.teamSummary);
  const rows = teams.map(name => ({ team: name, ...league.teamSummary[name] }));

  rows.sort((a, b) => {
    const k = sortState.key;
    if (k === "team") return sortState.dir * a.team.localeCompare(b.team);
    return sortState.dir * (a[k] - b[k]);
  });

  const colValues = {};
  for (const col of TABLE_COLS) colValues[col.key] = rows.map(r => r[col.key]);

  $("#leagueTable tbody").innerHTML = rows.map(r => {
    const cells = TABLE_COLS.map(col => {
      if (col.lowerIsBetter === null) return `<td class="num">${r[col.key]}</td>`;
      const bg = deltaBg(r[col.key], colValues[col.key], col.lowerIsBetter);
      const val = col.key === "totalTravelMiles" ? Math.round(r[col.key]).toLocaleString() : r[col.key];
      return `<td class="num" style="${bg}">${rankChip(val, colValues[col.key].map(v =>
        col.key === "totalTravelMiles" ? Math.round(v).toLocaleString() : v), col.lowerIsBetter)}</td>`;
    }).join("");
    return `<tr><td>${r.team}</td>${cells}</tr>`;
  }).join("");
}

function wireSortHeaders(league) {
  document.querySelectorAll("#leagueTable th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      sortState = { key, dir: sortState.key === key ? -sortState.dir : 1 };
      renderLeagueTable(league);
    });
  });
}

async function boot() {
  try {
    const [leagueRes, eventsRes] = await Promise.all([
      fetch("data/league/20262027.json"),
      fetch("data/league/special_events_20262027.json"),
    ]);
    if (!leagueRes.ok) throw new Error("league data not found");
    const league = await leagueRes.json();
    const events = eventsRes.ok ? (await eventsRes.json()).events : [];

    $("#pageTitle").textContent = `${league.seasonId.slice(0,4)}-${league.seasonId.slice(6)} League Overview`;
    const teamCount = Object.keys(league.teamSummary).length;
    $("#recordLine").innerHTML =
      `<strong>${league.totalGames}</strong> games · <strong>${teamCount}</strong> teams · ` +
      `${fmtDate(league.seasonStart)} \u2013 ${fmtDate(league.seasonEnd)}`;
    $("#updatedStamp").textContent = league.generated && !league.generated.startsWith("TEST")
      ? `Last updated: ${league.generated.slice(0, 10)}.`
      : "Placeholder data \u2014 pending the first live pipeline run.";

    renderStats(league);
    renderLeagueTable(league);
    wireSortHeaders(league);
    renderEvents(events);
  } catch (e) {
    console.error(e);
    $("#recordLine").textContent = "Couldn't load league data. If you opened this file directly, serve the folder instead: python -m http.server";
  }
}
boot();
