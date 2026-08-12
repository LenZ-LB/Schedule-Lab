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

function statCardRanked(label, value, allValues, lowerIsBetter, opts = {}) {
  const info = rankInfo(value, allValues, lowerIsBetter);
  const badgeCls = info.cls ? ` rank-${info.cls}` : "";
  const fmt = opts.fmt || (v => v);
  return `<div class="stat-card">
    <div class="st-label">${label}</div>
    <div class="st-value">${fmt(value)}${opts.unit || ""}</div>
    <div class="st-sub"><span class="rank-chip${badgeCls}">#${info.rank}</span> Avg ${fmt(info.avg)}</div>
  </div>`;
}

function leagueValuesFor(league, key) {
  return Object.values(league.teamSummary).map(s => s[key]);
}

const milesF = v => Math.round(v).toLocaleString();

function renderStats(s, league) {
  const L = key => leagueValuesFor(league, key);
  $("#statRow").innerHTML = [
    statCard("Games", s.games, `${s.home} home / ${s.away} away`),
    statCardRanked("B2B", s.b2bCount, L("b2bCount"), true),
    statCardRanked("3-in-4", s.threeInFourCount, L("threeInFourCount"), true),
    statCardRanked("4-in-6", s.fourInSixCount, L("fourInSixCount"), true),
    statCardRanked("5-in-8", s.fiveInEightCount, L("fiveInEightCount"), true),
    statCardRanked("Avg rest days", s.avgRestDays, L("avgRestDays"), false),
    statCardRanked("Waiting", s.waitingCount, L("waitingCount"), false),
    statCardRanked("Tired", s.tiredCount, L("tiredCount"), true),
    statCardRanked("Rest vs", s.restVs, L("restVs"), false,
      { fmt: v => (v > 0 ? "+" : "") + v }),
    statCardRanked("Longest road trip", s.longestRoadtrip, L("longestRoadtrip"), true, { unit: " gm" }),
    statCardRanked("Longest home stand", s.longestHomestand, L("longestHomestand"), false, { unit: " gm" }),
    statCardRanked("Miles", s.totalTravelMiles, L("totalTravelMiles"), true, { fmt: milesF }),
    statCardRanked("TZ hours", s.tzHours, L("tzHours"), true),
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

function renderCalendar(gameLog) {
  const restVals = gameLog.map(g => g.restDays).filter(r => r !== null);
  const strip = $("#calendarStrip");
  strip.innerHTML = gameLog.map((g, i) => {
    const bg = g.restDays === null ? "var(--grid)" :
      (deltaBg(g.restDays, restVals, false) || "background:var(--grid)").replace("background:", "");
    return `<div class="heat-day" data-idx="${i}" style="background:${bg}"></div>`;
  }).join("");

  const tip = $("#tooltip");
  strip.querySelectorAll(".heat-day").forEach(el => {
    const g = gameLog[+el.dataset.idx];
    el.addEventListener("mouseenter", () => {
      tip.hidden = false;
      tip.innerHTML = `${fmtDateShort(g.date)} \u00B7 ${g.isHome ? "vs" : "@"} ${g.opponent}` +
        (g.restDays === null ? "" : `<br>${g.restDays} day${g.restDays === 1 ? "" : "s"} rest${g.b2b ? " \u2014 B2B" : ""}`);
    });
    el.addEventListener("mousemove", e => {
      tip.style.left = Math.min(e.clientX + 12, innerWidth - 220) + "px";
      tip.style.top = (e.clientY + 12) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; });
  });

  const months = [];
  let lastMonth = null;
  gameLog.forEach((g, i) => {
    const m = g.date.slice(0, 7);
    if (m !== lastMonth) { months.push({ i, label: fmtDateShort(g.date).split(" ")[0] }); lastMonth = m; }
  });
  $("#calendarMonths").innerHTML = months.map(m =>
    `<span style="flex:0 0 auto;margin-left:${m.i === 0 ? 0 : 6}px">${m.label}</span>`).join("");
}

function daySpan(startDate, endDate) {
  const d1 = new Date(startDate), d2 = new Date(endDate);
  return Math.round((d2 - d1) / 86400000) + 1;
}

function segmentLeagueValues(league, index, key) {
  return Object.values(league.teamSummary)
    .map(s => s.segments[index - 1])
    .filter(Boolean)
    .map(seg => seg[key]);
}

function renderSegments(segments, league) {
  // strip: shaded by THIS team's own range across their own segments
  // (self-relative -- how tough is this stretch compared to this team's
  // own season, not the league)
  const ownRest = segments.map(s => s.avgRestDays).filter(v => v !== null);
  $("#segmentStrip").innerHTML = segments.map(seg => {
    const bg = seg.avgRestDays === null ? "var(--grid)" :
      (deltaBg(seg.avgRestDays, ownRest, false) || "background:var(--grid)").replace("background:", "");
    return `<div class="segment-block" data-idx="${seg.index}" style="background:${bg};color:var(--text)"
       title="${fmtDateShort(seg.startDate)}\u2013${fmtDateShort(seg.endDate)}">${seg.index}</div>`;
  }).join("");

  // table: every segment, each numeric cell shaded against the LEAGUE
  // AVERAGE for that same segment index (not this team's own range --
  // e.g. segment 6 compared across all 32 teams' segment-6 stats)
  const cols = [
    { key: "roadGames", lowerIsBetter: true }, { key: "b2bCount", lowerIsBetter: true },
    { key: "tzHours", lowerIsBetter: true }, { key: "miles", lowerIsBetter: true },
    { key: "restVs", lowerIsBetter: false },
  ];
  $("#segmentTable tbody").innerHTML = segments.map(seg => {
    const cells = cols.map(col => {
      const vals = segmentLeagueValues(league, seg.index, col.key);
      const bg = vals.length > 4 ? deltaBg(seg[col.key], vals, col.lowerIsBetter) : "";
      const disp = col.key === "miles" ? Math.round(seg[col.key]).toLocaleString()
        : col.key === "restVs" ? (seg[col.key] > 0 ? "+" : "") + seg[col.key]
        : seg[col.key];
      return `<td class="num" style="${bg}">${disp}</td>`;
    }).join("");
    return `<tr class="segment-row" data-idx="${seg.index}">
      <td class="num">${seg.index}</td>
      <td>Games ${(seg.index - 1) * 5 + 1}\u2013${(seg.index - 1) * 5 + seg.games}</td>
      <td>${fmtDateShort(seg.startDate)} \u2013 ${fmtDateShort(seg.endDate)}</td>
      <td class="num">${daySpan(seg.startDate, seg.endDate)}</td>
      ${cells}
      <td>${seg.tags.map(t => `<span class="segment-tag-pill">${t}</span>`).join("")}</td>
    </tr>`;
  }).join("");

  const showDetail = idx => {
    const seg = segments.find(s => s.index === idx);
    $("#segmentDetail").innerHTML = `
      <div style="margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
        <strong>Segment ${seg.index}</strong> \u00B7 ${fmtDateShort(seg.startDate)} \u2013 ${fmtDateShort(seg.endDate)}
        <p class="panel-sub" style="margin-top:8px">Opponents: ${seg.opponents.map((o, i) =>
          `${seg.isHome[i] ? "" : "@"}${o}`).join(", ")}</p>
      </div>`;
  };
  $("#segmentStrip").querySelectorAll(".segment-block").forEach(el =>
    el.addEventListener("click", () => showDetail(+el.dataset.idx)));
  $("#segmentTable").querySelectorAll(".segment-row").forEach(el =>
    el.addEventListener("click", () => showDetail(+el.dataset.idx)));
}

function renderOpponents(matchups) {
  const rows = Object.entries(matchups).sort((a, b) => b[1].total - a[1].total);
  $("#oppTable tbody").innerHTML = rows.map(([opp, m]) =>
    `<tr class="opp-row"><td>${opp}</td><td class="num">${m.total}</td><td class="num">${m.home}</td><td class="num">${m.away}</td></tr>`
  ).join("");
}

/* Schematic (not geographically precise) map: simple lat/lon -> x/y scale,
   good enough to show relative positions and routes at a glance. */
function renderMap(teamName, gameLog, cityCoords) {
  const W = 640, H = 360, pad = 20;
  const lats = Object.values(cityCoords).map(c => c[0]);
  const lons = Object.values(cityCoords).map(c => c[1]);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const project = ([lat, lon]) => [
    pad + (lon - lonMin) / (lonMax - lonMin) * (W - 2 * pad),
    pad + (latMax - lat) / (latMax - latMin) * (H - 2 * pad),
  ];

  const visitCounts = {};
  gameLog.forEach(g => { visitCounts[g.venueCity] = (visitCounts[g.venueCity] || 0) + 1; });

  let svg = `<svg class="travelmap" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Road trip map">`;

  // road route: consecutive away-game cities, in chronological order,
  // collapsing consecutive duplicates (same city back-to-back)
  const roadCities = [];
  gameLog.forEach(g => {
    if (!g.isHome && (roadCities.length === 0 || roadCities[roadCities.length - 1] !== g.venueCity)) {
      roadCities.push(g.venueCity);
    }
  });
  const homeCoord = cityCoords[teamName];
  const routePts = [teamName, ...roadCities].map(c => cityCoords[c] ? project(cityCoords[c]) : null).filter(Boolean);
  if (routePts.length > 1) {
    const d = routePts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    svg += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`;
  }

  // every city as a dot, sized by visit frequency; home city in brand orange
  for (const [city, coord] of Object.entries(cityCoords)) {
    const [x, y] = project(coord);
    const visits = visitCounts[city] || 0;
    const isHome = city === teamName;
    const r = isHome ? 8 : Math.max(3, Math.min(9, 3 + visits * 1.3));
    const fill = isHome ? "var(--brand-orange)" : (visits > 0 ? "var(--accent)" : "var(--text3)");
    const opacity = isHome || visits > 0 ? 1 : 0.35;
    svg += `<circle class="city-dot" data-city="${city}" data-visits="${visits}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;
  }
  svg += "</svg>";
  $("#mapHolder").innerHTML = svg;

  const tip = $("#tooltip");
  $("#mapHolder").querySelectorAll(".city-dot").forEach(el => {
    el.addEventListener("mouseenter", () => {
      tip.hidden = false;
      const city = el.dataset.city, visits = el.dataset.visits;
      tip.innerHTML = city === teamName ? `${city} (home)` : `${city} \u2014 ${visits} game${visits === "1" ? "" : "s"} played there`;
    });
    el.addEventListener("mousemove", e => {
      tip.style.left = Math.min(e.clientX + 12, innerWidth - 220) + "px";
      tip.style.top = (e.clientY + 12) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

function showTeam(teamName) {
  state.team = teamName;
  const s = state.league.teamSummary[teamName];
  if (!s) return;
  $("#teamPanelLabel").textContent = `${teamName} \u2014 Season at a Glance`;
  renderStats(s, state.league);
  renderToughest(s.toughestStretch);
  renderCalendar(s.gameLog);
  renderSegments(s.segments, state.league);
  renderOpponents(s.opponentMatchups);
  renderMap(teamName, s.gameLog, state.league.cityCoords);
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
