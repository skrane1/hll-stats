/*
 * GWSM HLL Stats Dev Dashboard
 *
 * The public website is static. Real synchronization must therefore happen
 * server-side. Configure the backend endpoint below when the worker/API is
 * deployed. The UI intentionally never receives API keys or provider secrets.
 */
const API_BASE = window.GWSM_STATS_API || "";
const SYNC_ENDPOINT = `${API_BASE}/api/admin/stats/sync`;
const PLAYER_SYNC_ENDPOINT = `${API_BASE}/api/admin/stats/sync/player`;

let unified = { updatedAt: null, players: {} };
let syncMeta = { sources: {}, matches: 0, duplicates: 0, logs: [] };

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const dateLabel = v => v ? new Date(v).toLocaleString("de-DE") : "—";

async function getJson(file, fallback) {
  try {
    const r = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}
  return fallback;
}

function setStatus(text, good = true) {
  $("#dev-status").textContent = text;
  $("#sync-state").textContent = text;
  document.querySelector(".status-dot").style.background = good ? "#77a56b" : "#a56b6b";
}

function renderSources() {
  const sources = ["CRCON", "Frostbite", "HLL Ratings", "HLLRecords", "HLLStats.dev"];
  $("#sources").innerHTML = sources.map(name => {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const s = syncMeta.sources?.[key] || syncMeta.sources?.[name] || {};
    const status = s.status || "Nicht synchronisiert";
    const ok = status === "ok";
    return `<div class="source-card">
      <div class="source-title"><b>${esc(name)}</b><span class="source-state ${ok ? "ok" : "pending"}">${esc(status)}</span></div>
      <div class="source-meta">Letztes Update: ${dateLabel(s.updatedAt)}</div>
      <div class="source-meta">Matches: ${Number(s.matches || 0).toLocaleString("de-DE")}</div>
      ${s.error ? `<div class="source-error">${esc(s.error)}</div>` : ""}
    </div>`;
  }).join("");
}

function renderPlayers() {
  const q = $("#dev-search").value.trim().toLocaleLowerCase("de-DE");
  const players = Object.entries(unified.players || {})
    .map(([id, p]) => ({ id, ...p }))
    .filter(p => !q || String(p.username || p.id).toLocaleLowerCase("de-DE").includes(q))
    .sort((a,b) => String(a.username || a.id).localeCompare(String(b.username || b.id), "de-DE"));

  if (!players.length) {
    $("#dev-players").innerHTML = `<div class="empty">Keine Unified-Stats vorhanden.</div>`;
    return;
  }

  $("#dev-players").innerHTML = `<table><thead><tr><th>Spieler</th><th>SteamID64</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Coverage</th><th>Update</th><th></th></tr></thead><tbody>${players.map(p => {
    const s = p.stats || {};
    const coverage = p.coverage || "—";
    return `<tr>
      <td><b>${esc(p.username || p.id)}</b></td>
      <td class="muted">${esc(p.steamId || p.id)}</td>
      <td>${Number(s.kills || 0).toLocaleString("de-DE")}</td>
      <td>${Number(s.deaths || 0).toLocaleString("de-DE")}</td>
      <td class="value">${Number(s.kd || 0).toFixed(2)}</td>
      <td>${esc(coverage)}</td>
      <td class="muted">${dateLabel(p.updatedAt)}</td>
      <td><button class="refresh mini-sync" data-id="${esc(p.steamId || p.id)}">↻</button></td>
    </tr>`;
  }).join("")}</tbody></table>`;

  document.querySelectorAll(".mini-sync").forEach(btn => btn.addEventListener("click", () => syncPlayer(btn.dataset.id)));
}

function renderLogs() {
  const logs = Array.isArray(syncMeta.logs) ? syncMeta.logs : [];
  $("#sync-log").innerHTML = logs.length ? logs.slice(0,30).map(log => `
    <div class="log-row"><span class="log-time">${dateLabel(log.time)}</span><span class="log-level ${esc(log.level || "info")}">${esc(log.level || "info")}</span><span>${esc(log.message || "")}</span></div>
  `).join("") : `<div class="empty">Noch keine Sync-Informationen.</div>`;
}

async function load() {
  unified = await getJson("unified-stats.json", { updatedAt: null, players: {} });
  syncMeta = await getJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });
  const players = Object.keys(unified.players || {});
  $("#last-sync").textContent = unified.updatedAt ? dateLabel(unified.updatedAt) : "—";
  $("#player-count").textContent = players.length.toLocaleString("de-DE");
  $("#match-count").textContent = Number(syncMeta.matches || 0).toLocaleString("de-DE");
  $("#duplicate-count").textContent = Number(syncMeta.duplicates || 0).toLocaleString("de-DE");
  renderSources(); renderPlayers(); renderLogs();
}

async function trigger(url, body = {}) {
  if (!API_BASE) {
    setStatus("Backend noch nicht konfiguriert", false);
    alert("Der manuelle Sync ist bereits vorbereitet, aber das Backend ist noch nicht verbunden. Setze GWSM_STATS_API auf die URL deines Stats-Backends.");
    return;
  }
  try {
    setStatus("Synchronisierung läuft …");
    document.querySelectorAll(".sync-button,.mini-sync,#sync-selected").forEach(b => b.disabled = true);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    setStatus("Synchronisierung erfolgreich");
    await load();
  } catch (e) {
    setStatus(`Sync-Fehler: ${e.message}`, false);
  } finally {
    document.querySelectorAll(".sync-button,.mini-sync,#sync-selected").forEach(b => b.disabled = false);
  }
}

function syncPlayer(steamId) { return trigger(PLAYER_SYNC_ENDPOINT, { steamId }); }

$("#sync-all").addEventListener("click", () => trigger(SYNC_ENDPOINT, { reason: "manual-dev" }));
$("#sync-selected").addEventListener("click", () => {
  const first = Object.keys(unified.players || {})[0];
  if (!first) return trigger(SYNC_ENDPOINT, { reason: "manual-dev" });
  syncPlayer(first);
});
$("#dev-search").addEventListener("input", renderPlayers);
setInterval(() => { $("#dev-clock").textContent = new Date().toLocaleTimeString("de-DE"); }, 1000);
load();
