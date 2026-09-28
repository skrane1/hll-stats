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

const fetchBrowserText = async (url, steamId) => {
  const { spawn } = await import("node:child_process");

  const candidates = [
    process.env.CHROMEDRIVER || "chromedriver",
    "/usr/bin/chromedriver",
    "/usr/local/bin/chromedriver"
  ];

  let driver = null;
  for (const executable of candidates) {
    try {
      driver = spawn(executable, ["--port=9515"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 5000);
        driver.once("error", error => {
          clearTimeout(timer);
          reject(error);
        });
        driver.once("spawn", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (driver.exitCode === null) break;
      driver = null;
    } catch {
      driver = null;
    }
  }

  if (!driver) throw new Error("Kein ChromeDriver verfügbar");

  const request = async (path, options = {}) => {
    const response = await fetch("http://127.0.0.1:9515" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) throw new Error("ChromeDriver HTTP " + response.status + ": " + body.slice(0, 300));
    const json = JSON.parse(body);
    if (json.value?.error) {
      throw new Error("ChromeDriver " + json.value.error + ": " + (json.value.message || ""));
    }
    return json.value;
  };

  let sessionId = null;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const statusResponse = await fetch("http://127.0.0.1:9515/status");
        if (statusResponse.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("ChromeDriver startet nicht auf Port 9515");

    const session = await request("/session", {
      method: "POST",
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            browserName: "chrome",
            "goog:chromeOptions": {
              args: [
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1440,2000"
              ]
            }
          }
        }
      })
    });

    sessionId = session.sessionId;
    await request("/session/" + sessionId + "/url", {
      method: "POST",
      body: JSON.stringify({ url })
    });

    // HLLStats.dev uses the SteamID field + Submit flow to trigger the
    // lookup. A plain navigation can leave the page on its empty template.
    await new Promise(resolve => setTimeout(resolve, 1000));
    await request("/session/" + sessionId + "/execute/sync", {
      method: "POST",
      body: JSON.stringify({
        script: `
          const input = document.querySelector('input');
          const submit = [...document.querySelectorAll('button, input[type="submit"]')]
            .find(el => String(el.innerText || el.value || '').trim().toLowerCase() === 'submit');
          if (!input || !submit) return false;
          input.value = ${JSON.stringify(steamId)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          submit.click();
          return true;
        `,
        args: []
      })
    });

    // Give the Steam lookup and page rendering time to complete.
    await new Promise(resolve => setTimeout(resolve, 5000));

    const text = await request("/session/" + sessionId + "/execute/sync", {
      method: "POST",
      body: JSON.stringify({
        script: "return document.body ? document.body.innerText : '';",
        args: []
      })
    });

    return String(text || "");
  } finally {
    if (sessionId) {
      try {
        await request("/session/" + sessionId, { method: "DELETE" });
      } catch {}
    }
    try {
      driver.kill("SIGTERM");
    } catch {}
  }
};

const fetchHllRatings = async steamId => {
  const text = await fetchText("https://hellor.pro/player/" + steamId);

  // GitHub Actions currently receives Cloudflare's challenge page instead
  // of the actual player profile. Never store that response as a valid
  // ratings snapshot.
  if (/Just a moment\.\.\.|challenge|CAPTCHA|requires CAPTCHA|Warning: This page maybe requiring CAPTCHA/i.test(text)) {
    throw new Error("Zugriffsschutz");
  }

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
  const url = "https://www.hllstats.dev/?steam64id=" + steamId;
  let text = await fetchText(url);

  // HLLStats.dev renders the empty/default form with the same "Totals"
  // section as a real profile. Do not mistake that placeholder page for
  // player data.
  // This sentence is part of the normal HLLStats.dev page and is also
  // displayed for valid public profiles. It is therefore NOT a privacy/error
  // signal. We determine availability from the actual tracked values below.
  // The input placeholder is present in the HTML even when a real SteamID
  // has been submitted, so it cannot be used to decide whether a player
  // exists. We determine that from the actual tracked values below.

  const labels = [
    "Kills", "Vehicle Destroyed", "Tanks Destroyed", "Jeeps Destroyed",
    "Headshots", "Artillery", "Knife", "Spade", "Half-track MG",
    "Career XP", "Commander", "Officer", "Tank Commander", "Spotter",
    "Rifleman", "Assault", "Autorifleman", "Medic", "Support",
    "Machine Gunner", "Anti Tank", "Engineer", "Sniper", "Crewman",
    "Estimated Total Games", "Wins", "Estimated Loss", "Estimated WL Ratio",
    "Estimated W/L Ratio",
    "Amount Of Maps Played", "Total Dropped", "Total Used", "Truck Drops",
    "Ammo", "Jeep Drops", "Flare Gun Scans", "Molotovs Thrown", "Captured Sectors"
  ];

  const values = {};
  for (const label of labels) {
    const value = numberAfterLabel(text, label);
    if (value !== null) values[label] = value;
  }

  // HLLStats.dev renders the same HTML form for every request, including the
  // "Enter your steamID64" placeholder. The only reliable distinction is
  // whether actual tracked values are non-zero.
  if (values["Estimated W/L Ratio"] !== undefined && values["Estimated WL Ratio"] === undefined) {
    values["Estimated WL Ratio"] = values["Estimated W/L Ratio"];
  }

  const tracked = [
    "Kills", "Vehicle Destroyed", "Tanks Destroyed", "Jeeps Destroyed",
    "Headshots", "Artillery", "Knife", "Spade", "Half-track MG",
    "Flamethrower", "Jeep Impact", "Estimated Total Games", "Wins",
    "Estimated Loss", "Amount Of Maps Played", "Total Dropped", "Total Used",
    "Truck Drops", "Jeep Drops", "Molotovs Thrown", "Captured Sectors"
  ];
  let hasRealData = tracked.some(label => Number(values[label]) > 0);

  // The server-rendered HTML is only the empty template. If no real values
  // are present, use the Chrome/ChromeDriver-rendered page so its client-side
  // Steam lookup can complete exactly like it does in a normal browser.
  if (!hasRealData) {
    try {
      const renderedText = await fetchBrowserText(url, steamId);
      const renderedValues = {};
      for (const label of labels) {
        const value = numberAfterLabel(renderedText, label);
        if (value !== null) renderedValues[label] = value;
      }
      if (renderedValues["Estimated W/L Ratio"] !== undefined && renderedValues["Estimated WL Ratio"] === undefined) {
        renderedValues["Estimated WL Ratio"] = renderedValues["Estimated W/L Ratio"];
      }
      text = renderedText;
      for (const [label, value] of Object.entries(renderedValues)) {
        values[label] = value;
      }
      hasRealData = tracked.some(label => Number(values[label]) > 0);
    } catch (error) {
      throw new Error("HLLStats.dev Browser-Abfrage fehlgeschlagen: " + (error instanceof Error ? error.message : String(error)));
    }
  }

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

const SOURCE_REFRESH_MS = {
  // HLL Ratings is currently protected by Cloudflare from GitHub Actions.
  // Retry it independently so it never blocks the other providers.
  "hll-ratings": 30 * 60 * 1000,
  // If these sources do not know the player yet, retry them on every
  // scheduled workflow run (currently every 5 minutes).
  "hllstats.dev": 0,
  frostbite: 0,
  // HLL Records already works reliably; refresh it every 30 minutes.
  hllrecords: 30 * 60 * 1000
};

const refreshExternal = async (player, previousExternal) => {
  const steamId = String(player.steamId || "").trim();
  if (!steamIdValid(steamId)) return { external: previousExternal || {}, ok: false, skipped: true, success: 0 };

  const external = { ...(previousExternal || {}) };
  let success = 0;
  let attempted = 0;

  for (const [key, loader] of [
    ["hll-ratings", fetchHllRatings],
    ["hllstats.dev", fetchHllStatsDev],
    ["hllrecords", fetchHllRecords],
    ["frostbite", fetchFrostbite]
  ]) {
    const previous = external[key] || {};
    const lastAttempt = previous.fetchedAt || previous.failedAt;
    const age = lastAttempt ? Date.now() - new Date(lastAttempt).getTime() : Infinity;
    const interval = SOURCE_REFRESH_MS[key] ?? 0;

    // Missing/failed HLLStats.dev and Frostbite sources are retried on the
    // next workflow run. Successful data is still protected from excessive
    // requests by the normal 30-minute refresh interval.
    if (age < interval) {
      if (previous.fetchedAt) success++;
      continue;
    }

    attempted++;
    try {
      external[key] = await loader(steamId);
      success++;
    } catch (error) {
      // A provider failure is isolated to that provider. It must never
      // prevent another source from being queried or overwrite valid data
      // from another provider.
      external[key] = {
        provider: key,
        error: error instanceof Error ? error.message : String(error),
        failedAt: now
      };
    }
  }

  external._lastRefresh = now;
  return {
    external,
    ok: success > 0,
    skipped: attempted === 0,
    success,
    attempted
  };
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
  const ratings = ext["hll-ratings"]?.fetchedAt &&
    [ext["hll-ratings"]?.overall, ext["hll-ratings"]?.team, ext["hll-ratings"]?.impact,
      ext["hll-ratings"]?.kdr, ext["hll-ratings"]?.kpm, ext["hll-ratings"]?.scorePerMin]
      .some(value => Number.isFinite(value))
    ? ext["hll-ratings"] : null;
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

const providerError = key => {
  const errors = Object.values(unified.players || {})
    .map(player => player?.external?.[key]?.error)
    .filter(Boolean);
  return errors[0] || null;
};

const externalSources = {
  "hllstats.dev": {
    status: hllStatsSource.matches
      ? "ok"
      : (providerError("hllstats.dev") || (steamPlayers.length ? "Wird gesucht" : "SteamID erforderlich")),
    updatedAt: hllStatsSource.updatedAt,
    matches: hllStatsSource.matches
  },
  "hll-ratings": {
    status: ratingsSource.matches
      ? "ok"
      : (providerError("hll-ratings") || "Zugriffsschutz"),
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
    status: frostbiteSource.matches
      ? "ok"
      : (providerError("frostbite") || "Spieler noch nicht erfasst"),
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
