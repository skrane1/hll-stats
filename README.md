# GWSM HLL Stats

GitHub-Pages frontend for the GWSM HLL statistics website.

## Dateien
- `index.html` – öffentliche Website
- `app.js` / `style.css` – Frontend
- `stats.json` – aktuelle GWSM-Challengewerte
- `history.json` – Challenge-Historie
- `unified-stats.json` – vom späteren Stats-Backend erzeugte Unified-HLL-Stats
- `dev.html` / `dev.js` – geschütztes Dev-Dashboard-Frontend
- `sync-meta.json` – Sync-/Quellen-Metadaten des Backends

## Unified HLL Stats
Die öffentliche Seite zeigt Unified-Stats nur aus `unified-stats.json`. Externe HLL-Quellen werden **nicht direkt aus dem Browser** abgefragt.

Das Backend soll alle 60 Minuten synchronisieren, Matches deduplizieren und danach `unified-stats.json` sowie `sync-meta.json` aktualisieren.

## Manueller Sync
Das Dev-Dashboard besitzt einen manuellen Sync-Button. Vor dem produktiven Einsatz muss `GWSM_STATS_API` auf die URL des Backend-Services zeigen. Das Backend sollte mindestens bereitstellen:

- `POST /api/admin/stats/sync` – alle GWSM-Spieler synchronisieren
- `POST /api/admin/stats/sync/player` – einen Spieler synchronisieren (`{ "steamId": "..." }`)

Die Dev-Seite darf niemals API-Keys der Datenquellen an den Browser ausliefern.


## Automatischer Betrieb

Der Workflow `.github/workflows/gwsm-stats-sync.yml` synchronisiert die vorhandenen GWSM-Daten stündlich und kann über GitHub Actions manuell gestartet werden.

Der Sync:
- übernimmt neue Discord-Spieler automatisch in `players.json`
- erhält manuell hinterlegte Steam-/Epic-IDs
- aktualisiert `unified-stats.json`
- schreibt den letzten Lauf nach `sync-meta.json`
- benötigt keinen laufenden PC und keine Änderung am HLL-Server

## Backend

Das optionale Backend unter `backend/` stellt die geschützte Spielerverwaltung und manuellen Sync-Endpunkte bereit. Der GitHub-Token bleibt ausschließlich serverseitig.

Externe HLL-Statistikquellen werden bewusst über Adapter angebunden; es werden keine erfundenen oder nicht dokumentierten Endpunkte verwendet.
