/* team-explorer.js — per-team drill-down across all 32 teams */
"use strict";
const $ = (s, el = document) => el.querySelector(s);

const state = { league: null, team: null };

function statCard(label, value, sub) {
  return `<div class="stat-card">
    <div class="st-label">${label}</div>
    <div class="st-value">${value}</div>
    ${sub ? `<div class="st-sub">${sub}</div>` : ""}
  </div>`;
}

function fmtDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SEGMENT_TAG_COLOR = {
  "All Road": "#8f0e0e", "Road Heavy": "#c0392b", "B2B Heavy": "#c0392b",
  "Homestand": "#1d4d8f", "Balanced": "#6b6b65",
};
function segmentColor(tags) {
  for (const t of ["All Road", "B2B Heavy", "Road Heavy", "Homestand"]) {
    if (tags.includes(t)) return SEGMENT_TAG_COLOR[t];
  }
  return SEGMENT_TAG_COLOR.Balanced;
}

function renderStats(s) {
  $("#statRow").innerHTML = [
    statCard("Games", s.games, `${s.home} home / ${s.away} away`),
    statCard("Back-to-backs", s.b2bCount),
    statCard("Avg rest days", s.avgRestDays),
    statCard("Longest homestand", s.longestHomestand + " games"),
    statCard("Longest road trip", s.longestRoadtrip + " games"),
    statCard("3-in-4 nights", s.threeInFourCount),
    statCard("4-in-6 nights", s.fourInSixCount),
    statCard("5-in-8 nights", s.fiveInEightCount),
    statCard("Total travel", Math.round(s.totalTravelMiles).toLocaleString() + " mi"),
    statCard("Timezone hours crossed", s.tzHours),
    statCard("Rest advantage", (s.restVs > 0 ? "+" : "") + s.restVs,
      `${s.tiredCount} games caught opponent tired \u00B7 ${s.waitingCount} we were the tired ones`),
  ].join("");
}

function renderToughest(stretch) {
  if (!stretch) { $("#toughestBody").innerHTML = "<p class=\"panel-sub\">Not enough games yet.</p>"; return; }
  $("#toughestBody").innerHTML = `
    <div class="stat-row">
      ${statCard("Window", `${fmtDateShort(stretch.startDate)} \u2013 ${fmtDateShort(stretch.endDate)}`)}
      ${statCard("Avg rest days", stretch.avgRestDays)}
      ${statCard("Road games", `${stretch.roadGames} of ${stretch.games}`)}
      ${statCard("Back-to-backs", stretch.b2bCount)}
      ${statCard("Travel miles", Math.round(stretch.miles).toLocaleString())}
    </div>
    <p class="panel-sub" style="margin-top:12px">Opponents: ${stretch.opponents.map((o, i) =>
      `${stretch.isHome[i] ? "" : "@"}${o}`).join(", ")}</p>`;
}

function renderSegments(segments) {
  $("#segmentStrip").innerHTML = segments.map(seg =>
    `<div class="segment-block" data-idx="${seg.index}" style="background:${segmentColor(seg.tags)}"
       title="${fmtDateShort(seg.startDate)}\u2013${fmtDateShort(seg.endDate)}">${seg.index}</div>`
  ).join("");

  $("#segmentStrip").querySelectorAll(".segment-block").forEach(el => {
    el.addEventListener("click", () => {
      const seg = segments.find(s => s.index === +el.dataset.idx);
      $("#segmentDetail").innerHTML = `
        <div class="segment-row" style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
          <strong>Segment ${seg.index}</strong> \u00B7 ${fmtDateShort(seg.startDate)} \u2013 ${fmtDateShort(seg.endDate)}
          ${seg.tags.map(t => `<span class="segment-tag-pill">${t}</span>`).join("")}
          <div class="stat-row" style="margin-top:10px">
            ${statCard("Games", seg.games)}
            ${statCard("Road", seg.roadGames)}
            ${statCard("B2B", seg.b2bCount)}
            ${statCard("Avg rest", seg.avgRestDays ?? "\u2014")}
            ${statCard("TZ hours", seg.tzHours)}
            ${statCard("Miles", Math.round(seg.miles).toLocaleString())}
          </div>
          <p class="panel-sub" style="margin-top:8px">Opponents: ${seg.opponents.map((o, i) =>
            `${seg.isHome[i] ? "" : "@"}${o}`).join(", ")}</p>
        </div>`;
    });
  });
}

function renderOpponents(matchups) {
  const rows = Object.entries(matchups).sort((a, b) => b[1].total - a[1].total);
  $("#oppTable tbody").innerHTML = rows.map(([opp, m]) =>
    `<tr class="opp-row"><td>${opp}</td><td class="num">${m.total}</td><td class="num">${m.home}</td><td class="num">${m.away}</td></tr>`
  ).join("");
}

function showTeam(teamName) {
  state.team = teamName;
  const s = state.league.teamSummary[teamName];
  if (!s) return;
  $("#teamPanelLabel").textContent = `${teamName} \u2014 Season at a Glance`;
  renderStats(s);
  renderToughest(s.toughestStretch);
  renderSegments(s.segments);
  renderOpponents(s.opponentMatchups);
}

async function boot() {
  try {
    const res = await fetch("data/league/20262027.json");
    if (!res.ok) throw new Error("league data not found");
    state.league = await res.json();
    const sel = $("#teamSelect");
    sel.innerHTML = state.league.teams.map(t => `<option value="${t}">${t}</option>`).join("");
    sel.addEventListener("change", () => showTeam(sel.value));
    $("#updatedStamp").textContent = state.league.generated && !state.league.generated.startsWith("TEST")
      ? `Last updated: ${state.league.generated.slice(0, 10)}.`
      : "Placeholder data \u2014 pending the first live pipeline run.";
    showTeam(state.league.teams[0]);
  } catch (e) {
    console.error(e);
    $("#statRow").innerHTML = "<p>Couldn't load league data. If you opened this file directly, serve the folder instead: python -m http.server</p>";
  }
}
boot();
