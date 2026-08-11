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

function renderCharts(league) {
  const monthKeys = sortMonthKeys(Object.keys(league.leagueMonthCounts));
  new Chart($("#monthChart"), {
    type: "bar",
    data: {
      labels: monthKeys,
      datasets: [{ data: monthKeys.map(k => league.leagueMonthCounts[k]), backgroundColor: "#0066cc" }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: "#e8e8e3" } }, x: { grid: { display: false } } },
    },
  });

  const dowKeys = DOW_ORDER.filter(d => d in league.leagueDowCounts);
  new Chart($("#dowChart"), {
    type: "bar",
    data: {
      labels: dowKeys,
      datasets: [{ data: dowKeys.map(k => league.leagueDowCounts[k]), backgroundColor: "#D14520" }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: "#e8e8e3" } }, x: { grid: { display: false } } },
    },
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
    renderEvents(events);
    renderCharts(league);
  } catch (e) {
    console.error(e);
    $("#recordLine").textContent = "Couldn't load league data. If you opened this file directly, serve the folder instead: python -m http.server";
  }
}
boot();
