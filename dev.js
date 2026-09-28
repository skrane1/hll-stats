/*
 * GWSM HLL Stats Dev Dashboard
 * Works in static GitHub Pages mode and automatically uses the API when configured.
 */
const API_BASE = String(window.GWSM_STATS_API || "").replace(/\/$/, "");
let ADMIN_KEY = sessionStorage.getItem("gwsm_admin_key") || "";
let unified = { updatedAt: null, players: {} };
let syncMeta = { sources: {}, matches: 0, duplicates: 0, logs: [] };

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const dateLabel = v => v ? new Date(v).toLocaleString("de-DE") : "—";

async function getJson(file, fallback) {
  try {
    const r = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}
  return fallback;
}

function setStatus(text, good = true) {
  if ($("#dev-status")) $("#dev-status").textContent = text;
  if ($("#sync-state")) $("#sync-state").textContent = text;
  const dot = document.querySelector(".status-dot");
  if (dot) dot.style.background = good ? "#77a56b" : "#a56b6b";
}

function authHeaders(extra = {}) {
  ADMIN_KEY = $("#admin-key")?.value || ADMIN_KEY;
  if (ADMIN_KEY) sessionStorage.setItem("gwsm_admin_key", ADMIN_KEY);
  return { "Content-Type": "application/json", "x-gwsm-admin-key": ADMIN_KEY, ...extra };
}

async function apiJson(url, options = {}) {
  const r = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function renderSources() {
  const sources = [
    ["CRCON", "crcon"],
    ["Frostbite", "frostbite"],
    ["HLL Ratings", "hll-ratings"],
    ["HLLRecords", "hllrecords"],
    ["HLLStats.dev", "hllstats.dev"],
    ["Discord", "discord"]
  ];
  $("#sources").innerHTML = sources.map(([name, key]) => {
    const s = syncMeta.sources?.[key] || {};
    const status = s.status || (name === "Discord" ? "ok" : "Nicht synchronisiert");
    return `<div class="source-card">
      <div class="source-title"><b>${esc(name)}</b><span class="source-state ${status === "ok" ? "ok" : "pending"}">${esc(status)}</span></div>
      <div class="source-meta">Letztes Update: ${dateLabel(s.updatedAt)}</div>
      <div class="source-meta">Matches: ${Number(s.matches || 0).toLocaleString("de-DE")}</div>
      ${s.error ? `<div class="source-error">${esc(s.error)}</div>` : ""}
    </div>`;
  }).join("");
}

function renderPlayers() {
  const q = ($("#dev-search")?.value || "").trim().toLocaleLowerCase("de-DE");
  const players = Object.entries(unified.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .filter(p => !q || String(p.username || p.id).toLocaleLowerCase("de-DE").includes(q))
    .sort((a,b) => String(a.username || a.id).localeCompare(String(b.username || b.id), "de-DE"));

  $("#dev-players").innerHTML = players.length ? `<table><thead><tr><th>Spieler</th><th>SteamID64</th><th>Stats</th><th>Coverage</th><th>Update</th></tr></thead><tbody>${players.map(p => `
    <tr>
      <td><b>${esc(p.username || p.id)}</b></td>
      <td><input class="inline-steam" data-player-id="${esc(p.discordId || p.id)}" value="${esc(p.steamId || "")}" placeholder="SteamID64" inputmode="numeric"></td>
      <td>${Object.keys(p.stats || {}).length} Kategorien</td>
      <td>${esc(p.coverage || "Discord")}</td>
      <td class="muted">${dateLabel(p.updatedAt)}</td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">Keine Unified-Stats vorhanden.</div>`;

  document.querySelectorAll(".inline-steam").forEach(input => input.addEventListener("change", () => saveSteam(input)));
}

async function saveSteam(input) {
  const id = input.dataset.playerId;
  const steamId = input.value.trim();
  try {
    const store = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
    if (store[id]) {
      store[id].steamId = steamId;
      store[id].updatedAt = new Date().toISOString();
      localStorage.setItem("gwsm_managed_players", JSON.stringify(store));
    }
    if (API_BASE) await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ steamId }) });
    setStatus("SteamID gespeichert");
    await load();
  } catch (e) {
    setStatus(`SteamID konnte nicht gespeichert werden: ${e.message}`, false);
  }
}

function renderLogs() {
  const logs = Array.isArray(syncMeta.logs) ? syncMeta.logs : [];
  $("#sync-log").innerHTML = logs.length ? logs.slice(0,30).map(log => `
    <div class="log-row"><span class="log-time">${dateLabel(log.time)}</span><span class="log-level">${esc(log.level || "info")}</span><span>${esc(log.message || "")}</span></div>`).join("") : `<div class="empty">Noch keine Sync-Informationen.</div>`;
}

async function load() {
  // GitHub Pages is intentionally read-only. The repository is the source
  // of truth; never let browser localStorage override synchronized data.
  unified = await getJson("unified-stats.json", { updatedAt: null, players: {} });
  syncMeta = await getJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });

  $("#last-sync").textContent = unified.updatedAt ? dateLabel(unified.updatedAt) : "—";
  $("#player-count").textContent = Object.keys(unified.players || {}).length.toLocaleString("de-DE");
  $("#match-count").textContent = Number(syncMeta.matches || 0).toLocaleString("de-DE");
  $("#duplicate-count").textContent = Number(syncMeta.duplicates || 0).toLocaleString("de-DE");

  renderSources();
  renderPlayers();
  renderLogs();
}async function triggerSync() {
  setStatus("Repository-Sync wird geprüft …");

  try {
    await load();
    const updated = unified.updatedAt ? new Date(unified.updatedAt) : null;
    const ageMinutes = updated ? Math.round((Date.now() - updated.getTime()) / 60000) : null;

    if (ageMinutes !== null && ageMinutes <= 10) {
      setStatus(`Synchronisiert vor ${Math.max(ageMinutes, 0)} Min. – ${Object.keys(unified.players || {}).length} Spieler`);
      return;
    }

    setStatus("GitHub Actions führt den automatischen Sync spätestens im nächsten Lauf aus.", true);
    const actionsUrl = "https://github.com/skrane1/hll-stats/actions/workflows/gwsm-stats-sync.yml";
    window.open(actionsUrl, "_blank", "noopener,noreferrer");
  } catch (e) {
    setStatus(`Sync-Status konnte nicht geladen werden: ${e.message}`, false);
  }
}*
 * GWSM HLL Stats Dev Dashboard
 * Works in static GitHub Pages mode and automatically uses the API when configured.
 */
const API_BASE = String(window.GWSM_STATS_API || "").replace(/\/$/, "");
let ADMIN_KEY = sessionStorage.getItem("gwsm_admin_key") || "";
let unified = { updatedAt: null, players: {} };
let syncMeta = { sources: {}, matches: 0, duplicates: 0, logs: [] };

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const dateLabel = v => v ? new Date(v).toLocaleString("de-DE") : "—";

async function getJson(file, fallback) {
  try {
    const r = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}
  return fallback;
}

function setStatus(text, good = true) {
  if ($("#dev-status")) $("#dev-status").textContent = text;
  if ($("#sync-state")) $("#sync-state").textContent = text;
  const dot = document.querySelector(".status-dot");
  if (dot) dot.style.background = good ? "#77a56b" : "#a56b6b";
}

function authHeaders(extra = {}) {
  ADMIN_KEY = $("#admin-key")?.value || ADMIN_KEY;
  if (ADMIN_KEY) sessionStorage.setItem("gwsm_admin_key", ADMIN_KEY);
  return { "Content-Type": "application/json", "x-gwsm-admin-key": ADMIN_KEY, ...extra };
}

async function apiJson(url, options = {}) {
  const r = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function renderSources() {
  const sources = [
    ["CRCON", "crcon"],
    ["Frostbite", "frostbite"],
    ["HLL Ratings", "hll-ratings"],
    ["HLLRecords", "hllrecords"],
    ["HLLStats.dev", "hllstats.dev"],
    ["Discord", "discord"]
  ];
  $("#sources").innerHTML = sources.map(([name, key]) => {
    const s = syncMeta.sources?.[key] || {};
    const status = s.status || (name === "Discord" ? "ok" : "Nicht synchronisiert");
    return `<div class="source-card">
      <div class="source-title"><b>${esc(name)}</b><span class="source-state ${status === "ok" ? "ok" : "pending"}">${esc(status)}</span></div>
      <div class="source-meta">Letztes Update: ${dateLabel(s.updatedAt)}</div>
      <div class="source-meta">Matches: ${Number(s.matches || 0).toLocaleString("de-DE")}</div>
      ${s.error ? `<div class="source-error">${esc(s.error)}</div>` : ""}
    </div>`;
  }).join("");
}

function renderPlayers() {
  const q = ($("#dev-search")?.value || "").trim().toLocaleLowerCase("de-DE");
  const players = Object.entries(unified.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .filter(p => !q || String(p.username || p.id).toLocaleLowerCase("de-DE").includes(q))
    .sort((a,b) => String(a.username || a.id).localeCompare(String(b.username || b.id), "de-DE"));

  $("#dev-players").innerHTML = players.length ? `<table><thead><tr><th>Spieler</th><th>SteamID64</th><th>Stats</th><th>Coverage</th><th>Update</th></tr></thead><tbody>${players.map(p => `
    <tr>
      <td><b>${esc(p.username || p.id)}</b></td>
      <td><input class="inline-steam" data-player-id="${esc(p.discordId || p.id)}" value="${esc(p.steamId || "")}" placeholder="SteamID64" inputmode="numeric"></td>
      <td>${Object.keys(p.stats || {}).length} Kategorien</td>
      <td>${esc(p.coverage || "Discord")}</td>
      <td class="muted">${dateLabel(p.updatedAt)}</td>
    </tr>`).join("")}</tbody></table>` : `<div class="empty">Keine Unified-Stats vorhanden.</div>`;

  document.querySelectorAll(".inline-steam").forEach(input => input.addEventListener("change", () => saveSteam(input)));
}

async function saveSteam(input) {
  const id = input.dataset.playerId;
  const steamId = input.value.trim();
  try {
    const store = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
    if (store[id]) {
      store[id].steamId = steamId;
      store[id].updatedAt = new Date().toISOString();
      localStorage.setItem("gwsm_managed_players", JSON.stringify(store));
    }
    if (API_BASE) await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ steamId }) });
    setStatus("SteamID gespeichert");
    await load();
  } catch (e) {
    setStatus(`SteamID konnte nicht gespeichert werden: ${e.message}`, false);
  }
}

function renderLogs() {
  const logs = Array.isArray(syncMeta.logs) ? syncMeta.logs : [];
  $("#sync-log").innerHTML = logs.length ? logs.slice(0,30).map(log => `
    <div class="log-row"><span class="log-time">${dateLabel(log.time)}</span><span class="log-level">${esc(log.level || "info")}</span><span>${esc(log.message || "")}</span></div>`).join("") : `<div class="empty">Noch keine Sync-Informationen.</div>`;
}

async function load() {
  // GitHub Pages is intentionally read-only. The repository is the source
  // of truth; never let browser localStorage override synchronized data.
  unified = await getJson("unified-stats.json", { updatedAt: null, players: {} });
  syncMeta = await getJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });

  $("#last-sync").textContent = unified.updatedAt ? dateLabel(unified.updatedAt) : "—";
  $("#player-count").textContent = Object.keys(unified.players || {}).length.toLocaleString("de-DE");
  $("#match-count").textContent = Number(syncMeta.matches || 0).toLocaleString("de-DE");
  $("#duplicate-count").textContent = Number(syncMeta.duplicates || 0).toLocaleString("de-DE");

  renderSources();
  renderPlayers();
  renderLogs();
}
