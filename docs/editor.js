/* editor.js — hand-entry form for manual (non-API) game fields */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const CFG_KEY = "scheduleLabGitHubCfg";

const state = { seasons: [], season: null, manual: {}, manualSha: null, currentDate: null };

/* ---- connection settings (stored only in this browser) ------------------- */
function loadCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); }
  catch { return {}; }
}
function saveCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function clearCfg() { localStorage.removeItem(CFG_KEY); }

function refreshConnStatus() {
  const cfg = loadCfg();
  const el = $("#connStatus");
  if (cfg.token && cfg.owner && cfg.repo) {
    el.textContent = `Connected to ${cfg.owner}/${cfg.repo} (${cfg.branch || "main"}) \u2014 saves commit directly.`;
    el.className = "ed-status ok";
  } else {
    el.textContent = "Not connected \u2014 you can still fill the form and download the file to commit yourself.";
    el.className = "ed-status";
  }
}

$("#settingsBtn").addEventListener("click", () => {
  const panel = $("#settingsPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const cfg = loadCfg();
    $("#cfgOwner").value = cfg.owner || "";
    $("#cfgRepo").value = cfg.repo || "";
    $("#cfgBranch").value = cfg.branch || "main";
    $("#cfgToken").value = cfg.token || "";
  }
});
$("#saveSettingsBtn").addEventListener("click", () => {
  saveCfg({
    owner: $("#cfgOwner").value.trim(),
    repo: $("#cfgRepo").value.trim(),
    branch: $("#cfgBranch").value.trim() || "main",
    token: $("#cfgToken").value.trim(),
  });
  refreshConnStatus();
  $("#settingsPanel").hidden = true;
});
$("#clearSettingsBtn").addEventListener("click", () => {
  clearCfg();
  $("#cfgOwner").value = ""; $("#cfgRepo").value = ""; $("#cfgToken").value = "";
  refreshConnStatus();
});

/* ---- GitHub Contents API helpers -----------------------------------------
   Uses a fine-grained PAT stored only in this browser's localStorage.
   Talks directly to api.github.com — the token never goes anywhere else.
   NOTE: this relies on GitHub's REST API allowing cross-origin requests
   from a static page; that's documented GitHub behavior, but hasn't been
   exercised from this specific setup, so if a save fails with a network/
   CORS-looking error, use the Download button as a guaranteed fallback. */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGet(path) {
  const cfg = loadCfg();
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch || "main"}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return { json: {}, sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { json: JSON.parse(base64ToUtf8(data.content)), sha: data.sha };
}

async function ghPut(path, obj, sha, message) {
  const cfg = loadCfg();
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(obj, null, 1)),
    branch: cfg.branch || "main",
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---- data loading ---------------------------------------------------------*/
async function loadSeasonList() {
  const res = await fetch("data/index.json");
  const idx = await res.json();
  state.seasons = idx.seasons;
  const sel = $("#seasonSelect");
  sel.innerHTML = idx.seasons.map(s => `<option value="${s.seasonId}">${s.label}</option>`).join("");
  sel.addEventListener("change", () => loadSeason(sel.value));
  await loadSeason(idx.seasons[0].seasonId);
}

async function loadSeason(seasonId) {
  const res = await fetch(`data/${seasonId}.json`);
  state.season = await res.json();

  // Manual data: read via GitHub API when connected (gives us the sha we
  // need to save later); otherwise a plain fetch, read-only.
  const cfg = loadCfg();
  try {
    if (cfg.token && cfg.owner && cfg.repo) {
      const { json, sha } = await ghGet(`docs/data/manual/${seasonId}.json`);
      state.manual = json; state.manualSha = sha;
    } else {
      const mres = await fetch(`data/manual/${seasonId}.json?t=${Date.now()}`, { cache: "no-store" });
      state.manual = mres.ok ? await mres.json() : {};
      state.manualSha = null;
    }
  } catch (e) {
    console.error(e);
    state.manual = {}; state.manualSha = null;
  }

  const gsel = $("#gameSelect");
  gsel.innerHTML = state.season.games.map(g =>
    `<option value="${g.date}">#${g.game} \u00B7 ${g.date} \u00B7 ${g.homeAway === "h" ? "vs" : "@"} ${g.opponent}${g.result ? " \u00B7 " + g.result : ""}</option>`
  ).join("");
  gsel.onchange = () => showGame(gsel.value);
  showGame(state.season.games[0].date);
  renderBulkTable();
}

function findGame(date) { return state.season.games.find(g => g.date === date); }

function showGame(date) {
  state.currentDate = date;
  const g = findGame(date);
  if (!g) return;
  $("#formSection").hidden = false;
  $("#gameHeading").textContent =
    `#${g.game} \u00B7 ${g.date} \u00B7 ${g.homeAway === "h" ? "vs" : "@"} ${g.opponent}`;
  $("#gameSub").textContent = g.result
    ? `${g.result} ${g.gf}\u2013${g.ga} \u00B7 ${g.dayOfWeek}` : `Scheduled \u00B7 ${g.dayOfWeek} \u00B7 ${g.timeLocal || ""}`;

  const m = state.manual[date] || {};
  const setSel = (id, key) => { $(id).value = key in m ? String(m[key]) : ""; };
  setSel("#f_mdo", "mdo");
  setSel("#f_ms", "morningSkate");
  setSel("#f_dbs", "dayBeforeSkate");
  setSel("#f_11f", "elevenF7D");
  setSel("#f_cfo", "contestedFoWin");
  $("#f_notes").value = m.notes || "";

  // special teams tri-state
  $("#f_st").value = m.specialTeamsWin === true ? "win"
    : m.specialTeamsTie === true ? "tie"
    : (m.specialTeamsWin === false && m.specialTeamsTie === false) ? "loss" : "";

  // early arrival only meaningful on away games
  const eaWrap = $("#f_ea_wrap");
  if (g.homeAway === "h") {
    eaWrap.classList.add("disabled");
    $("#f_ea").value = "";
  } else {
    eaWrap.classList.remove("disabled");
    setSel("#f_ea", "earlyArrival");
  }
  $("#saveStatus").textContent = "";
  $("#saveStatus").className = "ed-status";
}

/* ---- reading the form back out -------------------------------------------*/
function readFormFields() {
  const val = id => { const v = $(id).value; return v === "" ? undefined : v === "true" ? true : v === "false" ? false : v; };
  const out = {};
  const mdo = val("#f_mdo"); if (mdo !== undefined) out.mdo = mdo;
  const ms = val("#f_ms"); if (ms !== undefined) out.morningSkate = ms;
  const dbs = val("#f_dbs"); if (dbs !== undefined) out.dayBeforeSkate = dbs;
  const f11 = val("#f_11f"); if (f11 !== undefined) out.elevenF7D = f11;
  const cfo = val("#f_cfo"); if (cfo !== undefined) out.contestedFoWin = cfo;
  const g = findGame(state.currentDate);
  if (g && g.homeAway !== "h") {
    const ea = val("#f_ea"); if (ea !== undefined) out.earlyArrival = ea;
  }
  const st = $("#f_st").value;
  if (st === "win") { out.specialTeamsWin = true; out.specialTeamsTie = false; }
  else if (st === "tie") { out.specialTeamsWin = false; out.specialTeamsTie = true; }
  else if (st === "loss") { out.specialTeamsWin = false; out.specialTeamsTie = false; }
  const notes = $("#f_notes").value.trim(); if (notes) out.notes = notes;
  return out;
}

function buildUpdatedManual() {
  const updated = JSON.parse(JSON.stringify(state.manual));
  const fields = readFormFields();
  if (Object.keys(fields).length === 0) delete updated[state.currentDate];
  else updated[state.currentDate] = fields;
  return updated;
}

/* ---- save -------------------------------------------------------------- */
$("#saveGameBtn").addEventListener("click", async () => {
  const cfg = loadCfg();
  const statusEl = $("#saveStatus");
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    statusEl.textContent = "Not connected. Use \u2699 Connection settings, or Download instead.";
    statusEl.className = "ed-status err";
    return;
  }
  statusEl.textContent = "Saving\u2026";
  statusEl.className = "ed-status";
  try {
    const path = `docs/data/manual/${state.season.seasonId}.json`;
    // re-fetch fresh sha right before writing, in case it changed elsewhere
    const fresh = await ghGet(path);
    state.manual = fresh.json; state.manualSha = fresh.sha;
    const updated = buildUpdatedManual();
    await ghPut(path, updated, state.manualSha, `Manual flags: ${state.currentDate}`);
    state.manual = updated;
    statusEl.textContent = "Saved \u2014 committed to " + cfg.branch + ". The site will show this on next load.";
    statusEl.className = "ed-status ok";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Save failed: " + e.message + " \u2014 try Download instead.";
    statusEl.className = "ed-status err";
  }
});

$("#downloadBtn").addEventListener("click", () => {
  const updated = buildUpdatedManual();
  state.manual = updated; // keep in-memory state in sync so further edits this
                           // session accumulate instead of being lost on the
                           // next download
  const blob = new Blob([JSON.stringify(updated, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.season.seasonId}.json`;
  a.click();
  const statusEl = $("#saveStatus");
  statusEl.textContent = `Downloaded. Replace docs/data/manual/${state.season.seasonId}.json with this file and push.`;
  statusEl.className = "ed-status ok";
});

/* ---- bulk (mass) edit ------------------------------------------------------
   One row per game, all editable inline. Save once for the whole batch --
   one GitHub commit instead of one per game -- and Download always exports
   every row's current value, so nothing gets lost between edits. */
const SEL = (id, opts) =>
  `<select data-f="${id}"><option value="">\u2014</option>${opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
const YN = [["true","Y"],["false","N"]];
const STOPTS = [["win","Win"],["tie","Tie"],["loss","Loss"]];

function bulkRowHtml(g) {
  const m = state.manual[g.date] || {};
  const sel = (field, opts, key) => {
    const cur = key in m ? String(m[key]) : "";
    return SEL(field, opts).replace("<select", `<select data-current="${cur}"`);
  };
  const eaCell = g.homeAway === "h"
    ? `<span class="bc-na">\u2014</span>`
    : sel("earlyArrival", YN, "earlyArrival");
  const stCur = m.specialTeamsWin === true ? "win" : m.specialTeamsTie === true ? "tie"
    : (m.specialTeamsWin === false && m.specialTeamsTie === false) ? "loss" : "";
  return `<tr data-date="${g.date}">
    <td class="num">${g.game}</td>
    <td>${g.date}</td>
    <td>${g.homeAway === "h" ? "" : "@"}${g.opponent}</td>
    <td>${g.homeAway === "h" ? "Home" : "Away"}</td>
    <td>${sel("mdo", YN, "mdo")}</td>
    <td>${sel("morningSkate", YN, "morningSkate")}</td>
    <td>${sel("dayBeforeSkate", YN, "dayBeforeSkate")}</td>
    <td>${eaCell}</td>
    <td>${SEL("specialTeam", STOPTS).replace("<select", `<select data-current="${stCur}"`)}</td>
    <td>${sel("contestedFoWin", YN, "contestedFoWin")}</td>
    <td>${sel("elevenF7D", YN, "elevenF7D")}</td>
    <td><input type="text" data-f="notes" value="${(m.notes || "").replace(/"/g, "&quot;")}"></td>
  </tr>`;
}

function renderBulkTable() {
  const tb = $("#bulkTable tbody");
  tb.innerHTML = state.season.games.map(bulkRowHtml).join("");
  // apply each select's saved current value (can't do via HTML `selected`
  // attribute cleanly with dynamic option lists, so set .value directly)
  tb.querySelectorAll("select[data-current]").forEach(sel => {
    sel.value = sel.dataset.current || "";
  });
  tb.querySelectorAll("select, input").forEach(el => {
    el.addEventListener("input", () => {
      el.closest("tr").classList.add("edited");
    });
  });
}

function readBulkTable() {
  const updated = JSON.parse(JSON.stringify(state.manual));
  $("#bulkTable tbody").querySelectorAll("tr").forEach(row => {
    // Only rows the user actually interacted with this session are eligible
    // to change. This is a deliberate safety choice: if it applied to every
    // row regardless, a save/download would silently overwrite or delete
    // other games' data based on whatever the <select> pre-fill happened to
    // show, with no explicit user action behind it. Skipping untouched rows
    // means existing data can only ever be changed by a real edit.
    if (!row.classList.contains("edited")) return;
    const date = row.dataset.date;
    const fields = {};
    row.querySelectorAll("select[data-f], input[data-f]").forEach(el => {
      const key = el.dataset.f;
      const v = el.value;
      if (v === "" || v == null) return;
      if (key === "notes") { fields.notes = v.trim(); return; }
      if (key === "specialTeam") {
        if (v === "win") { fields.specialTeamsWin = true; fields.specialTeamsTie = false; }
        else if (v === "tie") { fields.specialTeamsWin = false; fields.specialTeamsTie = true; }
        else if (v === "loss") { fields.specialTeamsWin = false; fields.specialTeamsTie = false; }
        return;
      }
      fields[key] = v === "true" ? true : v === "false" ? false : v;
    });
    if (Object.keys(fields).length === 0) delete updated[date];
    else updated[date] = fields;
  });
  return updated;
}

$("#bulkSaveBtn").addEventListener("click", async () => {
  const cfg = loadCfg();
  const statusEl = $("#bulkStatus");
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    statusEl.textContent = "Not connected. Use \u2699 Connection settings, or Download instead.";
    statusEl.className = "ed-status err";
    return;
  }
  statusEl.textContent = "Saving\u2026";
  statusEl.className = "ed-status";
  try {
    const path = `docs/data/manual/${state.season.seasonId}.json`;
    const fresh = await ghGet(path);
    // Merge the freshly-fetched remote copy underneath our in-progress edits
    // rather than overwriting them, in case something else changed the file
    // since this page loaded.
    state.manual = fresh.json; state.manualSha = fresh.sha;
    const updated = readBulkTable();
    await ghPut(path, updated, state.manualSha, `Manual flags: bulk update (${Object.keys(updated).length} games)`);
    state.manual = updated;
    document.querySelectorAll("#bulkTable tr.edited").forEach(tr => tr.classList.remove("edited"));
    statusEl.textContent = `Saved \u2014 committed to ${cfg.branch}. ${Object.keys(updated).length} games have manual data.`;
    statusEl.className = "ed-status ok";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Save failed: " + e.message + " \u2014 try Download instead.";
    statusEl.className = "ed-status err";
  }
});

$("#bulkDownloadBtn").addEventListener("click", () => {
  const updated = readBulkTable();
  state.manual = updated;
  const blob = new Blob([JSON.stringify(updated, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.season.seasonId}.json`;
  a.click();
  document.querySelectorAll("#bulkTable tr.edited").forEach(tr => tr.classList.remove("edited"));
  const statusEl = $("#bulkStatus");
  statusEl.textContent = `Downloaded all ${Object.keys(updated).length} games with data. Replace docs/data/manual/${state.season.seasonId}.json and push.`;
  statusEl.className = "ed-status ok";
});

/* ---- view toggle --------------------------------------------------------- */
$("#viewBulkBtn").addEventListener("click", () => {
  $("#bulkSection").hidden = false;
  $("#singlePickerRow").hidden = true;
  $("#formSection").hidden = true;
  $("#viewBulkBtn").classList.add("view-active");
  $("#viewSingleBtn").classList.remove("view-active");
});
$("#viewSingleBtn").addEventListener("click", () => {
  $("#bulkSection").hidden = true;
  $("#singlePickerRow").hidden = false;
  $("#formSection").hidden = false;
  $("#viewSingleBtn").classList.add("view-active");
  $("#viewBulkBtn").classList.remove("view-active");
});

refreshConnStatus();
loadSeasonList();
