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
  return Object.entries(stats).map(([id,p]) => ({id, ...p, username:p.username || id}));
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

function renderCategories() {
  const el = $("#categories");
  el.innerHTML = `<div class="category-grid">${
    CATEGORY_META.map(([key,name,desc])=>{
      const rows = sortedPlayers(key);
      const top = rows[0];
      const hist = Array.isArray(history[key]) ? history[key] : [];
      return `<article class="section category-detail">
        <div class="category-image"><img src="./images/${encodeURIComponent(key+'.jpg')}" alt="" onerror="this.style.display='none'"></div>
        <div class="category-content">
          <span class="eyebrow">${esc(name)}</span><h2>${esc(desc)}</h2>
          <div class="record-row"><div><span class="muted">AKTUELLER BESTWERT</span><strong>${top ? esc(valueFor(top,key)) : "—"}</strong><small>${top ? esc(top.username) : "Noch keine Daten"}</small></div>
          <div><span class="muted">HISTORIE</span><strong>${hist.length}</strong><small>Einträge</small></div></div>
          <h3>All-Time Best Of</h3>
          ${rows.length ? `<table><thead><tr><th>#</th><th>Spieler</th><th>Wert</th></tr></thead><tbody>${rows.slice(0,10).map((p,n)=>`<tr><td class="rank ${n<3?'top':''}">${n+1}</td><td>${esc(p.username)}</td><td class="value">${esc(valueFor(p,key))}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">Noch keine Werte.</div>`}
          <div class="history-list">${hist.slice(-8).reverse().map(h=>`<div class="history-item"><span>${dateLabel(h.date)}</span><b>${esc(h.username || h.player || "")}</b><strong>${esc(h.value)}</strong></div>`).join("") || `<span class="muted">Historie wird nach Anbindung der Bot-Historie angezeigt.</span>`}</div>
        </div>
      </article>`;
    }).join("")
  }</div>`;
}

function renderPlayers() {
  const el = $("#players");
  const ps = playersArray();
  if (!ps.length) { el.innerHTML = `<div class="empty">Noch keine Spieler vorhanden.</div>`; return; }
  el.innerHTML = `<div class="player-grid">${ps.map(p=>`<article class="section player-detail">
    <div class="player-head"><div class="avatar">${esc((p.username||"?").slice(0,1).toUpperCase())}</div><div><div class="player-name">${esc(p.username)}</div><div class="muted">${esc(p.id)}</div></div></div>
    <div class="player-total">${CATEGORY_META.reduce((s,[k])=>s+valueFor(p,k),0)} <small>Gesamtwerte</small></div>
    ${CATEGORY_META.map(([k,name,desc])=>{
      const h = Array.isArray(history[k]) ? history[k].filter(x => String(x.playerId||x.id||"")===String(p.id) || x.username===p.username) : [];
      return `<div class="player-cat"><div><b>${esc(name)}</b><span>${esc(desc)}</span></div><strong>${esc(valueFor(p,k))}</strong><div class="mini-history">${h.slice(-5).reverse().map(x=>`<span>${dateLabel(x.date)} · ${esc(x.value)}</span>`).join("") || `<span class="muted">Keine Historie</span>`}</div></div>`;
    }).join("")}
  </article>`).join("")}</div>`;
}

async function loadData() {
  try {
    const [s,h,ho,c] = await Promise.all([
      fetch(`./stats.json?t=${Date.now()}`).then(r=>r.ok?r.json():{}),
      fetch(`./history.json?t=${Date.now()}`).then(r=>r.ok?r.json():{}).catch(()=>({})),
      fetch(`./hall-of-mages.json?t=${Date.now()}`).then(r=>r.ok?r.json():[]).catch(()=>[]),
      fetch(`./challenges.json?t=${Date.now()}`).then(r=>r.ok?r.json():[]).catch(()=>[])
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
