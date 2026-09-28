import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors({ origin: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "x-gwsm-admin-key"] }));
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8787);
const ADMIN_KEY = process.env.GWSM_ADMIN_KEY || "";
const OWNER = process.env.GITHUB_OWNER || "skrane1";
const REPO = process.env.GITHUB_REPO || "hll-stats";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN || "";

function auth(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: "GWSM_ADMIN_KEY is not configured." });
  if (req.get("x-gwsm-admin-key") !== ADMIN_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
}

async function githubFile(path) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not configured.");
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { path, sha: null, value: null };
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status} ${await r.text()}`);
  const file = await r.json();
  const value = JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8"));
  return { path, sha: file.sha, value };
}

async function putGithubFile(path, value, sha, message) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8").toString("base64"),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

function normalizePlayer(id, p = {}) {
  return {
    id: String(id),
    username: p.username || p.name || String(id),
    steamId: p.steamId || p.steamID || p.steamid || "",
    epicId: p.epicId || "",
    discordId: p.discordId || "",
    aliases: Array.isArray(p.aliases) ? p.aliases : [],
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function mergePlayers(registry, stats) {
  const out = { ...(registry?.players || {}) };
  for (const [discordId, p] of Object.entries(stats || {})) {
    if (!out[discordId]) {
      out[discordId] = normalizePlayer(discordId, {
        username: p.username || discordId,
        discordId
      });
    } else {
      out[discordId] = normalizePlayer(discordId, {
        ...out[discordId],
        username: out[discordId].username || p.username,
        discordId: out[discordId].discordId || discordId
      });
    }
  }
  return out;
}

function buildUnified(stats, registry) {
  const players = {};
  for (const [discordId, raw] of Object.entries(stats || {})) {
    const managed = registry.players?.[discordId] || registry.players?.[raw.discordId] || {};
    const values = {};
    for (const [key, value] of Object.entries(raw || {})) {
      if (["username","discordId","steamId","epicId"].includes(key)) continue;
      if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
    }\n    const totalKills = Object.entries(values)
      .filter(([k]) => /kill|absch|t[oö]t|counter|thanatos|mage|op|garry|alchemist|kettenblitz|sniperwizard/i.test(k))
      .reduce((n, [, v]) => n + Number(v || 0), 0);
    players[managed.steamId || managed.epicId || discordId] = {
      id: managed.steamId || managed.epicId || discordId,
      username: managed.username || raw.username || discordId,
      steamId: managed.steamId || "",
      epicId: managed.epicId || "",
      discordId: managed.discordId || discordId,
      stats: values,
      coverage: managed.steamId || managed.epicId ? "Discord + externe ID" : "Discord",
      updatedAt: new Date().toISOString(),
      legacy: { discordId, totalCategoryValue: totalKills }
    };
  }
  return { updatedAt: new Date().toISOString(), players };
}

async function syncAll() {
  const [stats, registry] = await Promise.all([
    githubFile("stats.json"),
    githubFile("players.json")
  ]);

  const players = mergePlayers(registry.value || { players: {} }, stats.value || {});
  const unified = buildUnified(stats.value || {}, { players });

  await putGithubFile("players.json", { version: 1, players }, registry.sha, "Sync GWSM player registry");
  const unifiedRemote = await githubFile("unified-stats.json");
  await putGithubFile("unified-stats.json", unified, unifiedRemote.sha, "Sync unified HLL stats");

  const metaRemote = await githubFile("sync-meta.json");
  const oldMeta = metaRemote.value || {};
  const meta = {
    ...oldMeta,
    updatedAt: unified.updatedAt,
    matches: Number(oldMeta.matches || 0),
    duplicates: Number(oldMeta.duplicates || 0),
    sources: {
      ...(oldMeta.sources || {}),
      discord: {
        status: "ok",
        updatedAt: unified.updatedAt,
        matches: Object.keys(stats.value || {}).length
      }
    },
    logs: [
      { time: unified.updatedAt, level: "info", message: `Discord/GWSM stats synchronisiert: ${Object.keys(unified.players).length} Spieler.` },
      ...(Array.isArray(oldMeta.logs) ? oldMeta.logs : [])
    ].slice(0, 50)
  };
  await putGithubFile("sync-meta.json", meta, metaRemote.sha, "Update HLL sync metadata");

  return { updatedAt: unified.updatedAt, players: Object.keys(unified.players).length };
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "gwsm-hll-stats-backend" }));

app.get("/api/admin/players", auth, async (_req, res) => {
  try {
    const file = await githubFile("players.json");
    res.json(file.value || { version: 1, players: {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/players", auth, async (req, res) => {
  try {
    const file = await githubFile("players.json");
    const registry = file.value || { version: 1, players: {} };
    const p = req.body || {};
    if (!p.username) return res.status(400).json({ error: "username is required" });
    const id = p.discordId || p.steamId || p.epicId || `player-${Date.now()}`;
    if (registry.players[id]) return res.status(409).json({ error: "Player already exists" });
    registry.players[id] = normalizePlayer(id, p);
    await putGithubFile("players.json", registry, file.sha, `Add GWSM player ${registry.players[id].username}`);
    res.json(registry.players[id]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/admin/players/:id", auth, async (req, res) => {
  try {
    const file = await githubFile("players.json");
    const registry = file.value || { version: 1, players: {} };
    if (!registry.players?.[req.params.id]) return res.status(404).json({ error: "Player not found" });
    registry.players[req.params.id] = normalizePlayer(req.params.id, {
      ...registry.players[req.params.id],
      ...(req.body || {})
    });
    await putGithubFile("players.json", registry, file.sha, `Update GWSM player ${registry.players[req.params.id].username}`);
    res.json(registry.players[req.params.id]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/players/:id", auth, async (req, res) => {
  try {
    const file = await githubFile("players.json");
    const registry = file.value || { version: 1, players: {} };
    if (!registry.players?.[req.params.id]) return res.status(404).json({ error: "Player not found" });
    delete registry.players[req.params.id];
    await putGithubFile("players.json", registry, file.sha, `Remove GWSM player ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/stats/sync", auth, async (_req, res) => {
  try {
    res.json({ ok: true, ...(await syncAll()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/stats/sync/player", auth, async (req, res) => {
  try {
    const result = await syncAll();
    res.json({ ok: true, ...result, requested: req.body || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

if (process.env.VERCEL !== "1") app.listen(PORT, () => console.log(`GWSM Stats Backend listening on :${PORT}`));

export default app;
