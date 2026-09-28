/*
 * GWSM HLL Stats Dev Dashboard
 *
 * The public website is static. Real synchronization must therefore happen
 * server-side. Configure the backend endpoint below when the worker/API is
 * deployed. The UI intentionally never receives API keys or provider secrets.
 */
const API_BASE = window.GWSM_STATS_API || (location.hostname.endsWith(".vercel.app") ? "" : "");
let ADMIN_KEY = sessionStorage.getItem("gwsm_admin_key") || "";
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
      <td><input class="inline-steam" data-player-id="${esc(p.discordId || p.id)}" value="${esc(p.steamId || "")}" placeholder="SteamID64" inputmode="numeric"></td>
      <td>${Number(s.kills || 0).toLocaleString("de-DE")}</td>
      <td>${Number(s.deaths || 0).toLocaleString("de-DE")}</td>
      <td class="value">${Number(s.kd || 0).toFixed(2)}</td>
      <td>${esc(coverage)}</td>
      <td class="muted">${dateLabel(p.updatedAt)}</td>
      <td><button class="refresh mini-sync" data-id="${esc(p.steamId || p.id)}">↻</button></td>
    </tr>`;
  }).join("")}</tbody></table>`;

  document.querySelectorAll(".mini-sync").forEach(btn => btn.addEventListener("click", () => syncPlayer(btn.dataset.id)));
  document.querySelectorAll(".inline-steam").forEach(input => input.addEventListener("change", async () => {
    const id = input.dataset.playerId;
    const steamId = input.value.trim();
    try {
      await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ steamId })
      });
      setStatus("SteamID gespeichert");
      await load();
      await loadManagedPlayers();
    } catch (e) {
      setStatus(`SteamID konnte nicht gespeichert werden: ${e.message}`, false);
    }
  }));
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

function ensureApi() {
  if (!API_BASE) {
    setStatus("Backend nicht verbunden", false);
    return false;
  }
  return true;
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

async function loadManagedPlayers() {
  if (!ensureApi()) return;
  try {
    const data = await apiJson(`${API_BASE}/api/admin/players`);
    const players = Object.entries(data.players || {}).map(([id,p]) => ({ id, ...p }));
    $("#managed-players").innerHTML = players.length ? `<div class="admin-player-list">${players.map(p => `
      <div class="admin-player-row">
        <div><b>${esc(p.username || p.id)}</b><div class="muted">Steam: ${esc(p.steamId || "—")} · Epic: ${esc(p.epicId || "—")} · Discord: ${esc(p.discordId || "—")} · Interne ID: ${esc(p.id)}</div></div>
        <div class="admin-row-actions">${(p.steamId || p.epicId) ? `<button class="refresh mini-sync-managed" data-steam="${esc(p.steamId || '')}" data-epic="${esc(p.epicId || '')}">↻ Sync</button>` : `<span class="muted">keine externe ID</span>`}<button class="refresh mini-edit" data-id="${esc(p.id)}">Bearbeiten</button><button class="danger mini-delete" data-id="${esc(p.id)}">Entfernen</button></div>
      </div>`).join("")}</div>` : `<div class="empty">Noch keine Spieler verwaltet.</div>`;
    document.querySelectorAll(".mini-edit").forEach(b => b.addEventListener("click", () => editManagedPlayer(b.dataset.id, players)));
    document.querySelectorAll(".mini-delete").forEach(b => b.addEventListener("click", () => deleteManagedPlayer(b.dataset.id)));
    document.querySelectorAll(".mini-sync-managed").forEach(b => b.addEventListener("click", () => trigger(PLAYER_SYNC_ENDPOINT, { steamId: b.dataset.steam || "", epicId: b.dataset.epic || "" })));
  } catch (e) { $("#managed-players").innerHTML = `<div class="source-error">${esc(e.message)}</div>`; }
}

function clearPlayerForm() { ["player-username","player-steam","player-epic","player-discord"].forEach(id => $("#"+id).value = ""); $("#player-save").dataset.editId = ""; $("#player-save").textContent = "＋ Spieler hinzufügen"; }

async function saveManagedPlayer() {
  if (!ensureApi()) return;
  const payload = { username: $("#player-username").value.trim(), steamId: $("#player-steam").value.trim(), epicId: $("#player-epic").value.trim(), discordId: $("#player-discord").value.trim() };
  if (!payload.username) return setStatus("Spielername erforderlich", false);
  try {
    const editId = $("#player-save").dataset.editId;
    await apiJson(`${API_BASE}/api/admin/players${editId ? "/" + encodeURIComponent(editId) : ""}`, { method: editId ? "PUT" : "POST", body: JSON.stringify(payload) });
    clearPlayerForm();
    await loadManagedPlayers();
    await load();
    setStatus("Spieler gespeichert");
  } catch (e) { setStatus(`Speichern fehlgeschlagen: ${e.message}`, false); }
}

function editManagedPlayer(id, players) {
  const p = players.find(x => x.id === id); if (!p) return;
  $("#player-username").value = p.username || ""; $("#player-steam").value = p.steamId || ""; $("#player-epic").value = p.epicId || ""; $("#player-discord").value = p.discordId || "";
  $("#player-save").dataset.editId = id; $("#player-save").textContent = "Speichern"; window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteManagedPlayer(id) {
  if (!confirm("Diesen GWSM-Spieler wirklich entfernen?")) return;
  try { await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadManagedPlayers(); await load(); setStatus("Spieler entfernt"); } catch (e) { setStatus(`Entfernen fehlgeschlagen: ${e.message}`, false); }
}

async function trigger(url, body = {}) {
  if (!API_BASE) {
    setStatus("Backend nicht verbunden", false);
    return;
  }
  try {
    setStatus("Synchronisierung läuft …");
    document.querySelectorAll(".sync-button,.mini-sync,#sync-selected").forEach(b => b.disabled = true);
    const data = await apiJson(url, { method: "POST", body: JSON.stringify(body) });
    setStatus("Synchronisierung erfolgreich");
    await load();
loadManagedPlayers();
  } catch (e) {
    setStatus(`Sync-Fehler: ${e.message}`, false);
  } finally {
    document.querySelectorAll(".sync-button,.mini-sync,#sync-selected").forEach(b => b.disabled = false);
  }
}

function syncPlayer(identifier) { return trigger(PLAYER_SYNC_ENDPOINT, identifier?.steamId || identifier?.epicId ? identifier : { steamId: identifier }); }

$("#sync-all").addEventListener("click", () => trigger(SYNC_ENDPOINT, { reason: "manual-dev" }));
$("#player-save").addEventListener("click", saveManagedPlayer);
$("#player-steam").addEventListener("keydown", e => { if (e.key === "Enter") saveManagedPlayer(); });
$("#player-username").addEventListener("keydown", e => { if (e.key === "Enter") saveManagedPlayer(); });
$("#admin-key").value = ADMIN_KEY;
$("#sync-selected").addEventListener("click", () => {
  const first = Object.entries(unified.players || {})[0]?.[1];
  if (!first) return trigger(SYNC_ENDPOINT, { reason: "manual-dev" });
  syncPlayer({ steamId: first.steamId || "", epicId: first.epicId || "" });
});
$("#dev-search").addEventListener("input", renderPlayers);
setInterval(() => { $("#dev-clock").textContent = new Date().toLocaleTimeString("de-DE"); }, 1000);
load();
loadManagedPlayers();
