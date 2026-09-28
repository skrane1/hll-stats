# GWSM HLL Stats Backend

Das Backend verbindet die bestehende GitHub-Pages-Seite mit der Spielerverwaltung und dem Unified-Stats-Sync.

## Endpunkte

- GET /health
- GET /api/admin/players
- POST /api/admin/players
- PUT /api/admin/players/:id
- DELETE /api/admin/players/:id
- POST /api/admin/stats/sync
- POST /api/admin/stats/sync/player

Admin-Endpunkte benötigen den Header `x-gwsm-admin-key`.

## Start

```bash
cd backend
npm install
cp .env.example .env
# .env ausfüllen
npm start
```

Das Backend benötigt einen GitHub Fine-grained Token mit Schreibzugriff auf den Inhalt des Repositorys. Der Token bleibt ausschließlich auf dem Backend und wird niemals an den Browser ausgeliefert.

## Frontend

Die Dev-Seite erhält die Backend-Adresse über:

```js
window.GWSM_STATS_API = "https://DEIN-BACKEND";
```

Sie darf niemals den GitHub-Token enthalten.
