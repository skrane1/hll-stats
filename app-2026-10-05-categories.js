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



const HALL_IMAGES = {
  "commander-counter": "hall-commander-counter.png",
  "you-shall-not-pass": "hall-you-shall-not-pass.png",
  "meele-mage": "hall-meele-mage.png",
  "garry-grounder": "hall-garry-grounder.png",
  "alchemist": "hall-alchemist.png",
  "kettenblitz": "hall-kettenblitz.png",
  "sniperwizard": "hall-sniperwizard.png",
  "Oppenheimer": "hall-Oppenheimer.png",
  "thanatos": "hall-thanatos.png",
  "WO OP?": "hall-wo-op.png"
};

const CATEGORY_IMAGES = {
  "commander-counter": "commander-counter.png",
  "you-shall-not-pass": "you-shall-not-pass.png",
  "meele-mage": "meele-mage.png",
  "garry-grounder": "garry-grounder.png",
  "alchemist": "alchemist.png",
  "kettenblitz": "kettenblitz.png",
  "sniperwizard": "sniperwizard.png",
  "Oppenheimer": "Oppenheimer.png",
  "thanatos": "thanatos.png",
  "WO OP?": "wo-op.png"
};



let stats = {};
let history = {};
let hall = [];
let challenges = [];
let unified = { updatedAt: null, players: {} };

// View state must survive background data refreshes.
let activePage = "challenges";
let selectedPlayerId = null;
let playerSearchQuery = "";
let activeDetailTab = "overview";

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
function latestHistoryPlayers(key) {
  const hist = Array.isArray(history[key]) ? history[key] : [];
  const latest = new Map();

  for (const h of hist) {
    const id = String(h.playerId || h.id || h.username || "");
    if (!id) continue;
    const date = String(h.date || "");
    const current = latest.get(id);
    if (!current || date >= current.date) {
      latest.set(id, {
        id,
        username: h.username || h.player || id,
        [key]: Number(h.value || 0),
        date
      });
    }
  }

  return Array.from(latest.values());
}

function currentPlayers(key) {
  const merged = new Map();

  // Prefer the live/current stats snapshot when it contains a value.
  for (const p of playersArray()) {
    const value = valueFor(p, key);
    merged.set(String(p.id), {
      ...p,
      [key]: value
    });
  }

  // If stats.json is empty or a player/category is missing there, use the
  // newest recorded history value as the current value instead of showing 0.
  for (const p of latestHistoryPlayers(key)) {
    const id = String(p.id);
    const existing = merged.get(id);
    if (!existing || valueFor(existing, key) === 0) {
      merged.set(id, {
        ...(existing || {}),
        ...p,
        [key]: valueFor(p, key)
      });
    }
  }

  return Array.from(merged.values())
    .filter(p => valueFor(p, key) > 0)
    .sort((a,b) => valueFor(b,key) - valueFor(a,key));
}

function sortedPlayers(key) {
  return currentPlayers(key);
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
     <div class="mage-image">
  <img
    src="./images/${encodeURIComponent(m.image || HALL_IMAGES[m.category] || '')}"
    alt=""
    onerror="this.style.display='none'"
  >
</div>
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
    CATEGORY_META.map(([key, name, desc]) => {
      const currentRows = currentPlayers(key);
      const allTimeRows = allTimePlayers(key);

      const currentTop = currentRows[0];
      const historyTop = historyPlayers(key)
        .sort((a, b) => valueFor(b, key) - valueFor(a, key))[0];

      const top = currentTop || historyTop;
      const topIsHistoryFallback = !currentTop && !!historyTop;

      return `<article class="section category-detail">
        <div class="category-image">
          <img
            src="./images/${encodeURIComponent(CATEGORY_IMAGES[key] || '')}"
            alt=""
            onerror="this.style.display='none'"
          >
        </div>

        <div class="category-content">
          <span class="eyebrow">${esc(name)}</span>

          <h2>${esc(desc)}</h2>

          <div class="record-row">
            <div>
              <span class="muted">
                ${topIsHistoryFallback ? "LETZTER BEKANNTER BESTWERT" : "AKTUELLER BESTWERT"}
              </span>

              <strong>
                ${top ? esc(valueFor(top, key)) : "—"}
              </strong>

              <small>
                ${top ? esc(top.username) : "Noch keine Daten"}
              </small>
            </div>
          </div>

          <h3>All-Time Best Of</h3>

          ${
            allTimeRows.length
              ? `<table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>SPIELER</th>
                      <th>WERT</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${allTimeRows
                      .slice(0, 10)
                      .map(
                        (p, n) =>
                          `<tr>
                            <td class="rank ${n < 3 ? "top" : ""}">${n + 1}</td>
                            <td>${esc(p.username)}</td>
                            <td class="value">${esc(valueFor(p, key))}</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty">Noch keine Werte.</div>`
          }
        </div>
      </article>`;
    }).join("")
  }</div>`;
}

function unifiedFor(id) {
  const wanted = String(id);
  const direct = unified.players?.[wanted];
  if (direct) return direct;

  const player = playersArray().find(p =>
    String(p.id) === wanted ||
    String(p.discordId || "") === wanted ||
    String(p.steamId || "") === wanted ||
    String(p.epicId || "") === wanted
  );

  if (!player) return null;

  const candidates = [
    player.steamId,
    player.epicId,
    player.discordId,
    player.id
  ].filter(Boolean).map(String);

  for (const key of candidates) {
    if (unified.players?.[key]) return unified.players[key];
  }

  const username = String(player.username || "").trim().toLowerCase();
  if (username) {
    const byName = Object.values(unified.players || {}).find(p =>
      String(p?.username || "").trim().toLowerCase() === username
    );
    if (byName) return byName;
  }

  return null;
}

function fmtStat(v, suffix = '') {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return `${v.toLocaleString('de-DE', { maximumFractionDigits: 2 })}${suffix}`;
  return `${esc(v)}${suffix}`;
}
function statValue(obj, key, fallback = null) {
  return obj && obj[key] !== undefined && obj[key] !== null ? obj[key] : fallback;
}
function renderMetricCards(stats, keys) {
  return keys.filter(k => stats?.[k.key] !== undefined && stats?.[k.key] !== null).map(k =>
    `<div class="unified-stat"><span>${esc(k.label)}</span><strong>${fmtStat(stats[k.key], k.suffix || '')}</strong></div>`
  ).join('');
}
function renderUnifiedSummary(u) {
  if (!u) return `<div class="empty compact-empty"><div class="empty-icon">◈</div><h2>NO FIELD DATA</h2><p>Noch keine externen HLL-Stats synchronisiert.</p></div>`;

  const s = u.stats || {};
  const ratings = s.ratings || {};
  const hll = s.hllstats || {};
  const overallGames = s.matches ?? hll['Estimated Total Games'];
  const wins = s.wins ?? hll.Wins;
  const losses = s.losses ?? hll['Estimated Loss'];
  const ratio = hll['Estimated WL Ratio'] ?? (wins != null && losses != null && losses ? Number(wins / losses).toFixed(2) : null);
  const winrate = s.winrate ?? (wins != null && overallGames ? Number(wins / overallGames * 100) : null);

  const heroStats = [
    {label:'GESPIELTE GAMES',value:overallGames,icon:'◫'},
    {label:'SIEGE',value:wins,icon:'★',tone:'green'},
    {label:'NIEDERLAGEN',value:losses,icon:'✚',tone:'red'},
    {label:'SIEGQUOTE',value:winrate != null ? Number(winrate).toLocaleString('de-DE',{maximumFractionDigits:1})+'%' : null,icon:'◔',tone:'gold'},
    {label:'W/L RATIO',value:ratio,icon:'◈',tone:'blue'}
  ];

  const ratingItems = [
    {key:'overall',label:'OVERALL'}, {key:'team',label:'TEAM'}, {key:'impact',label:'IMPACT'}, {key:'comp',label:'COMP'}
  ];

  return `<div class="profile-data">

    <div class="profile-section-label"><span>01</span> CAREER OVERVIEW <i></i><small>${u.updatedAt ? `DATA LINK · ${dateLabel(u.updatedAt)}` : 'DATA LINK · WAITING'}</small></div>

    <div class="profile-hero-stats">
      ${heroStats.map(x => `<div class="hero-stat ${x.tone || ''}">
        <div class="hero-stat-top"><span>${x.icon}</span><small>${esc(x.label)}</small></div>
        <strong>${x.value == null ? '—' : fmtStat(x.value)}</strong>
      </div>`).join('')}
    </div>

    <div class="profile-overview-grid">
      <div class="profile-module career-module">
        <div class="module-head"><span>CAREER</span><small>HLLSTATS.DEV</small></div>
        <div class="career-main">
          <div class="career-xp"><span>CAREER XP</span><strong>${fmtStat(hll['Career XP'])}</strong><i>✦</i></div>
          <div class="career-roles">
            ${[['Commander','Commander'],['Officer','Officer'],['Tank Commander','Tank Commander'],['Spotter','Spotter']].map(([label,key]) =>
              `<div><span>${esc(label)}</span><b>${fmtStat(hll[key])}</b></div>`).join('')}
          </div>
        </div>
      </div>

      <div class="profile-module faction-module">
        <div class="module-head"><span>FACTIONS</span><small>ESTIMATED</small></div>
        <div class="faction-strip">
          ${Object.entries(hll.factions || {}).map(([name,value],i) =>
            `<div class="faction faction-${i % 4}"><span>${esc(name)}</span><b>${fmtStat(value)}</b></div>`).join('') || '<div class="module-empty">NO FACTION DATA</div>'}
        </div>
      </div>
    </div>

    <div class="profile-module performance-module">
      <div class="module-head"><span>PERFORMANCE // RATINGS</span><small>UNIFIED DATA</small></div>
      <div class="performance-grid">
        ${ratingItems.map(x => `<div><span>${esc(x.label)}</span><b>${fmtStat(ratings[x.key])}</b></div>`).join('')}
        <div><span>K/D</span><b>${fmtStat(s.kd)}</b></div>
        <div><span>KPM</span><b>${fmtStat(s.kpm)}</b></div>
        <div><span>SCORE / MIN</span><b>${fmtStat(s.scorePerMin)}</b></div>
        <div><span>PLAYTIME</span><b>${fmtStat(s.playtimeHours,' h')}</b></div>
      </div>
    </div>

    <div class="profile-section-label"><span>02</span> FIELD STATISTICS <i></i><small>COMBAT · SUPPORT · ROLES · MAPS</small></div>
  </div>`;
}

function renderStatSection(title, rows, extraClass='', hideZero=false) {
  const visible = rows.filter(([label,value]) => value !== undefined && value !== null && value !== '' && (!hideZero || Number(value) !== 0));
  if (!visible.length) return '';
  return `<div class="stats-panel ${extraClass}"><div class="subsection-title">${esc(title)}</div><div class="stats-grid">${visible.map(([label,value,suffix='']) => `<div class="detail-stat"><span>${esc(label)}</span><strong>${fmtStat(value,suffix)}</strong></div>`).join('')}</div></div>`;
}

function renderDetailedUnified(u) {
  if (!u) return '';
  const s = u.stats || {};
  const combat = s.combat || {};
  const support = s.support || {};
  const roles = s.roles || {};
  const maps = s.maps || {};
  const factions = s.factions || {};
  const ratings = s.ratings || {};
  const hll = s.hllstats || {};
  const recent = s.recent || {};
  const trends = s.trends || {};
  const matchRows = Array.isArray(u.matches) ? u.matches : [];

  // HLLStats.dev is a data source, not a separate player-profile section.
  // Put its values into the existing logical tabs so the profile stays compact.
  const hv = (key, fallback = null) => hll[key] !== undefined && hll[key] !== null ? hll[key] : fallback;
  const hllFactions = Object.entries(hll.factions || {});
  const hllRoles = Object.entries(hll.roles || {});
  const hllMaps = Object.entries(hll.maps || {});
  const hllModes = Object.entries(hll.gameModes || {});
  const hllBuilt = Object.entries(hll.built || {});

  const overview = renderStatSection('ÜBERSICHT', [
    ['Kills',s.kills],['Deaths',s.deaths],['K/D',s.kd],['KPM',s.kpm],['DPM',s.dpm],['Score/Min',s.scorePerMin],
    ['Wins',s.wins ?? hv('Wins')],['Losses',s.losses ?? hv('Estimated Loss')],['Winrate',s.winrate,'%'],
    ['Matches',s.matches ?? hv('Estimated Total Games')],['Spielzeit',s.playtimeHours,' h'],
    ['Teamkills',s.teamKills],['Längste Killstreak',s.longestKillstreak],
    ['Headshots',s.headshots ?? hv('Headshots')],['Vehicle zerstört',s.vehicleDestroyed ?? hv('Vehicle Destroyed')],
    ['Tanks zerstört',s.tanksDestroyed ?? hv('Tanks Destroyed')],['Jeeps zerstört',s.jeepsDestroyed ?? hv('Jeeps Destroyed')],
    ['Career XP',hv('Career XP')],['Commander',hv('Commander')],['Officer',hv('Officer')],
    ['Tank Commander',hv('Tank Commander')],['Spotter',hv('Spotter')],
    ['Estimated W/L Ratio',hv('Estimated WL Ratio')]
  ]);
  const factionOverview = hllFactions.length
    ? renderStatSection('HLLSTATS.DEV · FAKTIONEN', hllFactions)
    : '';
  const ratingHtml = renderStatSection('RATINGS & PERFORMANCE', [
    ['Overall Rating',ratings.overall],['Team Rating',ratings.team],['Impact Rating',ratings.impact],
    ['Comp Rating',ratings.comp],['Combat / min',ratings.combatPerMin],['Offense / min',ratings.offensePerMin],
    ['Defense / min',ratings.defensePerMin],['Support / min',ratings.supportPerMin],['Score / min',s.scorePerMin]
  ]);
  const recentHtml = renderStatSection('RECENT PERFORMANCE', [
    ['Recent K/D',recent.kd],['Recent KPM',recent.kpm],['Recent Winrate',recent.winrate,'%'],
    ['Recent Combat',recent.combatPerMin],['Recent Offense',recent.offensePerMin],
    ['Recent Defense',recent.defensePerMin],['Recent Support',recent.supportPerMin],['Games im Trend',recent.games]
  ]);

  const combatRows = [
    ['Kills',combat.kills ?? s.kills ?? hv('Kills')],['Deaths',combat.deaths ?? s.deaths],
    ['K/D',combat.kd ?? s.kd],['KPM',combat.kpm ?? s.kpm],['DPM',combat.dpm ?? s.dpm],
    ['Headshots',combat.headshots ?? s.headshots ?? hv('Headshots')],
    ['Artillerie',combat.artillery ?? hv('Artillery')],['Knife',combat.knife ?? hv('Knife')],
    ['Spade',combat.spade ?? hv('Spade')],['Flamethrower',combat.flamethrower ?? hv('Flamethrower')],
    ['Half-track MG',combat.halftrackMg ?? hv('Half-track MG')],
    ['Jeep Impact',combat.jeepImpact ?? hv('Jeep Impact')],
    ['Vehicle zerstört',combat.vehicleDestroyed ?? s.vehicleDestroyed ?? hv('Vehicle Destroyed')],
    ['Tanks zerstört',combat.tanksDestroyed ?? s.tanksDestroyed ?? hv('Tanks Destroyed')],
    ['Jeeps zerstört',combat.jeepsDestroyed ?? s.jeepsDestroyed ?? hv('Jeeps Destroyed')],
    ['Teamkills',combat.teamKills ?? s.teamKills],
    ['Estimated Games',hv('Estimated Total Games')],['Wins',hv('Wins')],['Losses',hv('Estimated Loss')],
    ['W/L Ratio',hv('Estimated WL Ratio')]
  ];
  const combatHtml = renderStatSection('COMBAT', combatRows);

  const supportRows = [
    ['Supplies gedroppt',support.suppliesDropped ?? hll.supplies?.totalDropped],
    ['Supplies verwendet',support.suppliesUsed ?? hll.supplies?.totalUsed],
    ['Truck Drops',support.truckDrops ?? hll.supplies?.truckDrops],
    ['Ammo gedroppt',support.ammoDropped ?? hll.ammo?.totalDropped],
    ['Jeep Drops',support.jeepDrops ?? hv('Jeep Drops')],
    ['Belgian Gates',support.belgianGates ?? hll.built?.['Belgian Gate']],
    ['Barbed Wire',support.barbedWire ?? hll.built?.['Barbed Wire']],
    ['Barricades',support.barricades ?? hll.built?.Barricades],
    ['Bunkers',support.bunkers ?? hll.built?.Bunkers],
    ['Repair Stations',support.repairStations ?? hll.built?.['Repair Stations']],
    ['Fuel Nodes',support.fuelNodes ?? hll.built?.['Fuel Nodes']],
    ['Manpower Nodes',support.manpowerNodes ?? hll.built?.['Manpower Nodes']],
    ['Munitions Nodes',support.munitionsNodes ?? hll.built?.['Munitions Nodes']],
    ['Flare Gun Scans',support.flareGunScans ?? hv('Flare Gun Scans')],
    ['Half-track Spawns',support.halftrackSpawns ?? hv('Half-track Spawns')],
    ['Molotovs',support.molotovs ?? hv('Molotovs Thrown')],
    ['Captured Sectors',support.capturedSectors ?? s.capturedSectors ?? hv('Captured Sectors')],
    ['Commends erhalten',hll.commends?.received ?? hv('Received')],
    ['Commends gegeben',hll.commends?.given ?? hv('Given')]
  ];
  const supportHtml = renderStatSection('SUPPORT & BUILD', supportRows);

  const roleRows = Object.entries(roles).filter(([,v]) => v && typeof v === 'object')
    .map(([name,v]) => [name, `${v.playtimeHours ?? 0} h · ${v.kills ?? 0} K · ${v.deaths ?? 0} D${v.kd != null ? ` · ${Number(v.kd).toFixed(2)} K/D` : ''}`]);
  const hllRoleHtml = hllRoles.length
    ? renderStatSection('HLLSTATS.DEV · ROLLEN', hllRoles)
    : '';
  const roleHtml = (roleRows.length ? `<div class="stats-panel"><div class="subsection-title">ROLLEN</div><div class="role-grid">${roleRows.map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${esc(value)}</span></div>`).join('')}</div></div>` : '') + hllRoleHtml;

  const mapRows = Object.entries(maps).filter(([,v]) => v && typeof v === 'object')
    .map(([name,v]) => [name, `${v.matches ?? 0} Games · ${v.wins ?? 0} W · ${v.losses ?? 0} L${v.kd != null ? ` · ${Number(v.kd).toFixed(2)} K/D` : ''}${v.winrate != null ? ` · ${Number(v.winrate).toFixed(1)}%` : ''}`]);
  const mapHtml = (mapRows.length
    ? `<div class="stats-panel"><div class="subsection-title">MAPS</div><div class="role-grid">${mapRows.map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${esc(value)}</span></div>`).join('')}</div></div>`
    : '') +
    (hllMaps.length
      ? `<div class="stats-panel"><div class="subsection-title">HLLSTATS.DEV · MAPS GESPIELT</div><div class="role-grid">${hllMaps.map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${fmtStat(value)} Games</span></div>`).join('')}</div></div>`
      : '');

  const modeHtml = hllModes.length ? renderStatSection('HLLSTATS.DEV · GAME MODES', hllModes) : '';
  const builtExtra = hllBuilt.length ? renderStatSection('HLLSTATS.DEV · BUILT', hllBuilt) : '';

  const trendRows = Object.entries(trends).filter(([,v]) => v !== null && v !== undefined).map(([k,v]) => [k,v]);
  const trendHtml = renderStatSection('TRENDS / HISTORY', trendRows);
  const matchHtml = matchRows.length
    ? `<div class="stats-panel"><div class="subsection-title">MATCH HISTORY</div><div class="match-table-wrap"><table><thead><tr><th>DATUM</th><th>MAP</th><th>SERVER</th><th>MODUS</th><th>RESULTAT</th><th>K/D</th><th>KPM</th><th>SCORE</th></tr></thead><tbody>${matchRows.slice(0,50).map(m=>`<tr><td>${dateLabel(m.startAt || m.startedAt)}</td><td>${esc(m.map || '—')}</td><td>${esc(m.server || '—')}</td><td>${esc(m.mode || m.gamemode || '—')}</td><td>${esc(m.result || m.resultat || '—')}</td><td>${fmtStat(m.kd)}</td><td>${fmtStat(m.kpm)}</td><td>${fmtStat(m.score)}</td></tr>`).join('')}</tbody></table></div></div>`
    : '';

  return `<div class="player-dashboard" data-detail-tabs>
    <aside class="player-nav">
      <div class="player-nav-title">FIELD MENU</div>
      <button class="detail-tab active" data-tab="overview"><i>⌂</i><span>ÜBERSICHT</span><small>01</small></button>
      <button class="detail-tab" data-tab="combat"><i>◉</i><span>COMBAT</span><small>02</small></button>
      <button class="detail-tab" data-tab="support"><i>▥</i><span>SUPPORT</span><small>03</small></button>
      <button class="detail-tab" data-tab="roles"><i>♜</i><span>ROLLEN</span><small>04</small></button>
      <button class="detail-tab" data-tab="maps"><i>⌖</i><span>MAPS</span><small>05</small></button>
      <button class="detail-tab" data-tab="history"><i>⌁</i><span>HISTORY</span><small>06</small></button>
    </aside>
    <div class="player-dashboard-content">
      <div class="detail-tab-content active" data-content="overview">${overview}${factionOverview}${ratingHtml}${recentHtml}</div>
      <div class="detail-tab-content" data-content="combat">${combatHtml}</div>
      <div class="detail-tab-content" data-content="support">${supportHtml}${builtExtra}</div>
      <div class="detail-tab-content" data-content="roles">${roleHtml || '<div class="empty">Noch keine Rollendaten synchronisiert.</div>'}</div>
      <div class="detail-tab-content" data-content="maps">${mapHtml || '<div class="empty">Noch keine Mapdaten synchronisiert.</div>'}</div>
      <div class="detail-tab-content" data-content="history">${modeHtml}${trendHtml}${matchHtml || '<div class="empty">Noch keine Match-Historie synchronisiert.</div>'}</div>
    </div>
  </div>`;
}
function renderPlayers() {
  selectedPlayerId = null;
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
  input.value = playerSearchQuery;

  const draw = () => {
    playerSearchQuery = input.value;
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

function showPlayer(id, options = {}) {
  const player = playersArray().find(p => String(p.id) === String(id));
  if (!player) return;

  selectedPlayerId = String(id);

  const username = player.username || id;
  const historyByCategory = key => Array.isArray(history[key])
    ? history[key].filter(x => String(x.playerId || x.id || "") === String(id) || x.username === username)
    : [];

  const unifiedPlayer = unifiedFor(id);
  const preservedTab = options.preserveTab ? activeDetailTab : "overview";

  $("#players").innerHTML = `
    <div class="section player-profile">
      <div class="player-profile-hero">
        <div class="profile-hero-bg"></div>
        <div class="player-profile-identity">
          <div class="profile-avatar">${esc((username || "?").slice(0,1).toUpperCase())}</div>
          <div>
            <span class="eyebrow">GWSM // PERSONNEL RECORD</span>
            <h2>${esc(username)}</h2>
            <div class="profile-meta"><span>HELL LET LOOSE</span><span class="profile-separator">/</span><span>FIELD STATISTICS</span><span class="profile-separator">/</span><span>LIVE RECORD</span></div>
          </div>
        </div>
        <div class="player-profile-actions">
          <div class="profile-signal"><span class="status-dot"></span> DATA LINK ACTIVE</div>
          <button class="refresh" id="player-back">← ZURÜCK</button>
        </div>
      </div>
      ${renderUnifiedSummary(unifiedPlayer)}
      ${renderDetailedUnified(unifiedPlayer)}
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

  $("#player-back").addEventListener("click", () => {
    selectedPlayerId = null;
    playerSearchQuery = "";
    activeDetailTab = "overview";
    renderPlayers();
  });

  const tabs = document.querySelectorAll('[data-detail-tabs] .detail-tab');
  const contents = document.querySelectorAll('[data-detail-tabs] .detail-tab-content');
  tabs.forEach(btn => btn.addEventListener('click', () => {
    const root = btn.closest('[data-detail-tabs]');
    activeDetailTab = btn.dataset.tab;
    root.querySelectorAll('.detail-tab').forEach(x => x.classList.remove('active'));
    root.querySelectorAll('.detail-tab-content').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    root.querySelector(`[data-content="${btn.dataset.tab}"]`)?.classList.add('active');
  }));

  // A refresh can rebuild the profile without changing the user's open tab.
  if (preservedTab !== "overview") {
    const tab = Array.from(tabs).find(x => x.dataset.tab === preservedTab);
    const content = rootContent => document.querySelector(`[data-detail-tabs] [data-content="${rootContent}"]`);
    if (tab && content(preservedTab)) {
      tabs.forEach(x => x.classList.remove("active"));
      contents.forEach(x => x.classList.remove("active"));
      tab.classList.add("active");
      content(preservedTab).classList.add("active");
    }
  }
}

const RAW_BASE = "https://raw.githubusercontent.com/skrane1/hll-stats/main/";
const DATA_VERSION = "2026-10-05-chronik-3";

async function fetchJsonWithFallback(file, fallback = null) {
  // GitHub Pages can serve the repository copy from its own cache.
  // The raw repository is the authoritative live data source.
  try {
    const r = await fetch(`${RAW_BASE}${file}?v=${encodeURIComponent(DATA_VERSION)}&t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  try {
    const r = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  return fallback;
}

async function loadData(options = {}) {
  try {
    const [s,h,ho,c,u] = await Promise.all([
      fetchJsonWithFallback("stats.json", {}),
      fetchJsonWithFallback("history-live-2026-10-05.json", {}),
      fetchJsonWithFallback("hall-of-mages.json", []),
      fetchJsonWithFallback("challenges.json", []),
      fetchJsonWithFallback("unified-stats.json", {updatedAt:null,players:{}})
    ]);

    stats=s||{};
    history=h||{};
    hall=Array.isArray(ho)?ho:[];
    challenges=Array.isArray(c)?c:[];
    unified=u&&typeof u==="object"?u:{updatedAt:null,players:{}};

    $("#status").textContent="Verbunden";
    $("#last-update").textContent=new Date().toLocaleTimeString("de-DE");

    // Never replace the player profile DOM during background polling.
    // This was the cause of users being thrown back to the search screen.
    renderAll({ preservePlayer: true, manual: !!options.manual });
  } catch(e) {
    $("#status").textContent="Fehler";
    console.error("GWSM data refresh failed:", e);
  }
}

function renderAll(options = {}) {
  // Only paint the visible page. Hidden-page DOM rebuilds are avoided during polling.
  if (activePage === "challenges") renderChallenges();
  else if (activePage === "hall") renderHall();
  else if (activePage === "categories") renderCategories();
  else if (activePage === "players") {
    if (selectedPlayerId) {
      if (options.manual) showPlayer(selectedPlayerId, { preserveTab: true });
    } else {
      renderPlayers();
    }
  }
}

const titles = {
  challenges:"Laufende Challenges",
  hall:"Hall of Mages",
  categories:"Kategorien",
  players:"Spieler"
};

document.querySelectorAll(".nav").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));

  btn.classList.add("active");
  activePage = btn.dataset.page;
  selectedPlayerId = null;
  activeDetailTab = "overview";

  const page = activePage;
  $("#"+page).classList.add("active");
  $("#page-title").textContent=titles[page];

  if (page === "challenges") {
    renderChallenges();
  } else if (page === "hall") {
    renderHall();
  } else if (page === "categories") {
    renderCategories();
  } else if (page === "players") {
    renderPlayers();
  }
}));

$("#refresh").addEventListener("click", () => loadData({ manual: true }));
loadData({ manual: true });
setInterval(() => loadData(), 60000);
