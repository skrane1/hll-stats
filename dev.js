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
  const names = ["CRCON", "Frostbite", "HLL Ratings", "HLLRecords", "HLLStats.dev", "Discord"];
  $("#sources").innerHTML = names.map(name => {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
  unified = JSON.parse(localStorage.getItem("gwsm_unified_stats") || "null") || await getJson("unified-stats.json", { updatedAt: null, players: {} });
  syncMeta = JSON.parse(localStorage.getItem("gwsm_sync_meta") || "null") || await getJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });
  $("#last-sync").textContent = unified.updatedAt ? dateLabel(unified.updatedAt) : "—";
  $("#player-count").textContent = Object.keys(unified.players || {}).length.toLocaleString("de-DE");
  $("#match-count").textContent = Number(syncMeta.matches || 0).toLocaleString("de-DE");
  $("#duplicate-count").textContent = Number(syncMeta.duplicates || 0).toLocaleString("de-DE");
  renderSources();
  renderPlayers();
  renderLogs();
}

function playerId(discord, steam, epic) {
  return discord || steam || epic || `local-${Date.now()}`;
}

function clearPlayerForm() {
  ["player-username","player-steam","player-epic","player-discord"].forEach(id => { if ($("#"+id)) $("#"+id).value = ""; });
  $("#player-save").dataset.editId = "";
  $("#player-save").textContent = "＋ Spieler hinzufügen";
}

async function loadManagedPlayers() {
  if (API_BASE) {
    try {
      const data = await apiJson(`${API_BASE}/api/admin/players`);
      renderManagedPlayers(Object.entries(data.players || {}).map(([id,p]) => ({id,...p})));
      return;
    } catch (e) {
      setStatus("API nicht erreichbar – lokaler Modus", false);
    }
  }
  const local = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
  const players = Object.keys(local).length ? local : (await getJson("players.json", {players:{}})).players || {};
  renderManagedPlayers(Object.entries(players).map(([id,p]) => ({id,...p})));
}

function renderManagedPlayers(players) {
  $("#managed-players").innerHTML = players.length ? `<div class="admin-player-list">${players.map(p => `
    <div class="admin-player-row">
      <div><b>${esc(p.username || p.id)}</b><div class="muted">Steam: ${esc(p.steamId || "—")} · Epic: ${esc(p.epicId || "—")} · Discord: ${esc(p.discordId || "—")}</div></div>
      <div class="admin-row-actions"><button class="refresh mini-edit" data-id="${esc(p.id)}">Bearbeiten</button><button class="danger mini-delete" data-id="${esc(p.id)}">Entfernen</button></div>
    </div>`).join("")}</div>` : `<div class="empty">Noch keine Spieler verwaltet.</div>`;

  document.querySelectorAll(".mini-edit").forEach(b => b.addEventListener("click", () => editManagedPlayer(b.dataset.id, players)));
  document.querySelectorAll(".mini-delete").forEach(b => b.addEventListener("click", () => deleteManagedPlayer(b.dataset.id)));
}

async function saveManagedPlayer() {
  const payload = {
    username: $("#player-username").value.trim(),
    steamId: $("#player-steam").value.trim(),
    epicId: $("#player-epic").value.trim(),
    discordId: $("#player-discord").value.trim()
  };
  if (!payload.username) return setStatus("Spielername erforderlich", false);

  const editId = $("#player-save").dataset.editId;
  if (API_BASE) {
    try {
      await apiJson(`${API_BASE}/api/admin/players${editId ? "/" + encodeURIComponent(editId) : ""}`, {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      clearPlayerForm();
      await loadManagedPlayers();
      await load();
      setStatus("Spieler gespeichert");
      return;
    } catch (e) {
      setStatus("API nicht erreichbar – lokal gespeichert", false);
    }
  }

  const store = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
  const id = editId || playerId(payload.discordId, payload.steamId, payload.epicId);
  store[id] = { id, ...payload, aliases: [], createdAt: store[id]?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  localStorage.setItem("gwsm_managed_players", JSON.stringify(store));
  clearPlayerForm();
  await loadManagedPlayers();
  setStatus("Spieler lokal gespeichert");
}

function editManagedPlayer(id, players) {
  const p = players.find(x => x.id === id);
  if (!p) return;
  $("#player-username").value = p.username || "";
  $("#player-steam").value = p.steamId || "";
  $("#player-epic").value = p.epicId || "";
  $("#player-discord").value = p.discordId || "";
  $("#player-save").dataset.editId = id;
  $("#player-save").textContent = "Speichern";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteManagedPlayer(id) {
  if (!confirm("Diesen GWSM-Spieler wirklich entfernen?")) return;
  if (API_BASE) {
    try {
      await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadManagedPlayers();
      await load();
      setStatus("Spieler entfernt");
      return;
    } catch (_) {}
  }
  const store = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
  delete store[id];
  localStorage.setItem("gwsm_managed_players", JSON.stringify(store));
  await loadManagedPlayers();
  setStatus("Spieler lokal entfernt");
}

async function triggerSync() {
  setStatus("Synchronisierung läuft …");

  try {
    // If the real API is available, use it.
    if (API_BASE) {
      await apiJson(`${API_BASE}/api/admin/stats/sync`, {
        method: "POST",
        body: JSON.stringify({ reason: "manual-dev" })
      });
      await load();
      await loadManagedPlayers();
      setStatus("Synchronisierung erfolgreich");
      return;
    }

    // GitHub Pages fallback: rebuild the unified dataset directly from the
    // repository's current stats.json and persist the result locally.
    const stats = await getJson("stats.json", {});
    const registry = await getJson("players.json", { version: 1, players: {} });
    const now = new Date().toISOString();
    const players = {};

    for (const [discordId, raw] of Object.entries(stats || {})) {
      const managed = registry.players?.[discordId] || {};
      const values = {};
      for (const [key, value] of Object.entries(raw || {})) {
        if (["username", "discordId", "steamId", "epicId"].includes(key)) continue;
        if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
      }

      const id = managed.steamId || managed.epicId || discordId;
      players[id] = {
        id,
        username: managed.username || raw.username || discordId,
        steamId: managed.steamId || "",
        epicId: managed.epicId || "",
        discordId,
        stats: values,
        coverage: managed.steamId || managed.epicId ? "Discord + externe ID" : "Discord",
        updatedAt: now
      };
    }

    unified = { updatedAt: now, players };
    syncMeta = {
      ...syncMeta,
      updatedAt: now,
      sources: {
        ...(syncMeta.sources || {}),
        discord: {
          status: "ok",
          updatedAt: now,
          matches: Object.keys(stats || {}).length
        }
      },
      logs: [
        { time: now, level: "info", message: `Manueller Browser-Sync: ${Object.keys(players).length} Spieler.` },
        ...(Array.isArray(syncMeta.logs) ? syncMeta.logs : [])
      ].slice(0, 50)
    };

    localStorage.setItem("gwsm_unified_stats", JSON.stringify(unified));
    localStorage.setItem("gwsm_sync_meta", JSON.stringify(syncMeta));

    renderSources();
    renderPlayers();
    renderLogs();
    $("#last-sync").textContent = dateLabel(now);
    $("#player-count").textContent = Object.keys(players).length.toLocaleString("de-DE");
    $("#match-count").textContent = Object.keys(stats || {}).length.toLocaleString("de-DE");
    $("#duplicate-count").textContent = "0";

    setStatus(`Synchronisierung erfolgreich – ${Object.keys(players).length} Spieler`);
  } catch (e) {
    setStatus(`Sync-Fehler: ${e.message}`, false);
  }
}
$("#sync-all").addEventListener("click", triggerSync);
$("#player-save").addEventListener("click", saveManagedPlayer);
$("#player-steam").addEventListener("keydown", e => { if (e.key === "Enter") saveManagedPlayer(); });
$("#player-username").addEventListener("keydown", e => { if (e.key === "Enter") saveManagedPlayer(); });
$("#admin-key").value = ADMIN_KEY;
$("#sync-selected").addEventListener("click", triggerSync);
$("#dev-search").addEventListener("input", renderPlayers);
setInterval(() => { $("#dev-clock").textContent = new Date().toLocaleTimeString("de-DE"); }, 1000);

load();
loadManagedPlayers();
