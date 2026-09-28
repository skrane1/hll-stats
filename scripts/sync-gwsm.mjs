import fs from "node:fs/promises";

const readJson = async (path, fallback) => {
  try { return JSON.parse(await fs.readFile(path, "utf8")); }
  catch { return fallback; }
};

const now = new Date().toISOString();
const stats = await readJson("stats.json", {});
const registry = await readJson("players.json", { version: 1, players: {} });
const unified = await readJson("unified-stats.json", { updatedAt: null, players: {} });
const meta = await readJson("sync-meta.json", { sources: {}, matches: 0, duplicates: 0, logs: [] });

registry.version = 1;
registry.players ||= {};

for (const [discordId, raw] of Object.entries(stats)) {
  const existing = registry.players[discordId] || {};
  registry.players[discordId] = {
    id: discordId,
    username: existing.username || raw.username || discordId,
    steamId: existing.steamId || "",
    epicId: existing.epicId || "",
    discordId: existing.discordId || discordId,
    aliases: Array.isArray(existing.aliases) ? existing.aliases : [],
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

unified.updatedAt = now;
unified.players ||= {};

for (const [discordId, raw] of Object.entries(stats)) {
  const managed = registry.players[discordId];
  const source = raw.categories || raw.stats || {};
  const values = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number") values[key] = value;
    else if (value && typeof value.value === "number") values[key] = value.value;
  }

  const id = managed.steamId || managed.epicId || discordId;
  unified.players[id] = {
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

meta.updatedAt = now;
meta.sources ||= {};
meta.sources.discord = {
  status: "ok",
  updatedAt: now,
  matches: Object.keys(stats).length
};
meta.logs = [
  { time: now, level: "info", message: `Automatischer GWSM-Sync: ${Object.keys(unified.players).length} Spieler.` },
  ...(Array.isArray(meta.logs) ? meta.logs : [])
].slice(0, 50);

await fs.writeFile("players.json", JSON.stringify(registry, null, 2) + "\n");
await fs.writeFile("unified-stats.json", JSON.stringify(unified, null, 2) + "\n");
await fs.writeFile("sync-meta.json", JSON.stringify(meta, null, 2) + "\n");

console.log(`Synced ${Object.keys(unified.players).length} players.`);
