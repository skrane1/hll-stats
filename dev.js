/*
 * GWSM HLL Stats Dev Dashboard
 * GitHub Pages reads the repository; an optional backend can handle writes.
 */
const API_BASE = String(window.GWSM_STATS_API || "").replace(/\/$/, "");
let ADMIN_KEY = sessionStorage.getItem("gwsm_admin_key") || "";
let GITHUB_TOKEN = sessionStorage.getItem("gwsm_github_token") || "";
const GH_OWNER = "skrane1";
const GH_REPO = "hll-stats";
const GH_BRANCH = "main";
let unified = { updatedAt: null, players: {} };
let syncMeta = { sources: {}, matches: 0, duplicates: 0, logs: [] };

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[char]));
const dateLabel = value => value ? new Date(value).toLocaleString("de-DE") : "—";

async function getJson(file, fallback) {
  // GitHub Pages can keep JSON files cached independently of the HTML.
  // Read the repository source first so the Dev dashboard always sees the
  // same sync-meta/unified data that the GitHub Action just committed.
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/${file}?t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (response.ok) return await response.json();
  } catch (_) {}

  try {
    const response = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) return await response.json();
  } catch (_) {}

  return fallback;
}

function setStatus(message, good = true) {
  if ($("#dev-status")) $("#dev-status").textContent = message;
  if ($("#sync-state")) $("#sync-state").textContent = message;
  const dot = document.querySelector(".status-dot");
  if (dot) dot.style.background = good ? "#77a56b" : "#a56b6b";
}

function authHeaders(extra = {}) {
  ADMIN_KEY = $("#admin-key")?.value || ADMIN_KEY;
  if (ADMIN_KEY) sessionStorage.setItem("gwsm_admin_key", ADMIN_KEY);
  return { "Content-Type": "application/json", "x-gwsm-admin-key": ADMIN_KEY, ...extra };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function githubFile(path) {
  if (!GITHUB_TOKEN) throw new Error("GitHub-Token fehlt");
  const response = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10"
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub HTTP ${response.status}`);
  const bytes = Uint8Array.from(atob(data.content.replace(/\\n/g, "")), c => c.charCodeAt(0));
  return { content: new TextDecoder().decode(bytes), sha: data.sha };
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function githubWriteFile(path, content, sha, message) {
  if (!GITHUB_TOKEN) throw new Error("GitHub-Token fehlt");
  const response = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content: base64Utf8(content),
      sha,
      branch: GH_BRANCH
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub HTTP ${response.status}`);
  return data;
}

async function loadRepositoryPlayers() {
  const file = await githubFile("players.json");
  return { data: JSON.parse(file.content), sha: file.sha };
}

async function saveRepositoryPlayers(players, sha, message) {
  const next = JSON.stringify(players, null, 2) + "\n";
  return githubWriteFile("players.json", next, sha, message);
}

async function migrateLocalPlayers() {
  if (!GITHUB_TOKEN) return;
  const local = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
  const localSteam = Object.values(local).filter(p => p && p.steamId);
  if (!localSteam.length) return;

  try {
    const { data, sha } = await loadRepositoryPlayers();
    data.version = 1;
    data.players ||= {};
    let changed = false;

    for (const localPlayer of localSteam) {
      const id = localPlayer.discordId || localPlayer.id;
      if (!id) continue;
      const existing = data.players[id] || {
        id,
        username: localPlayer.username || id,
        steamId: "",
        epicId: "",
        discordId: localPlayer.discordId || id,
        aliases: [],
        createdAt: new Date().toISOString()
      };
      if (localPlayer.steamId && existing.steamId !== localPlayer.steamId) {
        existing.steamId = localPlayer.steamId;
        existing.updatedAt = new Date().toISOString();
        data.players[id] = existing;
        changed = true;
      }
    }

    if (changed) {
      await saveRepositoryPlayers(data, sha, "Sync player identifiers from Dev");
      localStorage.removeItem("gwsm_managed_players");
      setStatus("Lokale Spieler-IDs ins Repository übernommen");
    }
  } catch (error) {
    setStatus(`Repository-Speicherung: ${error.message}`, false);
  }
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
    const source = syncMeta.sources?.[key] || {};
    let status = source.status;
    if (!status) {
      status =
        key === "discord" ? "ok" :
        key === "crcon" || key === "frostbite" ? "Nicht verbunden" :
        key === "hllrecords" ? "API erforderlich" :
        "SteamID erforderlich";
    }
    const stateClass = status === "ok" ? "ok" : (status.startsWith("Fehler") || status.includes("403") ? "error" : "pending");

    return `<div class="source-card">
      <div class="source-title">
        <b>${esc(name)}</b>
        <span class="source-state ${stateClass}">${esc(status)}</span>
      </div>
      <div class="source-meta">Letztes Update: ${dateLabel(source.updatedAt)}</div>
      <div class="source-meta">Matches: ${Number(source.matches || 0).toLocaleString("de-DE")}</div>
      ${source.error ? `<div class="source-error">${esc(source.error)}</div>` : ""}
    </div>`;
  }).join("");
}

function renderPlayers() {
  const query = ($("#dev-search")?.value || "").trim().toLocaleLowerCase("de-DE");
  const players = Object.entries(unified.players || {})
    .map(([id, player]) => ({ id, ...player }))
    .filter(player =>
      !query ||
      String(player.username || player.id).toLocaleLowerCase("de-DE").includes(query)
    )
    .sort((a, b) =>
      String(a.username || a.id).localeCompare(String(b.username || b.id), "de-DE")
    );

  $("#dev-players").innerHTML = players.length
    ? `<table>
        <thead><tr><th>Spieler</th><th>SteamID64</th><th>Stats</th><th>Coverage</th><th>Update</th></tr></thead>
        <tbody>
          ${players.map(player => `
            <tr>
              <td><b>${esc(player.username || player.id)}</b></td>
              <td><input class="inline-steam" data-player-id="${esc(player.discordId || player.id)}" value="${esc(player.steamId || "")}" placeholder="SteamID64" inputmode="numeric"></td>
              <td>${Object.keys(player.stats || {}).length} Kategorien</td>
              <td>${esc(player.coverage || "Discord")}</td>
              <td class="muted">${dateLabel(player.updatedAt)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<div class="empty">Keine Unified-Stats vorhanden.</div>`;

  document.querySelectorAll(".inline-steam").forEach(input => {
    input.addEventListener("change", () => saveSteam(input));
  });
}

async function saveSteam(input) {
  const id = input.dataset.playerId;
  const steamId = input.value.trim();

  try {
    if (API_BASE) {
      await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ steamId })
      });
      setStatus("SteamID gespeichert");
      return load();
    }

    const { data, sha } = await loadRepositoryPlayers();
    data.players ||= {};
    const player = data.players[id];
    if (!player) throw new Error("Spieler nicht im Repository gefunden");
    player.steamId = steamId;
    player.updatedAt = new Date().toISOString();
    await saveRepositoryPlayers(data, sha, `Set SteamID for ${player.username || id}`);
    setStatus("SteamID im Repository gespeichert");
    await load();
  } catch (error) {
    setStatus(`SteamID konnte nicht gespeichert werden: ${error.message}`, false);
  }
}

function renderLogs() {
  const logs = Array.isArray(syncMeta.logs) ? syncMeta.logs : [];

  $("#sync-log").innerHTML = logs.length
    ? logs.slice(0, 30).map(log => `
      <div class="log-row">
        <span class="log-time">${dateLabel(log.time)}</span>
        <span class="log-level">${esc(log.level || "info")}</span>
        <span>${esc(log.message || "")}</span>
      </div>`).join("")
    : `<div class="empty">Noch keine Sync-Informationen.</div>`;
}

async function load() {
  // Repository data is the source of truth. Browser localStorage never
  // replaces synchronized repository data.
  unified = await getJson("unified-stats.json", { updatedAt: null, players: {} });
  syncMeta = await getJson("sync-meta.json", {
    sources: {}, matches: 0, duplicates: 0, logs: []
  });

  $("#last-sync").textContent = unified.updatedAt ? dateLabel(unified.updatedAt) : "—";
  $("#player-count").textContent = Object.keys(unified.players || {}).length.toLocaleString("de-DE");
  $("#match-count").textContent = Number(syncMeta.matches || 0).toLocaleString("de-DE");
  $("#duplicate-count").textContent = Number(syncMeta.duplicates || 0).toLocaleString("de-DE");

  renderSources();
  renderPlayers();
  renderLogs();
  await loadManagedPlayers();
}

function clearPlayerForm() {
  ["player-username", "player-steam", "player-epic", "player-discord"].forEach(id => {
    if ($("#" + id)) $("#" + id).value = "";
  });
  $("#player-save").dataset.editId = "";
  $("#player-save").textContent = "＋ Spieler hinzufügen";
}

async function loadManagedPlayers() {
  if (API_BASE) {
    try {
      const data = await apiJson(`${API_BASE}/api/admin/players`);
      renderManagedPlayers(
        Object.entries(data.players || {}).map(([id, player]) => ({ id, ...player }))
      );
      return;
    } catch (error) {
      setStatus("Backend nicht erreichbar – Repository-Daten werden angezeigt", false);
    }
  }

  const repository = await getJson("players.json", { version: 1, players: {} });
  const local = JSON.parse(localStorage.getItem("gwsm_managed_players") || "{}");
  const merged = { ...(repository.players || {}), ...local };

  renderManagedPlayers(
    Object.entries(merged).map(([id, player]) => ({ id, ...player }))
  );
}

function renderManagedPlayers(players) {
  $("#managed-players").innerHTML = players.length
    ? `<div class="admin-player-list">
        ${players.map(player => `
          <div class="admin-player-row">
            <div>
              <b>${esc(player.username || player.id)}</b>
              <div class="muted">
                Steam: ${esc(player.steamId || "—")} ·
                Epic: ${esc(player.epicId || "—")} ·
                Discord: ${esc(player.discordId || "—")}
              </div>
            </div>
            <div class="admin-row-actions">
              <button class="refresh mini-edit" data-id="${esc(player.id)}">Bearbeiten</button>
              <button class="danger mini-delete" data-id="${esc(player.id)}">Entfernen</button>
            </div>
          </div>`).join("")}
      </div>`
    : `<div class="empty">Noch keine Spieler verwaltet.</div>`;

  document.querySelectorAll(".mini-edit").forEach(button => {
    button.addEventListener("click", () => editManagedPlayer(button.dataset.id, players));
  });
  document.querySelectorAll(".mini-delete").forEach(button => {
    button.addEventListener("click", () => deleteManagedPlayer(button.dataset.id));
  });
}

async function saveManagedPlayer() {
  const payload = {
    username: $("#player-username").value.trim(),
    steamId: $("#player-steam").value.trim(),
    epicId: $("#player-epic").value.trim(),
    discordId: $("#player-discord").value.trim()
  };

  if (!payload.username) {
    setStatus("Spielername erforderlich", false);
    return;
  }

  const editId = $("#player-save").dataset.editId;

  if (API_BASE) {
    try {
      await apiJson(
        `${API_BASE}/api/admin/players${editId ? "/" + encodeURIComponent(editId) : ""}`,
        {
          method: editId ? "PUT" : "POST",
          body: JSON.stringify(payload)
        }
      );
      clearPlayerForm();
      await load();
      setStatus("Spieler gespeichert");
      return;
    } catch (error) {
      setStatus(`Backend-Fehler: ${error.message}`, false);
      return;
    }
  }

  try {
    const { data, sha } = await loadRepositoryPlayers();
    data.version = 1;
    data.players ||= {};
    const id = editId || payload.discordId || payload.steamId || payload.epicId || `player-${Date.now()}`;
    const existing = data.players[id] || {};
    data.players[id] = {
      id,
      ...existing,
      ...payload,
      aliases: Array.isArray(existing.aliases) ? existing.aliases : [],
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRepositoryPlayers(data, sha, `${editId ? "Update" : "Add"} GWSM player ${payload.username}`);
    clearPlayerForm();
    await load();
    setStatus("Spieler im Repository gespeichert");
  } catch (error) {
    setStatus(`Repository-Fehler: ${error.message}`, false);
  }
}

function editManagedPlayer(id, players) {
  const player = players.find(item => item.id === id);
  if (!player) return;

  $("#player-username").value = player.username || "";
  $("#player-steam").value = player.steamId || "";
  $("#player-epic").value = player.epicId || "";
  $("#player-discord").value = player.discordId || "";
  $("#player-save").dataset.editId = id;
  $("#player-save").textContent = "Speichern";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteManagedPlayer(id) {
  if (!confirm("Diesen GWSM-Spieler wirklich entfernen?")) return;

  if (API_BASE) {
    try {
      await apiJson(`${API_BASE}/api/admin/players/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      await load();
      setStatus("Spieler entfernt");
      return;
    } catch (error) {
      setStatus(`Backend-Fehler: ${error.message}`, false);
      return;
    }
  }

  try {
    const { data, sha } = await loadRepositoryPlayers();
    if (!data.players?.[id]) throw new Error("Spieler nicht im Repository gefunden");
    delete data.players[id];
    await saveRepositoryPlayers(data, sha, `Remove GWSM player ${id}`);
    await load();
    setStatus("Spieler aus dem Repository entfernt");
  } catch (error) {
    setStatus(`Repository-Fehler: ${error.message}`, false);
  }
}

async function triggerSync() {
  setStatus("Repository-Sync wird geprüft …");

  try {
    await load();

    const updated = unified.updatedAt ? new Date(unified.updatedAt) : null;
    const ageMinutes = updated
      ? Math.max(0, Math.round((Date.now() - updated.getTime()) / 60000))
      : null;

    if (ageMinutes !== null && ageMinutes <= 10) {
      setStatus(
        `Synchronisiert vor ${ageMinutes} Min. – ${Object.keys(unified.players || {}).length} Spieler`
      );
      return;
    }

    setStatus(
      "GitHub Actions führt den automatischen Sync spätestens im nächsten Lauf aus."
    );
    window.open(
      "https://github.com/skrane1/hll-stats/actions/workflows/gwsm-stats-sync.yml",
      "_blank",
      "noopener,noreferrer"
    );
  } catch (error) {
    setStatus(`Sync-Status konnte nicht geladen werden: ${error.message}`, false);
  }
}

$("#sync-all")?.addEventListener("click", triggerSync);
$("#sync-selected")?.addEventListener("click", triggerSync);
$("#player-save")?.addEventListener("click", saveManagedPlayer);
$("#player-steam")?.addEventListener("keydown", event => {
  if (event.key === "Enter") saveManagedPlayer();
});
$("#player-username")?.addEventListener("keydown", event => {
  if (event.key === "Enter") saveManagedPlayer();
});
$("#dev-search")?.addEventListener("input", renderPlayers);

if ($("#admin-key")) $("#admin-key").value = GITHUB_TOKEN || ADMIN_KEY;
if ($("#admin-key")) {
  $("#admin-key").placeholder = "Admin-Key / GitHub-Token";
  $("#admin-key").addEventListener("change", async () => {
    const value = $("#admin-key").value.trim();
    if (/^(ghp_|github_pat_)/.test(value)) {
      GITHUB_TOKEN = value;
      sessionStorage.setItem("gwsm_github_token", value);
      setStatus("GitHub-Zugriff wird geprüft …");
      try {
        await githubFile("players.json");
        setStatus("GitHub verbunden – Spielerverwaltung aktiv");
        await migrateLocalPlayers();
        await load();
      } catch (error) {
        setStatus(`GitHub-Token ungültig: ${error.message}`, false);
      }
    } else {
      ADMIN_KEY = value;
      sessionStorage.setItem("gwsm_admin_key", value);
    }
  });
}
setInterval(() => {
  if ($("#dev-clock")) $("#dev-clock").textContent = new Date().toLocaleTimeString("de-DE");
}, 1000);

load();
setInterval(load, 30000);
