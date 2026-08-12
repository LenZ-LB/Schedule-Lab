/* team-explorer.js */
"use strict";
const $ = (s, el = document) => el.querySelector(s);

const state = { league: null, team: null, oppSort: { key: "total", dir: -1 } };

/* ---- helpers ----------------------------------------------------------- */
function fmtDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function leagueValuesFor(league, key) {
  return Object.values(league.teamSummary).map(s => s[key]);
}

const milesF = v => Math.round(v).toLocaleString();

/* ---- stat cards (compact, no Games card) ------------------------------- */
function statCardRanked(label, value, allValues, lowerIsBetter, opts = {}) {
  const info = rankInfo(value, allValues, lowerIsBetter);
  const badgeCls = info.cls ? ` rank-${info.cls}` : "";
  const fmt = opts.fmt || (v => v);
  return `<div class="stat-card stat-card-sm">
    <div class="st-label">${label}</div>
    <div class="st-value">${fmt(value)}${opts.unit || ""}</div>
    <div class="st-sub"><span class="rank-chip${badgeCls}">#${info.rank}</span> Avg&nbsp;${fmt(info.avg)}</div>
  </div>`;
}

function renderStats(s, league) {
  const L = key => leagueValuesFor(league, key);
  $("#statRow").innerHTML = [
    statCardRanked("B2B", s.b2bCount, L("b2bCount"), true),
    statCardRanked("3-in-4", s.threeInFourCount, L("threeInFourCount"), true),
    statCardRanked("4-in-6", s.fourInSixCount, L("fourInSixCount"), true),
    statCardRanked("5-in-8", s.fiveInEightCount, L("fiveInEightCount"), true),
    statCardRanked("Avg rest", s.avgRestDays, L("avgRestDays"), false),
    statCardRanked("Waiting", s.waitingCount, L("waitingCount"), false),
    statCardRanked("Tired", s.tiredCount, L("tiredCount"), true),
    statCardRanked("Rest vs", s.restVs, L("restVs"), false,
      { fmt: v => (v > 0 ? "+" : "") + v }),
    statCardRanked("Longest trip", s.longestRoadtrip, L("longestRoadtrip"), true, { unit: " gm" }),
    statCardRanked("Longest stand", s.longestHomestand, L("longestHomestand"), false, { unit: " gm" }),
    statCardRanked("Miles", s.totalTravelMiles, L("totalTravelMiles"), true, { fmt: milesF }),
    statCardRanked("TZ hrs", s.tzHours, L("tzHours"), true),
  ].join("");
}

/* ---- season calendar (month-grid) -------------------------------------- */
function renderCalendar(gameLog) {
  // Build a lookup: date string -> game and game number
  const byDate = {};
  const gameNumByDate = {};
  gameLog.forEach((g, i) => { byDate[g.date] = g; gameNumByDate[g.date] = i + 1; });

  // Determine full date range: first game date to last, padded to week boundaries
  const dates = gameLog.map(g => g.date).sort();
  const start = new Date(dates[0]);
  const end   = new Date(dates[dates.length - 1]);

  // Group by month-year
  const months = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    if (!months[key]) months[key] = [];
    months[key].push(iso);
  }

  const tip = $("#tooltip");

  const html = Object.entries(months).map(([monthLabel, days]) => {
    // Pad the start to Sunday
    const firstDay = new Date(days[0]);
    const padBefore = firstDay.getDay(); // 0=Sun
    const cells = [];
    for (let i = 0; i < padBefore; i++) cells.push(`<div class="cal-cell cal-pad"></div>`);

    days.forEach(iso => {
      const g = byDate[iso];
      let cls = "cal-off";
      let title = "";
      if (g) {
        if (g.b2b) cls = "cal-b2b";
        else if (g.isHome) cls = "cal-home";
        else cls = "cal-away";
        title = `Game ${gameNumByDate[iso]} · ${fmtDateShort(iso)} · ${g.isHome ? "vs" : "@"} ${g.opponent}` +
          (g.restDays === null ? "" : ` · ${g.restDays}d rest${g.b2b ? " (B2B)" : ""}`);
      }
      const dayNum = new Date(iso).getDate();
      cells.push(`<div class="cal-cell ${cls}" data-tip="${title}" data-date="${iso}">${dayNum}</div>`);
    });

    return `<div class="cal-month">
      <div class="cal-month-label">${monthLabel}</div>
      <div class="cal-dow-row"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
      <div class="cal-grid">${cells.join("")}</div>
    </div>`;
  }).join("");

  $("#calendarGrid").innerHTML = html;

  // Tooltip wiring
  $("#calendarGrid").querySelectorAll(".cal-cell[data-tip]").forEach(el => {
    const t = el.dataset.tip;
    if (!t) return;
    el.addEventListener("mouseenter", () => { tip.hidden = false; tip.innerHTML = t; });
    el.addEventListener("mousemove", e => {
      tip.style.left = Math.min(e.clientX + 12, innerWidth - 220) + "px";
      tip.style.top = (e.clientY + 12) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
}

/* ---- segments (inline row accordion) ----------------------------------- */
function daySpan(startDate, endDate) {
  return Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
}

function segmentLeagueValues(league, index, key) {
  return Object.values(league.teamSummary)
    .map(s => s.segments[index - 1]).filter(Boolean).map(seg => seg[key]);
}

function renderSegments(segments, league, gameLog) {
  const ownRest = segments.map(s => s.avgRestDays).filter(v => v !== null);

  // Build per-game lookup for the expand rows (same logic as full schedule table)
  const codeToCity = {};
  for (const [city, code] of Object.entries(state.league.teamCodes)) {
    codeToCity[code] = city;
  }
  const oppRestByDate = {};
  const gameNumByDate = {};
  gameLog.forEach((g, i) => {
    gameNumByDate[g.date] = i + 1;
    const oppCity = codeToCity[g.opponent];
    const oppLog = oppCity ? league.teamSummary[oppCity]?.gameLog : null;
    if (!oppLog) return;
    const oppGame = oppLog.find(og => og.date === g.date);
    if (oppGame) oppRestByDate[g.date] = oppGame.restDays;
  });
  const byDate = {};
  gameLog.forEach(g => { byDate[g.date] = g; });
  const ownSchedule = state.ownSchedule || {};

  function fmtTime(t) {
    if (!t) return "—";
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2,"0")} ${ap}`;
  }

  $("#segmentStrip").innerHTML = segments.map(seg => {
    const bg = seg.avgRestDays === null ? "var(--grid)" :
      (deltaBg(seg.avgRestDays, ownRest, false) || "background:var(--grid)").replace("background:", "");
    return `<div class="segment-block" data-seg="${seg.index}"
      style="background:${bg};color:var(--text)"
      title="${fmtDateShort(seg.startDate)}–${fmtDateShort(seg.endDate)}">${seg.index}</div>`;
  }).join("");

  const cols = [
    { key: "roadGames", lowerIsBetter: true }, { key: "b2bCount", lowerIsBetter: true },
    { key: "tzHours", lowerIsBetter: true }, { key: "miles", lowerIsBetter: true },
    { key: "restVs", lowerIsBetter: false },
  ];

  function makeDetailRow(seg) {
    // Build a mini full-schedule table for this segment's games
    const segGames = seg.opponents.map((opp, i) => ({
      opp, isHome: seg.isHome[i],
      // find date for this game by matching opponents in order within segment range
      ...(() => {
        const gamesInRange = gameLog.filter(g =>
          g.date >= seg.startDate && g.date <= seg.endDate && g.opponent === opp
        );
        const g = gamesInRange[0] || {};
        return { date: g.date, restDays: g.restDays, b2b: g.b2b };
      })(),
    }));

    const gameRows = segGames.map(sg => {
      if (!sg.date) return "";
      const oppRest = oppRestByDate[sg.date];
      const ourRest = sg.restDays;
      const gNum = gameNumByDate[sg.date] || "—";
      const time = ownSchedule[sg.date] ? fmtTime(ownSchedule[sg.date]) : "—";
      const oppCity = codeToCity[sg.opp] || sg.opp;
      const oppDisplay = sg.isHome ? oppCity : `@ ${oppCity}`;
      const [yr, mo, da] = sg.date.split("-").map(Number);
      const dateLabel = new Date(yr, mo-1, da).toLocaleDateString("en-US",
        { month:"short", day:"numeric", year:"numeric" });
      const dayLabel = new Date(yr, mo-1, da).toLocaleDateString("en-US", { weekday:"short" });
      let adv = `<span class="rest-even">\u2014</span>`;
      if (ourRest != null && oppRest != null) {
        if (ourRest > oppRest) adv = `<span class="rest-adv">\u2713</span>`;
        else if (ourRest < oppRest) adv = `<span class="rest-dis">\u2717</span>`;
      }
      const b2bBadge = sg.b2b ? ` <span class="opp-b2b">B2B</span>` : "";
      return `<tr class="seg-game-row">
        <td class="num">${gNum}</td>
        <td>${dateLabel}</td>
        <td>${dayLabel}</td>
        <td class="seg-opp-cell">${oppDisplay}${b2bBadge}</td>
        <td class="num">${time}</td>
        <td class="num">${ourRest != null ? ourRest : ""}</td>
        <td class="num">${oppRest != null ? oppRest : ""}</td>
        <td class="num">${adv}</td>
      </tr>`;
    }).join("");

    return `<tr class="seg-detail-row" data-detail-for="${seg.index}">
      <td colspan="9" class="seg-detail-cell">
        <table class="seg-game-table">
          <thead><tr>
            <th class="num">#</th><th>Date</th><th>Day</th><th>Opponent</th>
            <th class="num">Time</th><th class="num">Rest</th>
            <th class="num">Opp Rest</th><th class="num">Adv</th>
          </tr></thead>
          <tbody>${gameRows}</tbody>
        </table>
      </td>
    </tr>`;
  }

  let openIdx = null;
  const tbody = $("#segmentTable tbody");

  function buildRows() {
    tbody.innerHTML = segments.map(seg => {
      const cells = cols.map(col => {
        const vals = segmentLeagueValues(league, seg.index, col.key);
        const bg = vals.length > 4 ? deltaBg(seg[col.key], vals, col.lowerIsBetter) : "";
        const disp = col.key === "miles" ? Math.round(seg[col.key]).toLocaleString()
          : col.key === "restVs" ? (seg[col.key] > 0 ? "+" : "") + seg[col.key]
          : seg[col.key];
        return `<td class="num" style="${bg}">${disp}</td>`;
      }).join("");
      const isOpen = openIdx === seg.index;
      const mainRow = `<tr class="segment-row${isOpen ? " seg-open" : ""}" data-seg="${seg.index}">
        <td class="num">${seg.index}</td>
        <td>Games ${(seg.index - 1) * 5 + 1}–${(seg.index - 1) * 5 + seg.games}</td>
        <td>${fmtDateShort(seg.startDate)} – ${fmtDateShort(seg.endDate)}</td>
        <td class="num">${daySpan(seg.startDate, seg.endDate)}</td>
        ${cells}
      </tr>`;
      return mainRow + (isOpen ? makeDetailRow(seg) : "");
    }).join("");

    tbody.querySelectorAll(".segment-row").forEach(el => {
      el.addEventListener("click", () => {
        const idx = +el.dataset.seg;
        openIdx = (openIdx === idx) ? null : idx;
        buildRows();
        const block = $("#segmentStrip .segment-block[data-seg='" + openIdx + "']");
        if (block) block.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }
  buildRows();

  $("#segmentStrip").querySelectorAll(".segment-block").forEach(el => {
    el.addEventListener("click", () => {
      const idx = +el.dataset.seg;
      openIdx = (openIdx === idx) ? null : idx;
      buildRows();
      const row = $("#segmentTable .segment-row[data-seg='" + openIdx + "']");
      if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

/* ---- opponent frequency (sortable, click to expand games) -------------- */
function renderOpponents(matchups, gameLog) {
  const tip = $("#tooltip");
  let oppSortState = { key: "total", dir: -1 };

  function buildOppTable() {
    const rows = Object.entries(matchups).sort((a, b) => {
      const k = oppSortState.key;
      if (k === "team") return oppSortState.dir * a[0].localeCompare(b[0]);
      return oppSortState.dir * (a[1][k] - b[1][k]);
    });
    const tbody = $("#oppTable tbody");
    tbody.innerHTML = rows.map(([opp, m]) =>
      `<tr class="opp-row" data-opp="${opp}">
        <td>${opp}</td>
        <td class="num">${m.total}</td>
        <td class="num">${m.home}</td>
        <td class="num">${m.away}</td>
      </tr>`
    ).join("");

    tbody.querySelectorAll(".opp-row").forEach(el => {
      el.addEventListener("click", () => {
        const opp = el.dataset.opp;
        const games = gameLog.filter(g => g.opponent === opp);
        const detail = $("#oppDetail");
        // toggle
        if (detail.dataset.opp === opp) {
          detail.innerHTML = ""; detail.dataset.opp = "";
          return;
        }
        detail.dataset.opp = opp;
        detail.innerHTML = `<div class="opp-games">
          <div class="opp-games-label">vs ${opp}</div>
          ${games.map(g => `<div class="opp-game-row">
            <span>${fmtDateShort(g.date)}</span>
            <span>${g.isHome ? "Home" : "Away"}</span>
            ${g.b2b ? `<span class="opp-b2b">B2B</span>` : ""}
          </div>`).join("")}
        </div>`;
      });
    });
  }
  buildOppTable();

  document.querySelectorAll("#oppTable th[data-opp-sort]").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const k = th.dataset.oppSort;
      oppSortState = { key: k, dir: oppSortState.key === k ? -oppSortState.dir : -1 };
      buildOppTable();
    });
  });
}

/* ---- monthly workload bar chart (SVG, no library) ---------------------- */
const MONTH_ORDER = ["Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr"];

function renderMonthChart(monthCounts, leagueMonthCounts) {
  // Get all months this team plays in, in season order
  const allMonthKeys = Object.keys(monthCounts).sort((a, b) => {
    const [ma, ya] = a.split(" "); const [mb, yb] = b.split(" ");
    return ya !== yb ? ya - yb : MONTH_ORDER.indexOf(ma) - MONTH_ORDER.indexOf(mb);
  });

  if (!allMonthKeys.length) { $("#monthChart").innerHTML = ""; return; }

  // League average per month (total / 32)
  const leagueAvg = {};
  for (const k of allMonthKeys) leagueAvg[k] = ((leagueMonthCounts[k] || 0) / 32);

  const W = 360, H = 200, padL = 28, padB = 36, padT = 14, padR = 8;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(...allMonthKeys.map(k => monthCounts[k] || 0), 1);
  const yMax = Math.ceil(maxVal / 5) * 5;

  const barW = plotW / allMonthKeys.length;
  const x = i => padL + i * barW;
  const y = v => padT + plotH - (v / yMax) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // gridlines
  for (let v = 0; v <= yMax; v += 5) {
    svg += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}"
      stroke="var(--grid)" stroke-width="1"/>`;
    svg += `<text x="${padL - 4}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end"
      fill="var(--text3)" font-size="9" font-family="Rubik">${v}</text>`;
  }

  // bars
  allMonthKeys.forEach((k, i) => {
    const v = monthCounts[k] || 0;
    const bx = x(i) + barW * 0.15, bw = barW * 0.7;
    svg += `<rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}"
      height="${(plotH - (plotH - (v / yMax) * plotH)).toFixed(1)}"
      fill="var(--brand-orange)" rx="2"/>`;
    const label = k.split(" ")[0];
    svg += `<text x="${(x(i) + barW / 2).toFixed(1)}" y="${(H - padB + 14).toFixed(1)}"
      text-anchor="middle" fill="var(--text3)" font-size="9.5" font-family="Rubik">${label}</text>`;
  });

  // league average line
  const linePoints = allMonthKeys.map((k, i) =>
    `${(x(i) + barW / 2).toFixed(1)},${y(leagueAvg[k]).toFixed(1)}`).join(" ");
  svg += `<polyline points="${linePoints}" fill="none" stroke="var(--accent)"
    stroke-width="1.5" stroke-dasharray="3 2"/>`;
  svg += `<text x="${W - padR}" y="${(y(leagueAvg[allMonthKeys[allMonthKeys.length - 1]]) - 4).toFixed(1)}"
    text-anchor="end" fill="var(--accent)" font-size="9" font-family="Rubik">Avg</text>`;

  svg += "</svg>";
  $("#monthChart").innerHTML = svg;
}

/* ---- full schedule table ----------------------------------------------- */
function renderFullSchedule(gameLog, teamSummary) {
  // gameLog uses tri-codes for opponent; teamSummary keys are city names.
  // Build code -> city lookup from teamCodes (city -> code) in league data.
  const codeToCity = {};
  for (const [city, code] of Object.entries(state.league.teamCodes)) {
    codeToCity[code] = city;
  }

  // Build opponent rest lookup: date -> opponent's restDays on that date
  const oppRestByDate = {};
  gameLog.forEach(g => {
    const oppCity = codeToCity[g.opponent];
    const oppLog = oppCity ? teamSummary[oppCity]?.gameLog : null;
    if (!oppLog) return;
    const oppGame = oppLog.find(og => og.date === g.date);
    if (oppGame) oppRestByDate[g.date] = oppGame.restDays;
  });

  function fmtTime(iso24) {
    // iso24 like "20:00" from schedule -- format as "8 PM"
    if (!iso24) return "—";
    const [h, m] = iso24.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
  }

  // Get game times from opponentMatchups — we don't have them in gameLog directly.
  // The official schedule has times but the league dataset stores them in the
  // pipeline's per-game record, not in the summary gameLog. Use the schedule
  // data from docs/data/20262027.json for our own team's times; for other teams
  // we just show "—". This is filled in below if available from the own-team file.
  const ownSchedule = state.ownSchedule || {};  // keyed by date, set in boot

  $("#fullSchedTable tbody").innerHTML = gameLog.map(g => {
    const oppRest = oppRestByDate[g.date];
    const ourRest = g.restDays;
    const time = ownSchedule[g.date] ? fmtTime(ownSchedule[g.date]) : "—";

    // Advantage: ✓ if we had more rest, ✗ if they had more, — if even or opener
    let advHtml = `<span class="rest-even">\u2014</span>`;
    if (ourRest !== null && ourRest !== undefined && oppRest !== null && oppRest !== undefined) {
      if (ourRest > oppRest) advHtml = `<span class="rest-adv">\u2713</span>`;
      else if (ourRest < oppRest) advHtml = `<span class="rest-dis">\u2717</span>`;
      else advHtml = `<span class="rest-even">\u2014</span>`;
    }

    const oppCity = codeToCity[g.opponent] || g.opponent;
    const oppDisplay = g.isHome
      ? oppCity
      : `<span class="opp-away">@ ${oppCity}</span>`;

    const [yr, mo, da] = g.date.split("-").map(Number);
    const dateLabel = new Date(yr, mo - 1, da)
      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const dayLabel = new Date(yr, mo - 1, da)
      .toLocaleDateString("en-US", { weekday: "short" });

    return `<tr>
      <td>${dateLabel}</td>
      <td>${dayLabel}</td>
      <td>${oppDisplay}</td>
      <td class="num">${time}</td>
      <td class="num">${ourRest !== null && ourRest !== undefined ? ourRest : ""}</td>
      <td class="num">${oppRest !== null && oppRest !== undefined ? oppRest : ""}</td>
      <td class="num">${advHtml}</td>
    </tr>`;
  }).join("");
}

/* ---- main render ------------------------------------------------------- */
function showTeam(teamName) {
  state.team = teamName;
  const s = state.league.teamSummary[teamName];
  if (!s) return;
  renderStats(s, state.league);
  renderCalendar(s.gameLog);
  renderSegments(s.segments, state.league, s.gameLog);
  renderOpponents(s.opponentMatchups, s.gameLog);
  renderMonthChart(s.monthCounts, state.league.leagueMonthCounts);
  renderFullSchedule(s.gameLog, state.league.teamSummary);
}

async function boot() {
  try {
    const res = await fetch("data/league/20262027.json");
    if (!res.ok) throw new Error("league data not found");
    state.league = await res.json();

    // Try to load our own team's detailed schedule for local game times.
    // This file exists for the home team only (docs/data/20262027.json).
    // For other teams we just show "—" in the time column.
    try {
      const ownRes = await fetch("data/20262027.json");
      if (ownRes.ok) {
        const ownData = await ownRes.json();
        state.ownSchedule = {};
        state.ownTeamCity = null;
        // Detect which city this schedule belongs to by checking the team code
        // against the league's teamCodes map
        if (ownData.games && ownData.games.length) {
          // Find our team by checking who has a home game on the opener date
          const openerDate = ownData.games[0].date;
          const opener = ownData.games[0];
          // Use the season's home team as "our" team — first home game gives the city
          for (const [city, code] of Object.entries(state.league.teamCodes)) {
            if (code === "EDM") { state.ownTeamCity = city; break; } // fallback
          }
          // Build time lookup: date -> timeLocal (venue local time)
          ownData.games.forEach(g => {
            if (g.venueTimeLocal) state.ownSchedule[g.date] = g.venueTimeLocal;
            else if (g.timeLocal) state.ownSchedule[g.date] = g.timeLocal;
          });
        }
      }
    } catch (e) { /* fine, times just show as — */ }

    const sel = $("#teamSelect");
    sel.innerHTML = state.league.teams.map(t => `<option value="${t}">${t}</option>`).join("");
    sel.addEventListener("change", () => showTeam(sel.value));
    $("#updatedStamp").textContent = state.league.generated && !state.league.generated.startsWith("TEST")
      ? `Last updated: ${state.league.generated.slice(0, 10)}.`
      : "Placeholder data — pending the first live pipeline run.";
    showTeam(state.league.teams[0]);
  } catch (e) {
    console.error(e);
    $("#statRow").innerHTML = "<p>Couldn't load league data.</p>";
  }
}
boot();
