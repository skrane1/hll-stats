const CATEGORIES={
  "commander-counter":"COMMANDER CREMATOR - Kommandantenabschüsse",
  "you-shall-not-pass":"YOU SHALL NOT PASS - Zerstörte Fahrzeuge",
  "meele-mage":"MEELE-MAGE - Nahkampftötungen",
  "garry-grounder":"GARRY GROUNDER - Zerstörte Garnisonen",
  "alchemist":"ALCHEMIST - Gebaute Knotenpunkte",
  "kettenblitz":"KETTENBLITZ - Tötungen aus Fahrzeug",
  "sniperwizard":"SNIPERWIZARD - Längster Kopfschuss",
  "Oppenheimer":"OPPENHEIMER - Sprengstofftötungen",
  "thanatos":"THANATOS - Infanterieabschüsse",
  "WO OP?":"WO OP? - Zerstörte Außenposten"
};
let state={stats:{},categories:CATEGORIES};

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const cats=()=>Object.entries(state.categories);

function players(){return Object.entries(state.stats).map(([id,u])=>({id,...u}));}
function value(u,k){return Number(u[k]||0);}
function sorted(k){return players().sort((a,b)=>value(b,k)-value(a,k));}
function total(u){return cats().reduce((n,[k])=>n+value(u,k),0);}
function initials(n){return String(n||"?").trim().split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()||"?";}

async function load(){
  try{
    const r=await fetch("./stats.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok) throw new Error("stats.json konnte nicht geladen werden.");
    state.stats=await r.json();
    state.categories=CATEGORIES;
    $("#status").textContent="Verbunden";
    $("#last-update").textContent="Stand "+new Date().toLocaleTimeString("de-DE");
    renderAll();
  }catch(e){
    $("#status").textContent="Fehler";
    $("#dashboard").innerHTML=`<div class="empty">⚠️ ${esc(e.message)}<br><br>Prüfe, ob <b>stats.json</b> im gleichen Ordner wie die Website liegt.</div>`;
  }
}

function renderAll(){renderDashboard();renderLeaderboard();renderPlayers();renderCategories();}

function renderDashboard(){
 const ps=players(), cs=cats();
 const top=cs.map(([k,l])=>({k,l,u:sorted(k)[0]})).filter(x=>x.u);
 const totalEntries=ps.reduce((n,u)=>n+total(u),0);
 $("#dashboard").innerHTML=`
 <div class="grid cards">
  <div class="card"><div class="label">Spieler</div><div class="num">${ps.length}</div><div class="sub">erfasste Spieler</div></div>
  <div class="card"><div class="label">Kategorien</div><div class="num">${cs.length}</div><div class="sub">Statistik-Kategorien</div></div>
  <div class="card"><div class="label">Gesamtwerte</div><div class="num">${totalEntries.toLocaleString("de-DE")}</div><div class="sub">über alle Kategorien</div></div>
  <div class="card"><div class="label">Top-Spieler</div><div class="num">${ps.length?esc(ps.sort((a,b)=>total(b)-total(a))[0].username):"—"}</div><div class="sub">nach Gesamtwert</div></div>
 </div>
 <div class="section"><div class="section-head"><h2>Aktuelle Spitzenreiter</h2></div>
 <table><thead><tr><th>Kategorie</th><th>Spieler</th><th>Wert</th></tr></thead><tbody>
 ${top.map(x=>`<tr><td>${esc(x.l)}</td><td>${esc(x.u.username)}</td><td class="value">${value(x.u,x.k).toLocaleString("de-DE")}</td></tr>`).join("")||`<tr><td colspan="3" class="empty">Noch keine Statistikdaten.</td></tr>`}
 </tbody></table></div>`;
}

function renderLeaderboard(){
 const cs=cats(); const first=cs[0]?.[0]||"";
 $("#leaderboard").innerHTML=`
 <div class="section"><div class="section-head"><h2>Leaderboard</h2><select id="cat-select">${cs.map(([k,l])=>`<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select></div>
 <div id="lb-table"></div></div>`;
 const sel=$("#cat-select"); sel.value=first; sel.onchange=()=>drawLB(sel.value); drawLB(first);
}
function drawLB(k){
 const list=sorted(k), max=value(list[0],k)||1;
 $("#lb-table").innerHTML=list.length?`<table><thead><tr><th>Platz</th><th>Spieler</th><th>Fortschritt</th><th>Wert</th></tr></thead><tbody>
 ${list.map((u,i)=>`<tr><td class="rank ${i<3?"top":""}">${i+1}</td><td><b>${esc(u.username)}</b></td><td><div class="bar"><i style="width:${Math.min(100,value(u,k)/max*100)}%"></i></div></td><td class="value">${value(u,k).toLocaleString("de-DE")}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Keine Spielerwerte vorhanden.</div>`;
}

function renderPlayers(){
 const ps=players().sort((a,b)=>total(b)-total(a));
 $("#players").innerHTML=`<div class="section"><div class="section-head"><h2>Spieler</h2><input id="player-search" class="search" placeholder="Spieler suchen …"></div><div id="player-grid" class="grid player-grid" style="padding:20px"></div></div>`;
 const draw=()=>{const q=$("#player-search").value.toLowerCase();$("#player-grid").innerHTML=ps.filter(u=>String(u.username).toLowerCase().includes(q)).map(u=>`<div class="card player-card" onclick="showPlayer('${encodeURIComponent(u.id)}')"><div class="player-head"><div class="avatar">${initials(u.username)}</div><div><div class="player-name">${esc(u.username)}</div><div class="muted">Gesamt ${total(u).toLocaleString("de-DE")}</div></div></div><div class="player-total">${total(u).toLocaleString("de-DE")} <small>Werte gesamt</small></div></div>`).join("")||`<div class="empty">Kein Spieler gefunden.</div>`}; $("#player-search").oninput=draw;draw();
}
function showPlayer(id){
 const u=state.stats[decodeURIComponent(id)]; if(!u)return;
 $("#players").innerHTML=`<div class="section"><div class="section-head"><h2>${esc(u.username)}</h2><button class="refresh" onclick="renderPlayers()">← Zurück</button></div><table><thead><tr><th>Kategorie</th><th>Wert</th><th>Rang</th></tr></thead><tbody>
 ${cats().map(([k,l])=>{const rank=sorted(k).findIndex(x=>x.id===decodeURIComponent(id))+1;return `<tr><td>${esc(l)}</td><td class="value">${value(u,k).toLocaleString("de-DE")}</td><td>${rank?`#${rank}`:"—"}</td></tr>`}).join("")}</tbody></table></div>`;
}
function renderCategories(){
 $("#categories").innerHTML=`<div class="grid category-grid">${cats().map(([k,l])=>{const u=sorted(k)[0];return `<div class="card category"><h3>${esc(l)}</h3><p>${esc(k)}</p><div class="leader">${u?esc(u.username):"—"} <small>${u?value(u,k).toLocaleString("de-DE")+" Punkte":""}</small></div></div>`}).join("")}</div>`;
}

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");
 document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.page).classList.add("active");
 $("#page-title").textContent=b.querySelector("span").textContent;
});
$("#refresh").onclick=load;
load();
setInterval(load,30000);
