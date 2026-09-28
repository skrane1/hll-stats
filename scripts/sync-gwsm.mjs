import fs from "node:fs/promises";

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const now = new Date().toISOString();
const stats = await readJson("stats.json", {});
const registry = await readJson("players.json", { version: 1, players: {} });
const unified = await readJson("unified-stats.json", { updatedAt: null, players: {} });
const meta = await readJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });

registry.version = 1;
registry.players ||= {};

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const steamIdValid = value => /^7656119\d{10}$/.test(String(value || "").trim());

/*
 * 1. Merge Discord stats into the central player registry.
 * Existing SteamID/EpicID/aliases are preserved.
 * Timestamps only change when a player's actual registry data changed.
 */
for (const [discordId, raw] of Object.entries(stats)) {
  const existing = registry.players[discordId] || {};
  const next = {
    id: discordId,
    username: existing.username || raw.username || discordId,
    steamId: existing.steamId || "",
    epicId: existing.epicId || "",
    discordId: existing.discordId || discordId,
    aliases: Array.isArray(existing.aliases) ? existing.aliases : [],
    createdAt: existing.createdAt || now,
    updatedAt: existing.updatedAt || now
  };

  const comparableExisting = { ...existing };
  delete comparableExisting.updatedAt;
  const comparableNext = { ...next };
  delete comparableNext.updatedAt;

  if (!sameJson(comparableExisting, comparableNext)) {
    next.updatedAt = now;
  } else if (existing.updatedAt) {
    next.updatedAt = existing.updatedAt;
  }

  registry.players[discordId] = next;
}

/*
 * 2. Build the unified player dataset.
 * The Discord dataset remains the authoritative source for the GWSM
 * challenge categories. External career/rating data is added only when
 * a valid SteamID64 exists.
 */
const nextPlayers = {};

for (const [discordId, raw] of Object.entries(stats)) {
  const managed = registry.players[discordId] || {};
  const values = {};

  for (const [key, value] of Object.entries(raw || {})) {
    if (["username", "discordId", "steamId", "epicId"].includes(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      values[key] = value;
    }
  }

  const id = managed.steamId || managed.epicId || discordId;
  const previous = unified.players?.[id] || {};

  nextPlayers[id] = {
    id,
    username: managed.username || raw.username || discordId,
    steamId: managed.steamId || "",
    epicId: managed.epicId || "",
    discordId,
    stats: values,
    external: previous.external || {},
    coverage: managed.steamId || managed.epicId ? "Discord + externe ID" : "Discord",
    updatedAt: previous.updatedAt || now
  };

  const oldComparable = { ...previous };
  delete oldComparable.updatedAt;
  const newComparable = { ...nextPlayers[id] };
  delete newComparable.updatedAt;

  if (!sameJson(oldComparable, newComparable)) {
    nextPlayers[id].updatedAt = now;
  }
}

const oldPlayers = unified.players || {};
const playersChanged = !sameJson(
  Object.fromEntries(Object.entries(oldPlayers).map(([id, p]) => [id, { ...p, updatedAt: undefined }])),
  Object.fromEntries(Object.entries(nextPlayers).map(([id, p]) => [id, { ...p, updatedAt: undefined }]))
);

if (playersChanged || !unified.updatedAt) {
  unified.updatedAt = now;
}
unified.players = nextPlayers;

/*
 * 3. Provider readiness.
 * These public providers can only be queried reliably once a SteamID64
 * has been assigned to the GWSM player. CRCON/Frostbite need a server
 * endpoint and credentials and therefore remain explicitly disconnected.
 */
const steamPlayers = Object.values(registry.players).filter(p => steamIdValid(p.steamId));

const externalSources = {
  "hllstats.dev": {
    status: steamPlayers.length ? "bereit" : "SteamID erforderlich",
    updatedAt: steamPlayers.length ? now : null,
    matches: 0
  },
  "hll-ratings": {
    status: steamPlayers.length ? "bereit" : "SteamID erforderlich",
    updatedAt: steamPlayers.length ? now : null,
    matches: 0
  },
  "hllrecords": {
    status: steamPlayers.length ? "bereit" : "SteamID erforderlich",
    updatedAt: steamPlayers.length ? now : null,
    matches: 0
  },
  "crcon": {
    status: "Nicht verbunden",
    updatedAt: null,
    matches: 0
  },
  "frostbite": {
    status: "Nicht verbunden",
    updatedAt: null,
    matches: 0
  }
};

const previousMetaSources = meta.sources || {};
const currentDiscordMatches = Object.keys(stats).length;
const previousDiscord = previousMetaSources.discord || {};
const discordChanged =
  previousDiscord.status !== "ok" ||
  Number(previousDiscord.matches || 0) !== currentDiscordMatches;

const stableSources = {
  ...previousMetaSources,
  discord: {
    status: "ok",
    updatedAt: discordChanged ? now : (previousDiscord.updatedAt || now),
    matches: currentDiscordMatches
  }
};

for (const [key, source] of Object.entries(externalSources)) {
  const previous = previousMetaSources[key] || {};
  const changed =
    previous.status !== source.status ||
    Number(previous.matches || 0) !== Number(source.matches || 0);

  stableSources[key] = {
    ...source,
    updatedAt: changed ? now : (previous.updatedAt || source.updatedAt || null)
  };
}

const sourcesChanged = !sameJson(
  previousMetaSources,
  stableSources
);

const nextMeta = {
  ...meta,
  sources: stableSources,
  matches: Number(meta.matches || 0),
  duplicates: Number(meta.duplicates || 0)
};

if (playersChanged || sourcesChanged || !Array.isArray(meta.logs) || meta.logs.length === 0) {
  const runLog = {
    time: now,
    level: "info",
    message: `Automatischer GWSM-Sync: ${Object.keys(nextPlayers).length} Spieler, ${steamPlayers.length} mit SteamID64.`
  };
  nextMeta.logs = [runLog, ...(Array.isArray(meta.logs) ? meta.logs : [])].slice(0, 50);
}

/*
 * The sync state is written on every run. The workflow only commits when
 * one of the files actually changes, so a healthy 5-minute schedule does
 * not create endless Git history entries when no data changed.
 */
await fs.writeFile("players.json", JSON.stringify(registry, null, 2) + "\n");
await fs.writeFile("unified-stats.json", JSON.stringify(unified, null, 2) + "\n");
await fs.writeFile("sync-meta.json", JSON.stringify(nextMeta, null, 2) + "\n");

console.log(
  `Synced ${Object.keys(nextPlayers).length} players; ${steamPlayers.length} have a valid SteamID64.`
);
