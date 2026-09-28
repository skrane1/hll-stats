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

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const steamIdValid = value => /^7656119\d{10}$/.test(String(value || "").trim());
const escapeRegex = value => String(value).replace(/[.*+?^$()|[\]\\]/g, "\\$&");

const decodeHtml = value => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const htmlToText = html => decodeHtml(
  String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
).replace(/\s+/g, " ").trim();

const numberAfterLabel = (text, label) => {
  const re = new RegExp("\\b" + escapeRegex(label) + "\\b\\s*[:\\-]?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)", "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const percentAfterLabel = (text, label) => {
  const re = new RegExp("\\b" + escapeRegex(label) + "\\b\\s*[:\\-]?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%", "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const fetchText = async url => {
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; GWSM-HLL-Stats/2.0; +https://skrane1.github.io/)",
    "Accept": "text/html,application/xhtml+xml"
  };

  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    if (response.ok) return htmlToText(await response.text());
    if (![403, 429, 451, 500, 502, 503, 504].includes(response.status)) {
      throw new Error("HTTP " + response.status);
    }
  } catch (error) {
    if (error?.message?.startsWith("HTTP ") && !/HTTP (403|429|451|500|502|503|504)$/.test(error.message)) {
      throw error;
    }
  }

  const proxyUrl = "https://r.jina.ai/http://" + url.replace(/^https?:\/\//, "");
  const proxyResponse = await fetch(proxyUrl, {
    headers: { "User-Agent": "GWSM-HLL-Stats/2.0" },
    redirect: "follow"
  });
  if (!proxyResponse.ok) throw new Error("HTTP " + proxyResponse.status);
  return htmlToText(await proxyResponse.text());
};

const looseNumberAfterLabel = (text, label) => {
  const re = new RegExp(escapeRegex(label) + "[\\s\\S]{0,80}?([0-9][0-9,]*(?:\\.[0-9]+)?)", "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const loosePercentAfterLabel = (text, label) => {
  const re = new RegExp(escapeRegex(label) + "[\\s\\S]{0,80}?([0-9]+(?:\\.[0-9]+)?)\\s*%", "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const fetchHllRatings = async steamId => {
  const text = await fetchText("https://hellor.pro/player/" + steamId);
  if (/Player Not Found|Unable to load player data/i.test(text)) {
    throw new Error("Spieler nicht gefunden");
  }

  const overall = looseNumberAfterLabel(text, "Overall");
  const team = looseNumberAfterLabel(text, "Team");
  const impact = looseNumberAfterLabel(text, "Impact");
  const winRate = loosePercentAfterLabel(text, "Win Rate");
  const kdr = looseNumberAfterLabel(text, "K/D");
  const kpm = looseNumberAfterLabel(text, "Kills/Min");
  const scorePerMin = looseNumberAfterLabel(text, "Score/Min");
  const comp = looseNumberAfterLabel(text, "Comp Rating");
  const playtime = text.match(/Playtime\s+([0-9]+h(?:\s+[0-9]+m)?)/i)?.[1] || null;
  const kdTotals = text.match(/K\/D\s+[0-9.]+\s+([0-9,]+)\s*K\s*[·|]\s*([0-9,]+)\s*D/i);

  return {
    provider: "hll-ratings",
    url: "https://hellor.pro/player/" + steamId,
    fetchedAt: now,
    overall, team, impact, comp, winRate, kdr, kpm, scorePerMin, playtime,
    kills: kdTotals ? Number(kdTotals[1].replace(/,/g, "")) : null,
    deaths: kdTotals ? Number(kdTotals[2].replace(/,/g, "")) : null
  };
};

const fetchHllStatsDev = async steamId => {
  const text = await fetchText("https://www.hllstats.dev/?steam64id=" + steamId);

  // HLLStats.dev renders the empty/default form with the same "Totals"
  // section as a real profile. Do not mistake that placeholder page for
  // player data.
  if (
    /Steam profile must be set to public/i.test(text) ||
    /SteamID64\s*\*?\s+Enter your steamID64/i.test(text)
  ) {
    throw new Error("Steam-Profil nicht öffentlich oder noch nicht von HLLStats.dev erfasst");
  }

  const labels = [
    "Kills", "Vehicle Destroyed", "Tanks Destroyed", "Jeeps Destroyed",
    "Headshots", "Artillery", "Knife", "Spade", "Half-track MG",
    "Career XP", "Commander", "Officer", "Tank Commander", "Spotter",
    "Rifleman", "Assault", "Autorifleman", "Medic", "Support",
    "Machine Gunner", "Anti Tank", "Engineer", "Sniper", "Crewman",
    "Estimated Total Games", "Wins", "Estimated Loss", "Estimated WL Ratio",
    "Amount Of Maps Played", "Total Dropped", "Total Used", "Truck Drops",
    "Ammo", "Jeep Drops", "Flare Gun Scans", "Molotovs Thrown", "Captured Sectors"
  ];

  const values = {};
  for (const label of labels) {
    const value = numberAfterLabel(text, label);
    if (value !== null) values[label] = value;
  }

  // A real profile must contain at least one tracked career value above the
  // placeholder values used by the public page.
  const tracked = [
    "Kills", "Vehicle Destroyed", "Tanks Destroyed", "Jeeps Destroyed",
    "Headshots", "Career XP", "Estimated Total Games", "Wins",
    "Amount Of Maps Played", "Captured Sectors"
  ];
  const hasRealData = tracked.some(label => Number(values[label]) > 0);
  if (!hasRealData) {
    throw new Error("Keine erfassten HLLStats.dev-Spielerdaten");
  }

  return {
    provider: "hllstats.dev",
    url: "https://www.hllstats.dev/?steam64id=" + steamId,
    fetchedAt: now,
    stats: values
  };
};

const fetchHllRecords = async steamId => {
  const url = "https://hllrecords.com/profiles/" + steamId;
  const text = await fetchText(url);
  if (/player not found|profile not found|page not found/i.test(text)) throw new Error("Spieler nicht in HLL Records gefunden");

  const totalMatchBlock = text.match(/(?:Total on servers|Matches seen)[\s\S]{0,80}?([0-9,]+)\+?\s+matches\s*\/\s*([0-9,]+)\+?\s*hours/i);
  const playedMatchBlock = text.match(/Matches[\s\S]{0,100}?played[\s\S]{0,60}?([0-9,]+)\+?\s+matches/i);
  const totalMatches = totalMatchBlock?.[1]?.replace(/,/g, "");
  const hours = totalMatchBlock?.[2]?.replace(/,/g, "") || null;
  const playedMatches = playedMatchBlock?.[1]?.replace(/,/g, "");
  const winRate = loosePercentAfterLabel(text, "Win rate");
  const kills = looseNumberAfterLabel(text, "Enemy kills") ?? looseNumberAfterLabel(text, "Total kills");
  const deaths = looseNumberAfterLabel(text, "Total deaths");
  const kdr = looseNumberAfterLabel(text, "Overall K/D ratio");
  const kpm = text.match(/(?:Enemy|Total) kills[\s\S]{0,60}?\(([0-9.]+)\s*KPM\)/i)?.[1];
  const dpm = text.match(/Total deaths[\s\S]{0,60}?\(([0-9.]+)\s*DPM\)/i)?.[1];
  const teamKills = looseNumberAfterLabel(text, "Team kills");
  const level = looseNumberAfterLabel(text, "Level");

  if (kills === null && deaths === null && !totalMatches) throw new Error("Keine HLL Records Spielerdaten");

  return {
    provider: "hllrecords", url, fetchedAt: now,
    totalMatches: totalMatches ? Number(totalMatches) : null,
    playedMatches: playedMatches ? Number(playedMatches) : null,
    winRate, kills, deaths, kdr,
    kpm: kpm ? Number(kpm) : null,
    dpm: dpm ? Number(dpm) : null,
    teamKills, level, hours: hours ? Number(hours) : null
  };
};

const fetchFrostbite = async steamId => {
  const url = "https://frostbite.bifrostgaming.com/hll/player/" + steamId;
  const text = await fetchText(url);
  const matches = numberAfterLabel(text, "Matches");
  const hours = text.match(/([0-9]+(?:\.[0-9]+)?)\s*hours played/i)?.[1];
  const winRate = percentAfterLabel(text, "Win Rate");
  const wins = text.match(/([0-9,]+)\s+wins/i)?.[1];
  const kdMatch = text.match(/K\/D Ratio\s+([0-9.]+)\s+([0-9,]+)\s*K\s*\/\s*([0-9,]+)\s*D/i);
  const kills = kdMatch ? Number(kdMatch[2].replace(/,/g, "")) : numberAfterLabel(text, "Total Kills");
  const deaths = kdMatch ? Number(kdMatch[3].replace(/,/g, "")) : null;
  const kdr = kdMatch ? Number(kdMatch[1]) : numberAfterLabel(text, "K/D Ratio");
  const level = numberAfterLabel(text, "Level");
  const teamkills = numberAfterLabel(text, "Teamkills");

  if (kills === null && matches === null) throw new Error("Keine Frostbite Spielerdaten");

  return {
    provider: "frostbite", url, fetchedAt: now,
    level, matches, hours: hours ? Number(hours) : null,
    winRate, wins: wins ? Number(wins.replace(/,/g, "")) : null,
    kills, deaths, kdr, teamkills
  };
};

const refreshExternal = async (player, previousExternal) => {
  const steamId = String(player.steamId || "").trim();
  if (!steamIdValid(steamId)) return { external: previousExternal || {}, ok: false, skipped: true };

  const previousRefresh = previousExternal?._lastRefresh;
  const refreshAge = previousRefresh ? Date.now() - new Date(previousRefresh).getTime() : Infinity;
  const requiredSources = ["hll-ratings", "hllstats.dev", "hllrecords", "frostbite"];
  const missingSource = requiredSources.some(key => !previousExternal?.[key]?.fetchedAt);
  if (refreshAge < 30 * 60 * 1000 && !missingSource) {
    return { external: previousExternal, ok: true, skipped: true, success: 0 };
  }

  const external = { ...(previousExternal || {}) };
  let success = 0;

  for (const [key, loader] of [
    ["hll-ratings", fetchHllRatings],
    ["hllstats.dev", fetchHllStatsDev],
    ["hllrecords", fetchHllRecords],
    ["frostbite", fetchFrostbite]
  ]) {
    try {
      external[key] = await loader(steamId);
      success++;
    } catch (error) {
      // Do not keep an old successful snapshot marked as current after a
      // failed refresh. Keep the error for diagnostics, but remove the
      // fetchedAt marker so the Dev dashboard cannot report stale data as ok.
      external[key] = {
        provider: key,
        error: error instanceof Error ? error.message : String(error),
        failedAt: now
      };
    }
  }

  external._lastRefresh = now;
  return { external, ok: success > 0, skipped: false, success };
};

registry.version = 1;
registry.players ||= {};

/* Merge Discord stats into the central registry. */
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

  if (!sameJson(comparableExisting, comparableNext)) next.updatedAt = now;
  else if (existing.updatedAt) next.updatedAt = existing.updatedAt;

  registry.players[discordId] = next;
}

/* Build unified stats and refresh public Steam sources. */
const nextPlayers = {};
const externalResults = [];

for (const [discordId, raw] of Object.entries(stats)) {
  const managed = registry.players[discordId] || {};
  const values = {};

  for (const [key, value] of Object.entries(raw || {})) {
    if (["username", "discordId", "steamId", "epicId"].includes(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
  }

  const id = managed.steamId || managed.epicId || discordId;
  const previous = unified.players?.[id] || {};
  const externalResult = await refreshExternal(managed, previous.external || {});
  externalResults.push({ player: managed, ...externalResult });

  const ext = externalResult.external || {};
  const ratings = ext["hll-ratings"]?.fetchedAt ? ext["hll-ratings"] : null;
  const records = ext.hllrecords?.fetchedAt ? ext.hllrecords : null;
  const frostbite = ext.frostbite?.fetchedAt ? ext.frostbite : null;
  const hllStats = ext["hllstats.dev"]?.fetchedAt ? ext["hllstats.dev"] : null;

  // Generic stats are merged without overwriting the existing Discord
  // challenge values. Public sources fill the missing global HLL metrics.
  const generic = {
    kills: ratings?.kills ?? records?.kills ?? frostbite?.kills ?? hllStats?.stats?.Kills,
    deaths: ratings?.deaths ?? records?.deaths ?? frostbite?.deaths,
    kd: ratings?.kdr ?? records?.kdr ?? frostbite?.kdr,
    kpm: ratings?.kpm ?? records?.kpm,
    dpm: records?.dpm,
    scorePerMin: ratings?.scorePerMin,
    wins: records?.winRate != null && records?.totalMatches != null
      ? Math.round(records.totalMatches * records.winRate / 100)
      : null,
    matches: records?.totalMatches ?? frostbite?.matches ?? hllStats?.stats?.["Estimated Total Games"],
    playtimeHours: records?.hours ?? frostbite?.hours,
    winrate: ratings?.winRate ?? records?.winRate ?? frostbite?.winRate,
    teamKills: records?.teamKills ?? frostbite?.teamkills,
    headshots: hllStats?.stats?.Headshots,
    vehicleDestroyed: hllStats?.stats?.["Vehicle Destroyed"],
    tanksDestroyed: hllStats?.stats?.["Tanks Destroyed"],
    jeepsDestroyed: hllStats?.stats?.["Jeeps Destroyed"],
    capturedSectors: hllStats?.stats?.["Captured Sectors"],
    longestKillstreak: null,
    ratings: {
      overall: ratings?.overall ?? null,
      team: ratings?.team ?? null,
      impact: ratings?.impact ?? null,
      comp: ratings?.comp ?? null
    },
    sources: {
      "hll-ratings": Boolean(ratings),
      hllrecords: Boolean(records),
      frostbite: Boolean(frostbite),
      "hllstats.dev": Boolean(hllStats)
    }
  };

  for (const [key, value] of Object.entries(generic)) {
    if (value !== null && value !== undefined) values[key] = value;
  }

  nextPlayers[id] = {
    id,
    username: managed.username || raw.username || discordId,
    steamId: managed.steamId || "",
    epicId: managed.epicId || "",
    discordId,
    stats: values,
    external: externalResult.external,
    coverage: managed.steamId
      ? "Discord + Steam + externe Stats"
      : managed.epicId
        ? "Discord + EpicID"
        : "Discord",
    updatedAt: previous.updatedAt || now
  };

  const oldComparable = { ...previous };
  delete oldComparable.updatedAt;
  const newComparable = { ...nextPlayers[id] };
  delete newComparable.updatedAt;

  if (!sameJson(oldComparable, newComparable)) nextPlayers[id].updatedAt = now;
}

const oldComparablePlayers = Object.fromEntries(
  Object.entries(unified.players || {}).map(([id, p]) => {
    const copy = { ...p };
    delete copy.updatedAt;
    return [id, copy];
  })
);
const newComparablePlayers = Object.fromEntries(
  Object.entries(nextPlayers).map(([id, p]) => {
    const copy = { ...p };
    delete copy.updatedAt;
    return [id, copy];
  })
);
const playersChanged = !sameJson(oldComparablePlayers, newComparablePlayers);

if (playersChanged || !unified.updatedAt) unified.updatedAt = now;
unified.players = nextPlayers;

/* Source status for the Dev dashboard. */
const steamPlayers = Object.values(registry.players).filter(p => steamIdValid(p.steamId));
console.log("SteamID64-Spieler:", steamPlayers.map(p => `${p.username}=${p.steamId}`).join(", ") || "keine");
const successfulRatings = externalResults.filter(x => x.external?.["hll-ratings"]?.fetchedAt).length;
const successfulHllStats = externalResults.filter(x => x.external?.["hllstats.dev"]?.fetchedAt).length;
const previousMetaSources = meta.sources || {};
const currentDiscordMatches = Object.keys(stats).length;
const source = (key, fallback) => previousMetaSources[key] || fallback;

const storedRatings = Object.values(unified.players || {}).filter(
  player => player?.external?.["hll-ratings"]?.fetchedAt
);
const storedHllStats = Object.values(unified.players || {}).filter(
  player => player?.external?.["hllstats.dev"]?.fetchedAt
);

const latestFetchedAt = list => {
  const times = list
    .map(player => player?.external?.["hll-ratings"]?.fetchedAt || player?.external?.["hllstats.dev"]?.fetchedAt)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
};

const sourceStats = key => {
  const list = Object.values(unified.players || {}).filter(
    player => player?.external?.[key]?.fetchedAt
  );
  const timestamps = list
    .map(player => player.external[key].fetchedAt)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  return {
    matches: list.length,
    updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null
  };
};

const hllStatsSource = sourceStats("hllstats.dev");
const ratingsSource = sourceStats("hll-ratings");
const recordsSource = sourceStats("hllrecords");
const frostbiteSource = sourceStats("frostbite");

const externalSources = {
  "hllstats.dev": {
    status: hllStatsSource.matches ? "ok" : (steamPlayers.length ? "Steam-Profil öffentlich erforderlich" : "SteamID erforderlich"),
    updatedAt: hllStatsSource.updatedAt,
    matches: hllStatsSource.matches
  },
  "hll-ratings": {
    status: ratingsSource.matches && Object.values(unified.players || {}).some(p =>
      Number.isFinite(p?.external?.["hll-ratings"]?.overall)
    ) ? "ok" : "Zugriffsschutz",
    updatedAt: ratingsSource.updatedAt,
    matches: ratingsSource.matches
  },
  "hllrecords": {
    status: recordsSource.matches ? "ok" : (steamPlayers.length ? "Wird gesucht" : "SteamID erforderlich"),
    updatedAt: recordsSource.updatedAt,
    matches: recordsSource.matches
  },
  "crcon": {
    status: recordsSource.matches ? "indirekt über HLL Records" : "Über HLL Records verfügbar",
    updatedAt: recordsSource.updatedAt,
    matches: recordsSource.matches
  },
  "frostbite": {
    status: frostbiteSource.matches ? "ok" : "Spieler noch nicht erfasst",
    updatedAt: frostbiteSource.updatedAt,
    matches: frostbiteSource.matches
  }
};

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
  },
  ...externalSources
};

const sourcesChanged = !sameJson(previousMetaSources, stableSources);

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
    message:
      "Automatischer GWSM-Sync: " +
      Object.keys(nextPlayers).length +
      " Spieler, " +
      steamPlayers.length +
      " mit SteamID64, " +
      (successfulRatings + successfulHllStats) +
      " externe Spielerabfragen erfolgreich."
  };
  nextMeta.logs = [runLog, ...(Array.isArray(meta.logs) ? meta.logs : [])].slice(0, 50);
}

await fs.writeFile("players.json", JSON.stringify(registry, null, 2) + "\n");
await fs.writeFile("unified-stats.json", JSON.stringify(unified, null, 2) + "\n");
await fs.writeFile("sync-meta.json", JSON.stringify(nextMeta, null, 2) + "\n");

console.log(
  "Synced " + Object.keys(nextPlayers).length +
  " players; " + steamPlayers.length +
  " Steam players; " + successfulRatings +
  " HLL Ratings; " + successfulHllStats + " HLLStats.dev."
);
