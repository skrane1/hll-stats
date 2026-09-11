const CATEGORY_META = [
  ["commander-counter","COMMANDER CREMATOR","Kommandantenabschüsse"],
  ["you-shall-not-pass","YOU SHALL NOT PASS","Zerstörte Fahrzeuge"],
  ["meele-mage","MEELE-MAGE","Nahkampftötungen"],
  ["garry-grounder","GARRY GROUNDER","Zerstörte Garnisonen"],
  ["alchemist","ALCHEMIST","Gebaute Knotenpunkte"],
  ["kettenblitz","KETTENBLITZ","Tötungen aus Fahrzeug"],
  ["sniperwizard","SNIPERWIZARD","Längster Kopfschuss"],
  ["Oppenheimer","OPPENHEIMER","Sprengstofftötungen"],
  ["thanatos","THANATOS","Infanterieabschüsse"],
  ["WO OP?","WO OP?","Zerstörte Außenposten"]
];

let stats = {};
let history = {};
let hall = [];
let challenges = [];

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function meta(key) {
  return CATEGORY_META.find(x => x[0] === key) || [key, key, ""];
}
function valueFor(player, key) {
  return Number(player?.[key] || 0);
}
function playersArray() {
  const players = new Map();

  for (const [id, p] of Object.entries(stats)) {
    players.set(String(id), { id: String(id), ...p, username: p.username || id });
  }

  // Also include players that only exist in the append-only history.
  for (const entries of Object.values(history)) {
    if (!Array.isArray(entries)) continue;
    for (const h of entries) {
      const id = String(h.playerId || h.id || h.username || "");
      if (!id) continue;
      const existing = players.get(id) || { id, username: h.username || h.player || id };
      if (!existing.username || existing.username === id) {
        existing.username = h.username || h.player || id;
      }
      players.set(id, existing);
    }
  }

  return Array.from(players.values());
}
function sortedPlayers(key) {
  return playersArray().sort((a,b) => valueFor(b,key)-valueFor(a,key));
}
function dateLabel(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleString("de-DE");
}

function renderChallenges() {
  const el = $("#challenges");
  if (!challenges.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">⚔</div><h2>Keine laufenden Challenges</h2><p>Aktive Challenges werden hier angezeigt.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="challenge-grid">${
    challenges.map((c,i) => {
      const rows = (c.leaderboard || []).slice().sort((a,b)=>(b.value||0)-(a.value||0));
      return `<article class="section challenge-card">
        <div class="section-head"><div><span class="eyebrow">CHALLENGE ${i+1}</span><h2>${esc(c.name || "Challenge")}</h2></div><span class="badge">AKTIV</span></div>
        <div class="challenge-info">${esc(c.description || "")}</div>
        ${rows.length ? `<table><thead><tr><th>#</th><th>Spieler</th><th>Stand</th></tr></thead><tbody>${
          rows.map((r,n)=>`<tr><td class="rank ${n<3?'top':''}">${n+1}</td><td>${esc(r.username)}</td><td class="value">${esc(r.value)}</td></tr>`).join("")
        }</tbody></table>` : `<div class="empty">Noch keine Teilnehmer.</div>`}
      </article>`;
    }).join("")
  }</div>`;
}

function renderHall() {
  const el = $("#hall");
  if (!hall.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🧙</div><h2>Noch keine gekürten Mythos</h2><p>Die Hall of Mages wird gefüllt, sobald Mythos gekürt wurden.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="mage-grid">${
    hall.map(m=>`<article class="mage-card section">
      <div class="mage-image"><img src="./images/${encodeURIComponent(m.image || meta(m.category)[0]+'.jpg')}" alt="" onerror="this.style.display='none'"></div>
      <div class="mage-body"><span class="eyebrow">${esc(meta(m.category)[1])}</span><h2>${esc(m.username)}</h2>
      <p>${esc(meta(m.category)[2])}</p><div class="mage-value">${esc(m.value)} <small>Bestwert</small></div>
      <div class="muted">Gekürt: ${dateLabel(m.date)}</div></div>
    </article>`).join("")
  }</div>`;
}

function historyPlayers(key) {
  const hist = Array.isArray(history[key]) ? history[key] : [];
  const best = new Map();

  for (const h of hist) {
    const id = String(h.playerId || h.id || h.username || "");
    if (!id) continue;
    const value = Number(h.value || 0);
    const current = best.get(id);
    if (!current || value > current.value) {
      best.set(id, {
        id,
        username: h.username || h.player || id,
        [key]: value
      });
    }
  }

  return Array.from(best.values());
}

function allTimePlayers(key) {
  const merged = new Map();

  // Current stats remain the primary source for currently active players.
  for (const p of playersArray()) {
    merged.set(String(p.id), {
      ...p,
      [key]: valueFor(p, key)
    });
  }

  // History is append-only, so it also contains players whose current stats
  // have already been reset. Their highest recorded value is their All-Time Best.
  for (const p of historyPlayers(key)) {
    const existing = merged.get(String(p.id));
    if (!existing || valueFor(p, key) > valueFor(existing, key)) {
      merged.set(String(p.id), {
        ...(existing || {}),
        ...p,
        [key]: valueFor(p, key)
      });
    }
  }

  return Array.from(merged.values())
    .filter(p => valueFor(p, key) > 0 || (Array.isArray(history[key]) && history[key].some(h => String(h.playerId || h.id || h.username || "") === String(p.id))))
    .sort((a,b) => valueFor(b,key) - valueFor(a,key));
}

function renderCategories() {
  const el = $("#categories");
  el.innerHTML = `<div class="category-grid">${
    CATEGORY_META.map(([key,name,desc])=>{
      const currentRows = sortedPlayers(key);
      const hist = Array.isArray(history[key]) ? history[key] : [];
      const allTimeRows = allTimePlayers(key);
      const currentTop = currentRows[0];
      const historyTop = historyPlayers(key).sort((a,b) => valueFor(b,key)-valueFor(a,key))[0];
      const top = currentTop || historyTop;
      const topIsHistoryFallback = !currentTop && !!historyTop;
      return `<article class="section category-detail">
        <div class="category-image"><img src="./images/${encodeURIComponent(key+'.jpg')}" alt="" onerror="this.style.display='none'"></div>
        <div class="category-content">
          <span class="eyebrow">${esc(name)}</span><h2>${esc(desc)}</h2>
          <div class="record-row"><div><span class="muted">${topIsHistoryFallback ? "LETZTER BEKANNTER BESTWERT" : "AKTUELLER BESTWERT"}</span><strong>${top ? esc(valueFor(top,key)) : "—"}</strong><small>${top ? esc(top.username) : "Noch keine Daten"}</small></div>
          <div><span class="muted">HISTORIE</span><strong>${hist.length}</strong><small>Einträge</small></div></div>
          <h3>All-Time Best Of</h3>
          ${allTimeRows.length ? `<table><thead><tr><th>#</th><th>Spieler</th><th>Wert</th></tr></thead><tbody>${allTimeRows.slice(0,10).map((p,n)=>`<tr><td class="rank ${n<3?'top':''}">${n+1}</td><td>${esc(p.username)}</td><td class="value">${esc(valueFor(p,key))}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Noch keine Werte.</div>`}
          <div class="history-list">${hist.slice(-8).reverse().map(h=>`<div class="history-item"><span>${dateLabel(h.date)}</span><b>${esc(h.username || h.player || "")}</b><strong>${esc(h.value)}</strong></div>`).join("") || `<span class="muted">Noch keine Historieneinträge.</span>`}</div>
        </div>
      </article>`;
    }).join("")
  }</div>`;
}

function renderPlayers() {
  const el = $("#players");
  const ps = playersArray().sort((a,b) => {
    const an = String(a.username || "").toLocaleLowerCase("de-DE");
    const bn = String(b.username || "").toLocaleLowerCase("de-DE");
    return an.localeCompare(bn, "de-DE");
  });

  if (!ps.length) {
    el.innerHTML = `<div class="empty">Noch keine Spieler vorhanden.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="section">
      <div class="section-head player-search-head">
        <div>
          <h2>Spieler suchen</h2>
          <div class="muted">Suche nach Name oder Teilen des Namens.</div>
        </div>
        <input id="player-search" class="search" type="search" autocomplete="off" placeholder="Spieler suchen …" aria-label="Spieler suchen">
      </div>
      <div id="player-search-results"></div>
    </div>`;

  const input = $("#player-search");
  const results = $("#player-search-results");

  const draw = () => {
    const q = input.value.trim().toLocaleLowerCase("de-DE");

    if (!q) {
      results.innerHTML = `
        <div class="empty">
          <div class="empty-icon">⌕</div>
          <h2>Spieler suchen</h2>
          <p>Gib einen Spielernamen ein, um die Spielerseite zu öffnen.</p>
        </div>`;
      return;
    }

    const matches = ps.filter(p =>
      String(p.username || "").toLocaleLowerCase("de-DE").includes(q)
    );

    if (!matches.length) {
      results.innerHTML = `<div class="empty">Kein Spieler gefunden.</div>`;
      return;
    }

    results.innerHTML = `<div class="player-grid" style="padding:20px">${
      matches.map(p => `
        <article class="section player-card" data-player-id="${esc(p.id)}">
          <div class="player-head">
            <div class="avatar">${esc((p.username || "?").slice(0,1).toUpperCase())}</div>
            <div>
              <div class="player-name">${esc(p.username)}</div>
              <div class="muted">Gesamt ${CATEGORY_META.reduce((sum,[k]) => sum + valueFor(p,k), 0).toLocaleString("de-DE")}</div>
            </div>
          </div>
          <div class="player-total">${CATEGORY_META.reduce((sum,[k]) => sum + valueFor(p,k), 0).toLocaleString("de-DE")} <small>Werte gesamt</small></div>
        </article>`).join("")
    }</div>`;

    results.querySelectorAll("[data-player-id]").forEach(card => {
      card.addEventListener("click", () => showPlayer(card.dataset.playerId));
    });
  };

  input.addEventListener("input", draw);
  draw();
}

function showPlayer(id) {
  const player = playersArray().find(p => String(p.id) === String(id));
  if (!player) return;

  const username = player.username || id;
  const historyByCategory = key => Array.isArray(history[key])
    ? history[key].filter(x => String(x.playerId || x.id || "") === String(id) || x.username === username)
    : [];

  $("#players").innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>${esc(username)}</h2>
          <div class="muted">Spielerprofil</div>
        </div>
        <button class="refresh" id="player-back">← Zurück zur Suche</button>
      </div>
      <table>
        <thead><tr><th>Kategorie</th><th>Aktueller Wert</th><th>Rang</th><th>Historie</th></tr></thead>
        <tbody>
          ${CATEGORY_META.map(([key,name,desc]) => {
            const rank = sortedPlayers(key).findIndex(x => x.id === id) + 1;
            const entries = historyByCategory(key).slice(-5).reverse();
            return `<tr>
              <td><b>${esc(name)}</b><div class="muted">${esc(desc)}</div></td>
              <td class="value">${valueFor(player,key).toLocaleString("de-DE")}</td>
              <td>${rank ? `#${rank}` : "—"}</td>
              <td>${entries.length ? entries.map(x => `<div>${dateLabel(x.date)} · <b>${esc(x.value)}</b></div>`).join("") : `<span class="muted">Keine Historie</span>`}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  $("#player-back").addEventListener("click", renderPlayers);
}

const RAW_BASE = "https://raw.githubusercontent.com/skrane1/hll-stats/main/";

async function fetchJsonWithFallback(file, fallback = null) {
  const local = `./${file}?t=${Date.now()}`;
  try {
    const r = await fetch(local, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  try {
    const r = await fetch(`${RAW_BASE}${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  return fallback;
}

async function loadData() {
  try {
    const [s,h,ho,c] = await Promise.all([
      fetchJsonWithFallback("stats.json", {}),
      fetchJsonWithFallback("history.json", {}),
      fetchJsonWithFallback("hall-of-mages.json", []),
      fetchJsonWithFallback("challenges.json", [])
    ]);
    stats=s||{}; history=h||{}; hall=Array.isArray(ho)?ho:[]; challenges=Array.isArray(c)?c:[];
    $("#status").textContent="Verbunden";
    $("#last-update").textContent=new Date().toLocaleTimeString("de-DE");
    renderAll();
  } catch(e) {
    $("#status").textContent="Fehler";
    console.error(e);
  }
}
function renderAll(){ renderChallenges(); renderHall(); renderCategories(); renderPlayers(); }

const titles = {challenges:"Laufende Challenges",hall:"Hall of Mages",categories:"Kategorien",players:"Spieler"};
document.querySelectorAll(".nav").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); const page=btn.dataset.page;
  $("#"+page).classList.add("active"); $("#page-title").textContent=titles[page];
}));
$("#refresh").addEventListener("click",loadData);
loadData();
setInterval(loadData,30000);
