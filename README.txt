HLL HISTORY FIX

Ersetzt history-sync.js im Bot-Verzeichnis.

Wichtig:
- Der Sync liest vor jedem Upload die aktuelle GitHub history.json.
- Lokale und Remote-Historie werden zusammengeführt.
- Vorhandene Remote-Einträge können nicht durch eine leere lokale Datei gelöscht werden.
- Bei GitHub 409 wird erneut geladen und zusammengeführt.

Zusätzliche Absicherung in bot.js:
Nach dem Import von syncHistoryToGitHub bitte auch restoreHistoryFromGitHub importieren.
Beim Start des Bots muss die Remote-Historie vor dem normalen Betrieb geladen werden.

Beispiel:
import { syncHistoryToGitHub, restoreHistoryFromGitHub } from "./history-sync.js";

Vor const HISTORY = loadHistory();:
const HISTORY = loadHistory();

Im clientReady-Handler am Anfang:
try {
  const remoteHistory = await restoreHistoryFromGitHub();
  for (const [category, entries] of Object.entries(remoteHistory)) {
    if (!HISTORY[category]) HISTORY[category] = [];
    const keys = new Set(HISTORY[category].map(e => JSON.stringify(e)));
    for (const entry of entries) {
      const key = JSON.stringify(entry);
      if (!keys.has(key)) {
        HISTORY[category].push(entry);
        keys.add(key);
      }
    }
    HISTORY[category].sort((a,b) => String(a.date||"").localeCompare(String(b.date||"")));
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(HISTORY, null, 2));
  console.log("✅ GitHub-Historie beim Start wiederhergestellt.");
} catch (e) {
  console.error("⚠️ GitHub-Historie konnte beim Start nicht geladen werden:", e.message);
}
