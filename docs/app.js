/* Schedule Lab — app.js (no build step, vanilla JS) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const state = { index: null, season: null, filter: null };

const isWin = g => ["W", "OTW", "SOW"].includes(g.result);
const isPlayed = g => !!g.result;
const outcomeClass = g => !g.result ? "fut"
  : isWin(g) ? "w"
  : (g.result === "OTL" || g.result === "SOL") ? "otl" : "l";

const MOON_ICON = {
  "new moon": "\u{1F311}", "waxing crescent": "\u{1F312}", "first quarter": "\u{1F313}",
  "waxing gibbous": "\u{1F314}", "full moon": "\u{1F315}", "waning gibbous": "\u{1F316}",
  "last quarter": "\u{1F317}", "waning crescent": "\u{1F318}",
};
const moonIcon = m => {
  if (!m) return "";
  const key = m.toLowerCase().startsWith("full") ? "full moon" : m.toLowerCase();
  return MOON_ICON[key] || "";
};

function record(games) {
  const played = games.filter(isPlayed);
  const w = played.filter(isWin).length;
  const l = played.filter(g => g.result === "L").length;
  const otl = played.filter(g => g.result === "OTL").length;
  const sol = played.filter(g => g.result === "SOL").length;
  const pts = 2 * w + otl + sol;
  const ptsPct = played.length ? pts / (2 * played.length) : 0;
  return { gp: played.length, w, l, otl, sol, pts, ptsPct };
}
const fmtRec = r => `${r.w}-${r.l}-${r.otl + r.sol}`;
const fmtPct = p => (p >= 1 ? "1.000" : p.toFixed(3).replace(/^0/, ""));

/* ---- split definitions -------------------------------------------------- */
const SPLITS = [
  { group: "Rest & density", items: [
    { id: "b2b",   name: "Back to back",      test: g => g.b2b === true },
    { id: "nb2b",  name: "Non back-to-back",  test: g => g.b2b === false },
    { id: "3in4",  name: "3 in 4 nights",     test: g => g.threeIn4 === true },
    { id: "r1",    name: "1 day off",         test: g => g.restDays === 1 },
    { id: "r2",    name: "2 days off",        test: g => g.restDays === 2 },
    { id: "r3",    name: "3 days off",        test: g => g.restDays === 3 },
    { id: "r4",    name: "4+ days off",       test: g => g.restDays !== null && g.restDays >= 4 },
  ]},
  { group: "Venue & travel", items: [
    { id: "home",  name: "Home",              test: g => g.homeAway === "h" },
    { id: "away",  name: "Away",              test: g => g.homeAway === "a" },
    { id: "tzE",   name: "Eastern venues",    test: g => g.venueTz === "ET" },
    { id: "tzC",   name: "Central venues",    test: g => g.venueTz === "CT" },
    { id: "tzM",   name: "Mountain venues",   test: g => g.venueTz === "MT" },
    { id: "tzP",   name: "Pacific venues",    test: g => g.venueTz === "PT" },
    { id: "tzLost",name: "Lost hours (tz \u2212)", test: g => g.tzChange !== null && g.tzChange < 0 },
    { id: "tzGain",name: "Gained hours (tz +)",    test: g => g.tzChange !== null && g.tzChange > 0 },
    { id: "ea",    name: "Early arrival",     test: g => g.earlyArrival === true },
  ]},
  { group: "Game states", items: [
    { id: "sf",    name: "Scored first",      test: g => g.scoredFirst === true },
    { id: "csf",   name: "Conceded first",    test: g => g.scoredFirst === false },
    { id: "la1",   name: "Leading after 1st", test: g => g.leadAfter1 === true },
    { id: "la2",   name: "Leading after 2nd", test: g => g.leadAfter2 === true },
    { id: "w3",    name: "Won the 3rd",       test: g => g.wonThird === true },
    { id: "stw",   name: "Won special teams", test: g => g.specialTeamsWin === true },
    { id: "stt",   name: "Tied special teams",test: g => g.specialTeamsTie === true },
    { id: "fo50",  name: "Won 50%+ faceoffs", test: g => g.fo50 === true },
    { id: "cfo",   name: "Won contested draws", test: g => g.contestedFoWin === true },
  ]},
  { group: "Margin", items: [
    { id: "m1",    name: "One-goal games",    test: g => g.marginBucket === 1 },
    { id: "m2",    name: "Two-goal games",    test: g => g.marginBucket === 2 },
    { id: "m3",    name: "3+ goal games",     test: g => g.marginBucket === 3 },
  ]},
  { group: "Team ops (hand-tracked)", items: [
    { id: "mdo",   name: "After mandatory day off", test: g => g.mdo === true },
    { id: "ms",    name: "Morning skate",     test: g => g.morningSkate === true },
    { id: "noms",  name: "No morning skate",  test: g => g.morningSkate === false },
    { id: "dbs",   name: "Skated day before", test: g => g.dayBeforeSkate === true },
    { id: "l117",  name: "11F / 7D lineup",   test: g => g.elevenF7D === true },
  ]},
  { group: "Calendar & cosmos", items: [
    { id: "sat",   name: "Saturdays",         test: g => g.dayOfWeek === "Saturday" },
    { id: "sun",   name: "Sundays",           test: g => g.dayOfWeek === "Sunday" },
    { id: "wkday", name: "Mon\u2013Fri",      test: g => !["Saturday","Sunday"].includes(g.dayOfWeek) },
    { id: "full",  name: "Full moon",         test: g => (g.moon || "").startsWith("full") },
    { id: "newm",  name: "New moon",          test: g => g.moon === "new moon" },
    { id: "wax",   name: "Waxing moon",       test: g => (g.moon || "").startsWith("waxing") || g.moon === "first quarter" },
    { id: "wane",  name: "Waning moon",       test: g => (g.moon || "").startsWith("waning") || g.moon === "last quarter" },
  ]},
];
const findSplit = id => {
  for (const grp of SPLITS) for (const s of grp.items) if (s.id === id) return s;
  return null;
};

/* ---- rendering ---------------------------------------------------------- */
function renderHeader() {
  const s = state.season;
  $("#seasonTitle").textContent = s.label;
  const r = record(s.games);
  if (r.gp === 0) {
    const first = s.games[0];
    const opener = first
      ? `Opener ${first.date} ${first.homeAway === "h" ? "vs" : "@"} ${first.opponent}`
      : "";
    $("#recordLine").innerHTML =
      `<strong>Season not started</strong> &nbsp;\u00B7&nbsp; ${s.games.length} games scheduled` +
      (opener ? ` &nbsp;\u00B7&nbsp; ${opener}` : "");
    return;
  }
  const remaining = s.games.length - r.gp;
  $("#recordLine").innerHTML =
    `<strong>${fmtRec(r)}</strong> &nbsp;\u00B7&nbsp; ${r.pts} PTS &nbsp;\u00B7&nbsp; ` +
    `${fmtPct(r.ptsPct)} PTS% &nbsp;\u00B7&nbsp; ${r.gp} played` +
    (remaining ? ` &nbsp;\u00B7&nbsp; ${remaining} remaining` : "");
}

function pointsForResult(r) {
  return ["W", "OTW", "SOW"].includes(r) ? 2 : (r === "OTL" || r === "SOL") ? 1 : 0;
}

function streaks(played) {
  // longest win streak, longest winless streak, current form (last 10)
  let bestW = 0, bestWL = 0, curW = 0, curWL = 0, curStreak = 0, curType = null;
  for (const g of played) {
    if (isWin(g)) {
      curW++; curWL = 0; bestW = Math.max(bestW, curW);
      if (curType === "W") curStreak++; else { curType = "W"; curStreak = 1; }
    } else {
      curWL++; curW = 0; bestWL = Math.max(bestWL, curWL);
      if (curType === "L") curStreak++; else { curType = "L"; curStreak = 1; }
    }
  }
  const last10 = played.slice(-10);
  const l10 = record(last10);
  return { bestW, bestWL, curStreak, curType, l10 };
}

function renderGrind() {
  const games = state.season.games;
  const wrap = $("#grindStrip");
  if (!games.length) { wrap.innerHTML = ""; return; }
  const active = state.filter ? findSplit(state.filter) : null;

  const N = games.length;                       // scheduled games (usually 82)
  const played = games.filter(isPlayed);
  const maxPts = 2 * N;

  // cumulative points after each game
  let run = 0;
  const pts = games.map(g => { if (g.result) run += pointsForResult(g.result); return run; });
  const lastPlayedIdx = played.length - 1;

  const W = 1000, H = 300, padL = 44, padR = 16, padT = 18, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = i => padL + (N <= 1 ? 0 : i / (N - 1) * plotW);       // i = 0-based game index
  const yMaxPts = Math.max(60, Math.ceil((played.length ? pts[lastPlayedIdx] : 0) / 20) * 20 + 20, 100);
  const y = p => padT + plotH - (p / yMaxPts) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Points pace over the season">`;

  // y gridlines every 20 pts
  for (let p = 0; p <= yMaxPts; p += 20) {
    svg += `<line x1="${padL}" y1="${y(p).toFixed(1)}" x2="${W - padR}" y2="${y(p).toFixed(1)}" stroke="#12314F" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end" fill="#5E7B9C" font-size="11" font-family="Barlow Condensed">${p}</text>`;
  }
  // x ticks every ~10 games
  for (let i = 9; i < N; i += 10) {
    svg += `<text x="${x(i).toFixed(1)}" y="${H - 14}" text-anchor="middle" fill="#5E7B9C" font-size="11" font-family="Barlow Condensed">${i + 1}</text>`;
  }
  svg += `<text x="${(padL + plotW / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" fill="#5E7B9C" font-size="10.5" font-family="Barlow Condensed" letter-spacing="1.5">GAME</text>`;

  // reference pace lines: 96 pts (typical playoff cut) and 100 pts
  const pace = (target, color, dash, label, labelDy) => {
    const x2 = x(N - 1), y2 = y(target);
    let s = `<line x1="${x(0)}" y1="${y(0).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}" opacity="0.55"/>`;
    s += `<text x="${(x2 - 2).toFixed(1)}" y="${(y2 + labelDy).toFixed(1)}" text-anchor="end" fill="${color}" font-size="10.5" font-family="Barlow Condensed" letter-spacing="1" opacity="0.9">${label}</text>`;
    return s;
  };
  svg += pace(96, "#7FB2E5", "3 3", "96-PT PACE", -6);
  svg += pace(100, "#4D6B8C", "1 4", "100-PT", 13);

  // the cumulative points line (played games only)
  if (played.length) {
    let d = `M ${x(0).toFixed(1)} ${y(0).toFixed(1)}`;
    for (let i = 0; i <= lastPlayedIdx; i++) d += ` L ${x(i).toFixed(1)} ${y(pts[i]).toFixed(1)}`;
    // area fill under the line
    const areaD = d + ` L ${x(lastPlayedIdx).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
    svg += `<path d="${areaD}" fill="url(#paceFill)" opacity="0.5"/>`;
    svg += `<defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FF4C00" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#FF4C00" stop-opacity="0"/></linearGradient></defs>`;
    svg += `<path d="${d}" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linejoin="round"/>`;

    // result dots — color shows how each point was earned; streaks read as slope
    games.forEach((g, i) => {
      if (!g.result) return;
      const dim = active && !active.test(g) ? 0.16 : 1;
      const col = isWin(g) ? "var(--orange)" : (g.result === "OTL" || g.result === "SOL") ? "var(--otl)" : "var(--loss)";
      const r = isWin(g) ? 3.6 : 3;
      svg += `<circle class="pt" data-game="${g.game}" cx="${x(i).toFixed(1)}" cy="${y(pts[i]).toFixed(1)}" r="${r}" fill="${col}" opacity="${dim}" stroke="#061729" stroke-width="1"/>`;
    });
  }
  svg += "</svg>";
  wrap.innerHTML = svg;

  // streak callouts above the chart
  const s = streaks(played);
  const callout = $("#grindStats");
  if (callout) {
    const form = `${s.l10.w}-${s.l10.l}-${s.l10.otl + s.l10.sol}`;
    const cur = s.curType === "W" ? `W${s.curStreak}` : s.curType === "L" ? `L${s.curStreak}` : "\u2014";
    if (played.length) {
      callout.innerHTML =
        `<span><b>${cur}</b> current</span><span><b>${s.bestW}</b> best win streak</span>` +
        `<span><b>${form}</b> last 10</span><span><b>${pts[lastPlayedIdx]}</b> pts in ${played.length} GP</span>`;
    } else {
      const homeCt = games.filter(g => g.homeAway === "h").length;
      const b2bCt = games.filter(g => g.b2b).length;
      callout.innerHTML =
        `<span><b>${games.length}</b> games scheduled</span>` +
        `<span><b>${homeCt}</b> home / <b>${games.length - homeCt}</b> away</span>` +
        `<span><b>${b2bCt}</b> back-to-backs</span>` +
        `<span><b>The pace line fills in as games are played.</b></span>`;
    }
  }

  const tip = $("#tooltip");
  wrap.querySelectorAll(".pt").forEach(el => {
    const g = games[+el.dataset.game - 1];
    const i = g.game - 1;
    el.addEventListener("mousemove", e => {
      tip.hidden = false;
      tip.innerHTML = `#${g.game} \u00B7 ${g.date} \u00B7 ${g.homeAway === "h" ? "vs" : "@"} ${g.opponent}<br>` +
        `<b>${g.result}</b> ${g.gf}\u2013${g.ga} \u00B7 ${pts[i]} pts`;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 280) + "px";
      tip.style.top = (e.clientY + 14) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; });
    el.addEventListener("click", () => {
      const row = $(`#schedTable tbody tr[data-game="${g.game}"]`);
      if (row) { row.scrollIntoView({ block: "center" }); row.classList.add("hl");
        setTimeout(() => row.classList.remove("hl"), 1600); }
    });
  });
}

function renderSplits() {
  const games = state.season.games;
  const grid = $("#splitsGrid");
  grid.innerHTML = "";
  const base = record(games).ptsPct;
  if (record(games).gp === 0) {
    grid.innerHTML =
      `<p class="preseason-note">Situational splits appear once games are played. ` +
      `The full schedule is below \u2014 rest, back-to-backs, travel and moon phases ` +
      `are already computed for every game.</p>`;
    return;
  }
  for (const grp of SPLITS) {
    const sec = document.createElement("div");
    sec.className = "split-group";
    sec.innerHTML = `<h3>${grp.group}</h3>`;
    const cards = document.createElement("div");
    cards.className = "split-cards";
    for (const sp of grp.items) {
      const subset = games.filter(g => isPlayed(g) && sp.test(g));
      const r = record(subset);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "split-card" + (r.gp === 0 ? " empty" : "") +
        (state.filter === sp.id ? " active" : "");
      btn.dataset.split = sp.id;
      btn.innerHTML = r.gp === 0
        ? `<span class="sc-name">${sp.name}</span><div class="sc-sub">no games</div>`
        : `<span class="sc-name">${sp.name}</span>
           <div class="sc-rec">${fmtRec(r)} \u00B7 <strong>${fmtPct(r.ptsPct)}</strong></div>
           <div class="sc-sub">${r.gp} GP \u00B7 ${r.pts} PTS ${r.ptsPct >= base ? "\u25B2" : "\u25BC"} vs ${fmtPct(base)}</div>
           <div class="sc-bar"><i style="width:${(r.ptsPct * 100).toFixed(0)}%"></i></div>`;
      if (r.gp > 0) btn.addEventListener("click", () => {
        state.filter = state.filter === sp.id ? null : sp.id;
        renderSplits(); renderGrind(); renderTable(); renderFilterNote();
      });
      cards.appendChild(btn);
    }
    sec.appendChild(cards);
    grid.appendChild(sec);
  }
}

function renderFilterNote() {
  const sp = state.filter ? findSplit(state.filter) : null;
  $("#filterNote").textContent = sp ? `Filtered: ${sp.name} \u00D7 (click card again to clear)` : "";
}

function chips(g) {
  const c = [];
  if (g.b2b) c.push(["B2B", true]);
  if (g.threeIn4) c.push(["3in4", true]);
  if (g.tzChange) c.push([`TZ ${g.tzChange > 0 ? "+" : ""}${g.tzChange}`, g.tzChange < 0]);
  if (g.earlyArrival) c.push(["EA", false]);
  if (g.specialTeamsWin) c.push(["ST+", false]);
  else if (g.specialTeamsTie) c.push(["ST=", false]);
  if (g.mdo) c.push(["MDO", false]);
  if (g.morningSkate) c.push(["MS", false]);
  if (g.dayBeforeSkate) c.push(["DBS", false]);
  if (g.elevenF7D) c.push(["11F/7D", false]);
  return c.map(([t, warn]) => `<span class="chip${warn ? " warn" : ""}">${t}</span>`).join("");
}

function renderTable() {
  const games = state.season.games;
  const active = state.filter ? findSplit(state.filter) : null;
  const rows = active ? games.filter(active.test) : games;
  $("#schedCount").textContent = active
    ? `${rows.length} of ${games.length} games \u00B7 filtered by "${active.name}"`
    : `${games.length} games`;
  const tb = $("#schedTable tbody");
  tb.innerHTML = rows.map(g => {
    const oc = outcomeClass(g);
    const res = g.result
      ? `<span class="res res-${oc === "w" ? "w" : oc}">${g.result} ${g.gf}\u2013${g.ga}</span>`
      : `<span class="res res-fut">${g.timeLocal || ""}</span>`;
    return `<tr data-game="${g.game}">
      <td class="num">${g.game}</td>
      <td>${g.date}</td>
      <td>${(g.dayOfWeek || "").slice(0, 3)}</td>
      <td>${g.homeAway === "h" ? `<strong>${g.opponent}</strong>` : `<span class="opp-a">@ ${g.opponent}</span>`}</td>
      <td>${g.homeAway === "h" ? "Home" : "Away"}</td>
      <td>${res}</td>
      <td class="num">${g.restDays === null ? "\u2014" : g.restDays}</td>
      <td>${chips(g) || "\u2014"}</td>
      <td class="num">${g.foPct != null ? (g.foPct * 100).toFixed(1) : (g.fo50 === true ? "50+" : g.fo50 === false ? "<50" : "\u2014")}</td>
      <td class="moon" title="${g.moon || ""}">${moonIcon(g.moon)}</td>
    </tr>`;
  }).join("");
}

function renderAll() {
  renderHeader(); renderGrind(); renderSplits(); renderTable(); renderFilterNote();
  $("#updatedStamp").textContent = state.season.updated
    ? `Last data update: ${state.season.updated.slice(0, 10)}.` : "";
}

/* ---- boot ---------------------------------------------------------------- */
async function loadSeason(id) {
  const res = await fetch(`data/${id}.json`);
  if (!res.ok) throw new Error(`data/${id}.json not found`);
  state.season = await res.json();
  state.filter = null;
  renderAll();
}

async function boot() {
  try {
    const res = await fetch("data/index.json");
    state.index = await res.json();
    const sel = $("#seasonSelect");
    sel.innerHTML = state.index.seasons
      .map(s => `<option value="${s.seasonId}">${s.label}</option>`).join("");
    sel.addEventListener("change", () => loadSeason(sel.value).catch(showErr));
    await loadSeason(state.index.seasons[0].seasonId);
  } catch (e) { showErr(e); }
}
function showErr(e) {
  $("#recordLine").textContent =
    "Couldn't load season data. If you opened index.html directly, serve the folder instead: python -m http.server";
  console.error(e);
}
boot();
