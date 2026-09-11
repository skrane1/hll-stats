import fetch from "node-fetch";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = "skrane1";
const GITHUB_REPO = "hll-stats";
const GITHUB_FILE = "history.json";
const GITHUB_BRANCH = "main";

let syncTimer = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeHistory(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out = {};
  for (const [category, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    out[category] = entries.filter(e => e && typeof e === "object");
  }
  return out;
}

function mergeHistory(local, remote) {
  const a = normalizeHistory(local);
  const b = normalizeHistory(remote);
  const merged = {};

  for (const category of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const entries = [...(b[category] || []), ...(a[category] || [])];
    const seen = new Set();

    merged[category] = entries.filter(entry => {
      const key = JSON.stringify([
        entry.date || "",
        String(entry.playerId || ""),
        entry.username || "",
        Number(entry.value ?? 0),
        entry.source || ""
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((x, y) => String(x.date || "").localeCompare(String(y.date || "")));
  }

  return merged;
}

async function getRemote() {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const response = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (response.status === 404) return { apiUrl, sha: null, history: {} };
  if (!response.ok) throw new Error(`GitHub GET ${response.status}: ${await response.text()}`);

  const file = await response.json();
  const decoded = Buffer.from(file.content || "", "base64").toString("utf8");

  let history = {};
  try {
    history = JSON.parse(decoded || "{}");
  } catch {
    throw new Error("GitHub history.json enthält ungültiges JSON.");
  }

  return { apiUrl, sha: file.sha, history: normalizeHistory(history) };
}

async function putRemote(apiUrl, sha, history, attempt = 1) {
  const body = {
    message: "Update HLL history",
    content: Buffer.from(JSON.stringify(history, null, 2), "utf8").toString("base64"),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (response.ok) return true;

  const text = await response.text();
  if (response.status === 409 && attempt < 5) {
    await sleep(1000 * attempt);
    return false;
  }

  throw new Error(`GitHub PUT ${response.status}: ${text}`);
}

async function uploadMerged(localHistory) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN ist nicht gesetzt.");

  for (let attempt = 1; attempt <= 5; attempt++) {
    const remote = await getRemote();
    const merged = mergeHistory(localHistory, remote.history);

    // Sicherheitsregel: niemals eine vorhandene Remote-Historie mit leerem Inhalt ersetzen.
    const localCount = Object.values(normalizeHistory(localHistory)).reduce((n, a) => n + a.length, 0);
    const remoteCount = Object.values(remote.history).reduce((n, a) => n + a.length, 0);
    const mergedCount = Object.values(merged).reduce((n, a) => n + a.length, 0);

    if (remoteCount > 0 && mergedCount < remoteCount) {
      throw new Error(`Sicherheitsabbruch: Remote-Historie würde schrumpfen (${remoteCount} -> ${mergedCount}).`);
    }

    const changed = JSON.stringify(merged) !== JSON.stringify(normalizeHistory(remote.history));
    if (!changed) {
      console.log(`ℹ️ history.json bereits aktuell (${mergedCount} Einträge).`);
      return merged;
    }

    const ok = await putRemote(remote.apiUrl, remote.sha, merged, attempt);
    if (ok) {
      console.log(`✅ history.json sicher synchronisiert (${mergedCount} Einträge).`);
      return merged;
    }
  }

  throw new Error("GitHub History Sync nach mehreren Versuchen fehlgeschlagen.");
}

export async function restoreHistoryFromGitHub() {
  if (!GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN ist nicht gesetzt.");
    return {};
  }

  const remote = await getRemote();
  return remote.history;
}

export function syncHistoryToGitHub(history) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await uploadMerged(history);
    } catch (error) {
      console.error("❌ GitHub History Sync Fehler:", error.message);
    }
  }, 3000);
}
