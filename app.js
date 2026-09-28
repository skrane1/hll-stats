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

let stats = {};
let history = {};
let hall = [];
let challenges = [];
let unified = { updatedAt: null, players: {} };

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
      const currentRows = sortedPlayers(key);
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
  if (!u) return `<div class="empty compact-empty">Noch keine externen HLL-Stats synchronisiert.</div>`;
  const s = u.stats || {};
  const ratings = s.ratings || {};
  const items = [
    {key:'kills',label:'KILLS'}, {key:'deaths',label:'DEATHS'}, {key:'kd',label:'K/D'},
    {key:'winrate',label:'WINRATE',suffix:'%'}, {key:'matches',label:'MATCHES'}, {key:'playtimeHours',label:'PLAYTIME',suffix:' h'},
    {key:'kpm',label:'KPM'}, {key:'scorePerMin',label:'SCORE/MIN'}, {key:'headshots',label:'HEADSHOTS'},
    {key:'teamKills',label:'TEAMKILLS'}, {key:'longestKillstreak',label:'KILLSTREAK'}, {key:'capturedSectors',label:'SEKTOREN'}
  ];
  const ratingItems = [
    {key:'overall',label:'OVERALL'}, {key:'team',label:'TEAM'}, {key:'impact',label:'IMPACT'}, {key:'comp',label:'COMP'}
  ];
  return `<div class="unified-box">
    <div class="unified-title"><div><span class="eyebrow">UNIFIED HLL STATS</span><h3>Externe Gesamtstatistik</h3></div><span class="unified-updated">${u.updatedAt ? `Update ${dateLabel(u.updatedAt)}` : '—'}</span></div>
    <div class="unified-grid">${renderMetricCards(s, items)}</div>
    ${Object.values(ratings).some(v => v != null) ? `<div class="subsection-title">HLL RATINGS</div><div class="unified-grid">${renderMetricCards(ratings, ratingItems)}</div>` : ''}
    <div class="unified-foot">${u.coverage ? `Abdeckung: ${esc(u.coverage)}` : 'Die Statistik wird aus den verfügbaren HLL-Datenquellen zusammengeführt.'}</div>
  </div>`;
}

function renderStatSection(title, rows, extraClass='') {
  const visible = rows.filter(([label,value]) => value !== undefined && value !== null && value !== '');
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
  const hll = s.hllstats || {};
  const matchRows = Array.isArray(u.matches) ? u.matches : [];

  const overview = renderStatSection('ÜBERSICHT', [
    ['Kills',s.kills],['Deaths',s.deaths],['K/D',s.kd],['KPM',s.kpm],['DPM',s.dpm],['Score/Min',s.scorePerMin],
    ['Wins',s.wins],['Losses',s.losses],['Winrate',s.winrate,'%'],['Matches',s.matches],['Spielzeit',s.playtimeHours,' h'],
    ['Teamkills',s.teamKills],['Längste Killstreak',s.longestKillstreak],['Headshots',s.headshots],['Vehicle zerstört',s.vehicleDestroyed],['Tanks zerstört',s.tanksDestroyed],['Jeeps zerstört',s.jeepsDestroyed]
  ]);
  const combatHtml = renderStatSection('COMBAT', [
    ['Kills',combat.kills ?? s.kills],['Deaths',combat.deaths ?? s.deaths],['K/D',combat.kd ?? s.kd],['KPM',combat.kpm ?? s.kpm],['DPM',combat.dpm ?? s.dpm],
    ['Headshots',combat.headshots ?? s.headshots],['Artillerie',combat.artillery],['Knife',combat.knife],['Spade',combat.spade],['Flamethrower',combat.flamethrower],
    ['Half-track MG',combat.halftrackMg],['Jeep Impact',combat.jeepImpact],['Vehicle zerstört',combat.vehicleDestroyed ?? s.vehicleDestroyed],['Tanks zerstört',combat.tanksDestroyed ?? s.tanksDestroyed],['Jeeps zerstört',combat.jeepsDestroyed ?? s.jeepsDestroyed],['Teamkills',combat.teamKills ?? s.teamKills]
  ]);
  const supportHtml = renderStatSection('SUPPORT & BUILD', [
    ['Supplies gedroppt',support.suppliesDropped],['Supplies verwendet',support.suppliesUsed],['Truck Drops',support.truckDrops],['Ammo gedroppt',support.ammoDropped],['Jeep Drops',support.jeepDrops],
    ['Belgian Gates',support.belgianGates],['Barbed Wire',support.barbedWire],['Barricades',support.barricades],['Bunkers',support.bunkers],['Repair Stations',support.repairStations],
    ['Fuel Nodes',support.fuelNodes],['Manpower Nodes',support.manpowerNodes],['Munitions Nodes',support.munitionsNodes],['Flare Gun Scans',support.flareGunScans],['Half-track Spawns',support.halftrackSpawns],['Molotovs',support.molotovs],['Captured Sectors',support.capturedSectors ?? s.capturedSectors]
  ]);
  const hllHtml = renderStatSection('HLLSTATS.DEV · CAREER STATS', [
    ['Estimated Games', hll['Estimated Total Games']],
    ['Wins', hll['Wins']],
    ['Losses', hll['Estimated Loss']],
    ['W/L Ratio', hll['Estimated WL Ratio']],
    ['Kills', hll['Kills']],
    ['Vehicle zerstört', hll['Vehicle Destroyed']],
    ['Tanks zerstört', hll['Tanks Destroyed']],
    ['Jeeps zerstört', hll['Jeeps Destroyed']],
    ['Headshots', hll['Headshots']],
    ['Artillerie', hll['Artillery']],
    ['Knife', hll['Knife']],
    ['Spade', hll['Spade']],
    ['Half-track MG', hll['Half-track MG']],
    ['Flamethrower', hll['Flamethrower']],
    ['Molotovs', hll['Molotovs Thrown']],
    ['Sektoren erobert', hll['Captured Sectors']]
  ]);

  const hllstatsHtml = [
    renderStatSection('HLLSTATS.DEV · OVERALL', [
      ['Estimated Total Games', hll['Estimated Total Games']],['Wins', hll.Wins],['Estimated Loss', hll['Estimated Loss']],
      ['Estimated W/L Ratio', hll['Estimated WL Ratio']],['Maps Played', hll['Amount Of Maps Played']]
    ]),
    renderStatSection('KILLS & COMBAT', [
      ['Kills', hll.Kills],['Vehicle zerstört',hll['Vehicle Destroyed']],['Tanks zerstört',hll['Tanks Destroyed']],
      ['Jeeps zerstört',hll['Jeeps Destroyed']],['Headshots',hll.Headshots],['Artillerie',hll.Artillery],
      ['Knife',hll.Knife],['Spade',hll.Spade],['Half-track MG',hll['Half-track MG']],['Flamethrower',hll.Flamethrower],['Jeep Impact',hll['Jeep Impact']]
    ]),
    renderStatSection('FAKTIONEN', Object.entries(hll.factions || {})),
    renderStatSection('ROLLEN', Object.entries(hll.roles || {})),
    renderStatSection('GAME MODES', Object.entries(hll.gameModes || {})),
    renderStatSection('BUILT', Object.entries(hll.built || {})),
    renderStatSection('COMMENDS', [['Received',hll.commends?.received],['Given',hll.commends?.given]]),
    renderStatSection('SUPPLIES', [['Total Dropped',hll.supplies?.totalDropped],['Total Used',hll.supplies?.totalUsed],['Truck Drops',hll.supplies?.truckDrops]]),
    renderStatSection('AMMO', [['Total Dropped',hll.ammo?.totalDropped],['Jeep Drops',hll['Jeep Drops']]]),
    renderStatSection('OTHER', [['Flare Gun Scans',hll['Flare Gun Scans']],['Half-track Spawns',hll['Half-track Spawns']],['Molotovs Thrown',hll['Molotovs Thrown']],['Captured Sectors',hll['Captured Sectors']]]),
    `<div class="stats-panel"><div class="subsection-title">MAPS</div><div class="role-grid">${Object.entries(hll.maps || {}).map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${fmtStat(value)}</span></div>`).join('')}</div></div>`
  ].join('');
  const ratingHtml = renderStatSection('RATINGS & PERFORMANCE', [
    ['Overall Rating',ratings.overall],['Team Rating',ratings.team],['Impact Rating',ratings.impact],['Comp Rating',ratings.comp],['Combat / min',ratings.combatPerMin],['Offense / min',ratings.offensePerMin],['Defense / min',ratings.defensePerMin],['Support / min',ratings.supportPerMin],['Score / min',s.scorePerMin]
  ]);
  const recentHtml = renderStatSection('RECENT PERFORMANCE', [
    ['Recent K/D',recent.kd],['Recent KPM',recent.kpm],['Recent Winrate',recent.winrate,'%'],['Recent Combat',recent.combatPerMin],['Recent Offense',recent.offensePerMin],['Recent Defense',recent.defensePerMin],['Recent Support',recent.supportPerMin],['Games im Trend',recent.games]
  ]);
  const factionRows = Object.entries(factions).filter(([,v]) => v !== null && v !== undefined).map(([k,v]) => [k,v]);
  const factionHtml = renderStatSection('FAKTIONEN', factionRows);
  const roleRows = Object.entries(roles).filter(([,v]) => v && typeof v === 'object').map(([name,v]) => [name, `${v.playtimeHours ?? 0} h · ${v.kills ?? 0} K · ${v.deaths ?? 0} D${v.kd != null ? ` · ${Number(v.kd).toFixed(2)} K/D` : ''}`]);
  const roleHtml = roleRows.length ? `<div class="stats-panel"><div class="subsection-title">ROLLEN</div><div class="role-grid">${roleRows.map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${esc(value)}</span></div>`).join('')}</div></div>` : '';
  const mapRows = Object.entries(maps).filter(([,v]) => v && typeof v === 'object').map(([name,v]) => [name, `${v.matches ?? 0} Games · ${v.wins ?? 0} W · ${v.losses ?? 0} L${v.kd != null ? ` · ${Number(v.kd).toFixed(2)} K/D` : ''}${v.winrate != null ? ` · ${Number(v.winrate).toFixed(1)}%` : ''}`]);
  const mapHtml = mapRows.length ? `<div class="stats-panel"><div class="subsection-title">MAPS</div><div class="role-grid">${mapRows.map(([name,value])=>`<div class="role-card"><b>${esc(name)}</b><span>${esc(value)}</span></div>`).join('')}</div></div>` : '';
  const trendRows = Object.entries(trends).filter(([,v]) => v !== null && v !== undefined).map(([k,v]) => [k,v]);
  const trendHtml = renderStatSection('TRENDS / HISTORY', trendRows);
  const matchHtml = matchRows.length ? `<div class="stats-panel"><div class="subsection-title">MATCH HISTORY</div><div class="match-table-wrap"><table><thead><tr><th>DATUM</th><th>MAP</th><th>SERVER</th><th>MODUS</th><th>RESULTAT</th><th>K/D</th><th>KPM</th><th>SCORE</th></tr></thead><tbody>${matchRows.slice(0,50).map(m=>`<tr><td>${dateLabel(m.startAt || m.startedAt)}</td><td>${esc(m.map || '—')}</td><td>${esc(m.server || '—')}</td><td>${esc(m.mode || m.gamemode || '—')}</td><td>${esc(m.result || m.resultat || '—')}</td><td>${fmtStat(m.kd)}</td><td>${fmtStat(m.kpm)}</td><td>${fmtStat(m.score)}</td></tr>`).join('')}</tbody></table></div></div>` : '';

  return `<div class="detail-tabs" data-detail-tabs>
    <div class="detail-tab-buttons"><button class="detail-tab active" data-tab="overview">Übersicht</button><button class="detail-tab" data-tab="hllstats">HLLStats.dev</button><button class="detail-tab" data-tab="combat">Combat</button><button class="detail-tab" data-tab="support">Support</button><button class="detail-tab" data-tab="roles">Rollen</button><button class="detail-tab" data-tab="maps">Maps</button><button class="detail-tab" data-tab="history">History</button></div>
    <div class="detail-tab-content active" data-content="overview">${overview}${ratingHtml}${recentHtml}</div>
    <div class="detail-tab-content" data-content="hllstats">${hllstatsHtml}</div>
    <div class="detail-tab-content" data-content="combat">${combatHtml}</div>
    <div class="detail-tab-content" data-content="support">${supportHtml}</div>
    <div class="detail-tab-content" data-content="roles">${roleHtml || '<div class="empty">Noch keine Rollendaten synchronisiert.</div>'}</div>
    <div class="detail-tab-content" data-content="maps">${mapHtml || '<div class="empty">Noch keine Mapdaten synchronisiert.</div>'}</div>
    <div class="detail-tab-content" data-content="history">${trendHtml}${matchHtml || '<div class="empty">Noch keine Match-Historie synchronisiert.</div>'}</div>
  </div>`;
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

  const unifiedPlayer = unifiedFor(id);
  $("#players").innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>${esc(username)}</h2>
          <div class="muted">Spielerprofil</div>
        </div>
        <button class="refresh" id="player-back">← Zurück zur Suche</button>
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

  $("#player-back").addEventListener("click", renderPlayers);
  document.querySelectorAll('[data-detail-tabs] .detail-tab').forEach(btn => btn.addEventListener('click', () => {
    const root = btn.closest('[data-detail-tabs]');
    root.querySelectorAll('.detail-tab').forEach(x => x.classList.remove('active'));
    root.querySelectorAll('.detail-tab-content').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    root.querySelector(`[data-content="${btn.dataset.tab}"]`)?.classList.add('active');
  }));
}

const RAW_BASE = "https://raw.githubusercontent.com/skrane1/hll-stats/main/";

async function fetchJsonWithFallback(file, fallback = null) {
  // GitHub Pages can serve the repository copy from its own cache.
  // The raw repository is the authoritative live data source.
  try {
    const r = await fetch(`${RAW_BASE}${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  try {
    const r = await fetch(`./${file}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) return await r.json();
  } catch (_) {}

  return fallback;
}

async function loadData() {
  try {
    const [s,h,ho,c,u] = await Promise.all([
      fetchJsonWithFallback("stats.json", {}),
      fetchJsonWithFallback("history.json", {}),
      fetchJsonWithFallback("hall-of-mages.json", []),
      fetchJsonWithFallback("challenges.json", []),
      fetchJsonWithFallback("unified-stats.json", {updatedAt:null,players:{}})
    ]);
    stats=s||{}; history=h||{}; hall=Array.isArray(ho)?ho:[]; challenges=Array.isArray(c)?c:[]; unified=u&&typeof u==="object"?u:{updatedAt:null,players:{}};
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
