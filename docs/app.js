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
    { id: "t3",    name: "Tied into 3rd",     test: g => g.tiedIntoThird === true },
    { id: "w3",    name: "Won the 3rd",       test: g => g.wonThird === true },
    { id: "fo50",  name: "Won 50%+ faceoffs", test: g => g.fo50 === true },
  ]},
  { group: "Team ops (hand-tracked)", items: [
    { id: "mdo",   name: "After mandatory day off", test: g => g.mdo === true },
    { id: "ms",    name: "Morning skate",     test: g => g.morningSkate === true },
    { id: "noms",  name: "No morning skate",  test: g => g.morningSkate === false },
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
  const remaining = s.games.length - r.gp;
  $("#recordLine").innerHTML =
    `<strong>${fmtRec(r)}</strong> &nbsp;\u00B7&nbsp; ${r.pts} PTS &nbsp;\u00B7&nbsp; ` +
    `${fmtPct(r.ptsPct)} PTS% &nbsp;\u00B7&nbsp; ${r.gp} played` +
    (remaining ? ` &nbsp;\u00B7&nbsp; ${remaining} remaining` : "");
}

function grindColor(g) {
  return { w: "var(--orange)", l: "var(--loss)", otl: "var(--otl)", fut: "var(--fut)" }[outcomeClass(g)];
}

function renderGrind() {
  const games = state.season.games;
  const wrap = $("#grindStrip");
  if (!games.length) { wrap.innerHTML = ""; return; }
  const W = 1000, H = 112, top = 26, bh = 52;
  const t0 = new Date(games[0].date).getTime() - 3 * 864e5;
  const t1 = new Date(games[games.length - 1].date).getTime() + 3 * 864e5;
  const x = d => 8 + (new Date(d).getTime() - t0) / (t1 - t0) * (W - 16);

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Season timeline">`;
  // month labels + gridlines
  const cur = new Date(games[0].date); cur.setDate(1);
  const end = new Date(games[games.length - 1].date);
  while (cur <= end) {
    const gx = x(cur.toISOString().slice(0, 10));
    if (gx > 14 && gx < W - 14) {
      svg += `<line x1="${gx.toFixed(1)}" y1="${top - 8}" x2="${gx.toFixed(1)}" y2="${top + bh + 10}" stroke="#16395E" stroke-width="1"/>`;
      svg += `<text x="${(gx + 4).toFixed(1)}" y="${H - 8}" fill="#8FA9C4" font-size="11" font-family="Barlow Condensed" letter-spacing="1.5">${cur.toLocaleString("en", { month: "short" }).toUpperCase()}</text>`;
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  const active = state.filter ? findSplit(state.filter) : null;
  games.forEach(g => {
    const gx = x(g.date);
    const dim = active && !active.test(g) ? " dim" : "";
    const h = isPlayed(g) ? bh : bh * 0.55;
    svg += `<rect class="tick${dim}" data-game="${g.game}" x="${(gx - 1.6).toFixed(1)}" y="${top + (bh - h)}" width="3.2" height="${h}" rx="1.2" fill="${grindColor(g)}"/>`;
  });
  svg += "</svg>";
  wrap.innerHTML = svg;

  const tip = $("#tooltip");
  wrap.querySelectorAll(".tick").forEach(el => {
    const g = games[+el.dataset.game - 1];
    el.addEventListener("mousemove", e => {
      tip.hidden = false;
      const res = g.result
        ? `<b>${g.result}</b> ${g.gf}\u2013${g.ga}` : "not played";
      tip.innerHTML = `#${g.game} \u00B7 ${g.date} \u00B7 ${g.homeAway === "h" ? "vs" : "@"} ${g.opponent}<br>${res}` +
        (g.b2b ? " \u00B7 B2B" : "") + (g.threeIn4 ? " \u00B7 3-in-4" : "");
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
  if (g.mdo) c.push(["MDO", false]);
  if (g.morningSkate) c.push(["MS", false]);
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
