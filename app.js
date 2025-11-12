/* app.js - full functionality for Bluff Masters
   Save this as app.js and keep it alongside index.html, bluffmasters.png, ding.mp3 (optional).
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

/* ---------- Firebase (best-effort; will not break if blocked) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBdAIdEDwfoalevfadgixPTLIoLoEqi8kc",
  authDomain: "bluff-tracker-7542e.firebaseapp.com",
  projectId: "bluff-tracker-7542e",
  storageBucket: "bluff-tracker-7542e.firebasestorage.app",
  messagingSenderId: "280965687037",
  appId: "1:280965687037:web:be0b05da36ef653ab68094"
};

let db = null;
let gamesRef = null;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  gamesRef = collection(db, "games");
  console.log("Firebase initialized");
} catch (e) {
  console.warn("Firebase init failed (ok to ignore in local-only deployments)", e);
}

/* ---------- App model & storage ---------- */
const STORAGE_KEY = "bluff_tracker_v1";
const TEAM_LIST = [
  "Bibin & Zach",
  "Bimal & Annu",
  "Bibin & Annu",
  "Zach & Daddy",
  "Bibin & Bimal",
  "Zach & Rikku",
  "Bibin & Daddy"
];

let gameData = { games: [] }; // each game: { winner, loser, seriesId, seriesTarget, seriesStartedAt, time }

/* Load from localStorage on init */
(function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) gameData = JSON.parse(raw);
  } catch (e) {
    console.warn("Local load failed", e);
  }
})();

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameData));
  } catch (e) {
    console.warn("Local save failed", e);
  }
}

/* ---------- Aggregation ---------- */
/* Build series map and team stats from gameData */
function computeAggregates() {
  const seriesMap = {}; // id -> { id, target, games:[], wins:{team:count}, finished, winner, startedAt }
  const teamStats = {}; // team -> { wins, losses, seriesWon, consecutiveSeries }
  (gameData.games || []).forEach((g) => {
    const sid = g.seriesId || "series_" + (g.seriesStartedAt || g.time || Date.now());
    if (!seriesMap[sid])
      seriesMap[sid] = {
        id: sid,
        target: g.seriesTarget || 5,
        games: [],
        wins: {},
        finished: false,
        winner: null,
        startedAt: g.seriesStartedAt || g.time || new Date().toISOString()
      };
    const s = seriesMap[sid];
    s.games.push(g);
    s.wins[g.winner] = (s.wins[g.winner] || 0) + 1;
    if (s.wins[g.winner] >= s.target && !s.finished) {
      s.finished = true;
      s.winner = g.winner;
    }

    if (!teamStats[g.winner]) teamStats[g.winner] = { wins: 0, losses: 0, seriesWon: 0, consecutiveSeries: 0 };
    if (!teamStats[g.loser]) teamStats[g.loser] = { wins: 0, losses: 0, seriesWon: 0, consecutiveSeries: 0 };
    teamStats[g.winner].wins++;
    teamStats[g.loser].losses++;
  });

  // compute finished series and streaks
  const finishedSeries = Object.values(seriesMap).filter((s) => s.finished).sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const streaks = {};
  finishedSeries.forEach((s) => {
    const w = s.winner;
    if (!teamStats[w]) teamStats[w] = { wins: 0, losses: 0, seriesWon: 0, consecutiveSeries: 0 };
    teamStats[w].seriesWon = (teamStats[w].seriesWon || 0) + 1;
    streaks[w] = (streaks[w] || 0) + 1;
    // reset others
    Object.keys(streaks).forEach((t) => { if (t !== w) streaks[t] = 0; });
    teamStats[w].consecutiveSeries = streaks[w];
  });

  const activeSeries = Object.values(seriesMap).filter((s) => !s.finished).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const completedByTarget = { 5: 0, 10: 0 };
  finishedSeries.forEach((s) => {
    if (s.target === 5) completedByTarget[5] = (completedByTarget[5] || 0) + 1;
    if (s.target === 10) completedByTarget[10] = (completedByTarget[10] || 0) + 1;
  });

  return { seriesMap, teamStats, activeSeries, completedSeriesCount: finishedSeries.length, completedByTarget, finishedSeries };
}

/* ---------- UI rendering ---------- */

function renderHomeActiveList() {
  const { activeSeries } = computeAggregates();
  const container = document.getElementById("activeList");
  container.innerHTML = "";
  if (!activeSeries || activeSeries.length === 0) {
    document.getElementById("noActive").style.display = "block";
    return;
  }
  document.getElementById("noActive").style.display = "none";

  activeSeries.forEach((s) => {
    // get pair of team names from games if possible, else fallback to TEAM_LIST
    const teams = Array.from(new Set(s.games.flatMap((g) => [g.winner, g.loser]))).slice(0, 2);
    const t1 = teams[0] || TEAM_LIST[0];
    const t2 = teams[1] || TEAM_LIST[1];
    const s1 = s.wins[t1] || 0;
    const s2 = s.wins[t2] || 0;

    const el = document.createElement("div");
    el.className = "series-card" + ((s1 !== s2) ? " lead" : "");
    el.style.position = "relative";
    el.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center">
        <div style="min-width:220px">
          <div style="font-weight:700">${escapeHtml(t1)} <span style="opacity:.7">vs</span> ${escapeHtml(t2)}</div>
          <div style="font-size:.9rem;color:#9fb7bf">First to ${s.target} • started ${new Date(s.startedAt).toLocaleString()}</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-size:1.1rem;font-weight:800">${s1} — ${s2}</div>
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
            <button class="neu-btn" onclick="resumeSeries('${s.id}')">➕ Add</button>
            <button class="neu-btn secondary" onclick="viewSeriesDetails('${s.id}')">Details</button>
          </div>
        </div>
      </div>
    `;

    // trash icon (top-right)
    const trash = document.createElement("div");
    trash.className = "trash";
    trash.title = "Delete series";
    trash.innerHTML = "🗑️";
    trash.onclick = (ev) => {
      ev.stopPropagation();
      deleteSeriesConfirm(s.id);
    };
    el.appendChild(trash);

    container.appendChild(el);
  });
}

/* Update champion and stats UI (statistics dashboard is separate) */
function updateStatsUI() {
  const { seriesMap, teamStats, activeSeries, completedByTarget, completedSeriesCount } = computeAggregates();
  // update small stat boxes on header (if present)
  const totalGamesEl = document.getElementById("totalGames");
  if (totalGamesEl) totalGamesEl.textContent = (gameData.games || []).length;
  const totalSeriesEl = document.getElementById("totalSeries");
  if (totalSeriesEl) totalSeriesEl.textContent = completedSeriesCount;

  // champion (highest wins)
  const teams = Object.keys(teamStats || {}).sort((a, b) => (teamStats[b].wins || 0) - (teamStats[a].wins || 0));
  const champion = teams.length ? teams[0] : "—";
  const champText = document.getElementById("championText");
  if (champText) champText.textContent = champion;

  // render stats page if visible
  const statsSection = document.getElementById("statsSection");
  if (!statsSection) return;
  // build dashboard content (visual)
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:700">Overall Statistics (Shared)</div>
      <div>
        <button class="neu-btn" onclick="shareToWhatsApp()">📤 Share to WhatsApp</button>
        <button class="neu-btn secondary" onclick="goHome()">← Back</button>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px;background:linear-gradient(135deg,#3affd0,#20a56e);padding:14px;border-radius:10px;text-align:center;font-weight:700;color:#07130f">
        <div>Total Games</div><div id="totalGames_small">${(gameData.games||[]).length}</div>
      </div>
      <div style="flex:1;min-width:200px;background:linear-gradient(135deg,#6ec0ff,#4a7bd6);padding:14px;border-radius:10px;text-align:center;font-weight:700;color:#07130f">
        <div>Total Series</div><div id="totalSeries_small">${completedSeriesCount}</div>
      </div>
    </div>
  `;

  // summary breakdown
  html += `<div style="margin-top:14px"><b>Completed Series Breakdown</b>
    <div style="color:#9fb7bf;margin-top:6px">5 Series → ${completedByTarget[5]||0} completed</div>
    <div style="color:#9fb7bf;margin-top:3px">10 Series → ${completedByTarget[10]||0} completed</div>
  </div>`;

  // top teams summary
  const sortedTeams = Object.keys(teamStats || {}).sort((a, b) => (teamStats[b].wins || 0) - (teamStats[a].wins || 0));
  html += `<div style="margin-top:14px"><h3>Top Teams</h3>`;
  if (sortedTeams.length === 0) html += `<div style="color:#cfd8e3">No teams yet</div>`;
  sortedTeams.forEach((team, i) => {
    const s = teamStats[team];
    const w = s.wins || 0, l = s.losses || 0, sw = s.seriesWon || 0, cs = s.consecutiveSeries || 0;
    const total = w + l; const wp = total ? Math.round((w / total) * 100) : 0;
    html += `
      <div style="background:rgba(255,255,255,0.02);padding:12px;border-radius:10px;margin-top:8px">
        <div style="font-weight:700">${escapeHtml(team)} ${i===0?'<span style="color:#ffd36d">👑</span>':''}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Wins<br><b>${w}</b></div>
          <div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Losses<br><b>${l}</b></div>
          <div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Series<br><b>${sw}</b></div>
          <div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Win %<br><b>${wp}%</b></div>
        </div>
      </div>`;
  });
  html += `</div>`;

  // game history
  html += `<h3 style="margin-top:14px">Game History</h3>`;
  const hist = (gameData.games || []).slice().reverse().map(g => {
    return `<div style="background:rgba(255,255,255,0.02);padding:10px;margin:8px 0;border-radius:8px">
      <small style="opacity:0.75">${new Date(g.time).toLocaleString()}</small><br><b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b> <small style="opacity:.7">[Series:${g.seriesId}, target:${g.seriesTarget||5}]</small>
    </div>`;
  }).join("");
  html += hist || '<div style="opacity:.75">No games yet</div>';

  // small actions
  html += `<div style="margin-top:12px"><span style="cursor:pointer;color:#dff6f2;text-decoration:underline" onclick="deleteLastGame()">Delete last game</span> &nbsp;•&nbsp;
    <span style="cursor:pointer;color:#dff6f2;text-decoration:underline" onclick="resetStats()">Reset all statistics</span></div>`;

  statsSection.innerHTML = html;
}

/* ---------- Series creation / resume / details ---------- */

/* Start a new series (asks winner and loser for first match) */
window.startNewSeries = function () {
  const teamOptions = TEAM_LIST.map(t => `<option>${escapeHtml(t)}</option>`).join("");
  const html = `
    <div style="text-align:left">
      <label>Series target (first to N wins):</label>
      <select id="modalSeriesTarget" style="width:100%;padding:8px;margin-top:6px">
        <option value="5">First to 5</option>
        <option value="10">First to 10</option>
      </select>

      <label style="margin-top:10px;display:block">Winner team (first match):</label>
      <select id="modalWinner" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>

      <label style="margin-top:10px;display:block">Loser team (first match):</label>
      <select id="modalLoser" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
    </div>
  `;
  showModal("Start New Series", html, () => {
    const target = parseInt(document.getElementById("modalSeriesTarget").value, 10) || 5;
    const winner = document.getElementById("modalWinner").value.trim();
    const loser = document.getElementById("modalLoser").value.trim();
    if (!winner || !loser) { alert("Please pick both teams"); return; }
    if (winner === loser) { alert("Winner and loser cannot be same"); return; }
    const sid = "series_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
    const rec = { winner, loser, seriesId: sid, seriesTarget: target, seriesStartedAt: new Date().toISOString(), time: new Date().toISOString() };
    gameData.games.push(rec);
    saveLocal();
    cloudSaveGame(rec);
    afterLocalSave(rec);
  }, "Start Series");
};

/* Resume an active series: ask winner only, loser auto-detected */
window.resumeSeries = function (seriesId) {
  const { seriesMap } = computeAggregates();
  const s = seriesMap[seriesId];
  if (!s) return alert("Series not found");
  // find present teams in series
  const teams = Array.from(new Set(s.games.flatMap(g => [g.winner, g.loser])));
  const opts = (teams.length ? teams : TEAM_LIST).map(t => `<option>${escapeHtml(t)}</option>`).join("");
  const html = `
    <div>
      <div style="margin-top:6px">Select Winner:</div>
      <select id="modalWinnerSelect" style="width:100%;padding:8px;margin-top:6px">${opts}</select>
      <div style="margin-top:10px;color:#9fb7bf;font-size:0.9rem">Loser will be set automatically to the other team in this series.</div>
    </div>
  `;
  showModal("Add Match", html, () => {
    const winner = document.getElementById("modalWinnerSelect").value;
    if (!winner) { alert("Choose winner"); return; }
    // determine loser = other team in the series
    const pair = Array.from(new Set(s.games.flatMap(g => [g.winner, g.loser]))).filter(t => t !== winner);
    let loser = pair.length ? pair[0] : (TEAM_LIST.find(t => t !== winner) || "Unknown");
    if (winner === loser) { alert("Winner cannot equal loser"); return; }
    const rec = { winner, loser, seriesId: s.id, seriesTarget: s.target, seriesStartedAt: s.startedAt, time: new Date().toISOString() };
    gameData.games.push(rec);
    saveLocal();
    cloudSaveGame(rec);
    afterLocalSave(rec);
  }, "Save");
};

/* View series details */
window.viewSeriesDetails = function (seriesId) {
  const games = (gameData.games || []).filter(g => g.seriesId === seriesId).sort((a, b) => new Date(a.time) - new Date(b.time));
  const rows = games.map((g, i) => `<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.03)">${i + 1}. ${new Date(g.time).toLocaleString()} — <b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b></div>`).join('');
  showModal("Series Details", `<div style="max-height:340px;overflow:auto">${rows || '<i>No games yet</i>'}</div>`, () => { }, "Close");
};

/* ---------- After save UI + messages ---------- */

function afterLocalSave(rec) {
  renderHomeActiveList();
  updateStatsUI();
  const msg = buildSeriesProgressMessage(rec);
  showLargeConfirm("✅ Game Saved", msg, () => { showStats(); });
  maybeShowGraphics(rec);
}

/* Build user-facing series progress message */
function buildSeriesProgressMessage(rec) {
  const { seriesMap, teamStats } = computeAggregates();
  const s = seriesMap[rec.seriesId];
  const winner = rec.winner, loser = rec.loser;
  const winnerWins = s.wins[winner] || 0;
  const loserWins = s.wins[loser] || 0;
  const remaining = Math.max(0, s.target - winnerWins);

  if (winnerWins >= s.target) {
    const scoreLine = `${winnerWins}-${loserWins}`;
    if (loserWins === 0) {
      return `<div class="confirm-message"><b>FLAWLESS VICTORY! ${scoreLine}!</b><br>${escapeHtml(winner)} sweeps the series!</div><div class="small-muted">Saved locally and syncing to cloud.</div>`;
    }
    const streak = (teamStats[winner] && teamStats[winner].consecutiveSeries) || 1;
    if (streak >= 3) return `<div class="confirm-message"><b>🔥 HAT-TRICK! ${escapeHtml(winner)} wins again — ${scoreLine}!</b><br>Incredible streak: ${streak} consecutive series!</div>`;
    if (streak === 2) return `<div class="confirm-message"><b>🏆 Series Won — ${scoreLine}</b><br>Yaay.. Another fabulous series. ${escapeHtml(winner)} won ${streak} series in a row! All the best for a Hat-Trick!</div>`;
    return `<div class="confirm-message"><b>🏆 Series Won — ${scoreLine}</b><br>${escapeHtml(winner)} wins this series!</div>`;
  } else {
    return `<div class="confirm-message"><b>${escapeHtml(winner)} beat ${escapeHtml(loser)}</b><br>${escapeHtml(winner)} needs <b>${remaining}</b> more win${remaining === 1 ? '' : 's'} to reach ${s.target} wins in this series.</div><div class="small-muted">Saved locally and syncing to cloud.</div>`;
  }
}

/* ---------- Graphics: confetti & fireworks ---------- */

function simpleConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.left = 0;
  canvas.style.top = 0;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = 99997;
  canvas.style.pointerEvents = "none";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize(); window.addEventListener("resize", resize);
  const colors = ['#ffdd57', '#ff6b6b', '#44ff8a', '#6ec0ff', '#ff9ce3'];
  const p = [];
  for (let i = 0; i < 80; i++) {
    p.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      w: 6 + Math.random() * 10,
      h: 6 + Math.random() * 10,
      vx: -2 + Math.random() * 4,
      vy: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360, vr: -5 + Math.random() * 10
    });
  }
  let last = performance.now();
  function frame(t) {
    const dt = (t - last) / 16.67; last = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    p.forEach(a => {
      a.x += a.vx * dt; a.y += a.vy * dt; a.vy += 0.05 * dt; a.rot += a.vr * dt;
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot * Math.PI / 180);
      ctx.fillStyle = a.color; ctx.fillRect(-a.w / 2, -a.h / 2, a.w, a.h); ctx.restore();
    });
    if (p.every(a => a.y > canvas.height + 50)) { canvas.remove(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* fireworks for flawless wins */
function startFireworks(duration = 2800) {
  const canvas = document.getElementById("fireworks");
  if (!canvas) {
    // create a fallback canvas
    const c = document.createElement("canvas"); c.id = "fireworks"; c.className = "fireworks-canvas";
    document.body.appendChild(c);
  }
  const c = document.getElementById("fireworks");
  c.style.display = "block";
  const ctx = c.getContext("2d");
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  resize(); window.addEventListener("resize", resize);
  const fireworks = [];
  function spawn() {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height * 0.6;
    const count = 30 + Math.round(Math.random() * 40);
    const hue = Math.round(Math.random() * 360);
    for (let i = 0; i < count; i++) {
      const speed = Math.random() * 4 + 1;
      const angle = Math.random() * Math.PI * 2;
      fireworks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 60 + Math.round(Math.random() * 40), color: `hsl(${hue} ${60 + Math.round(Math.random() * 40)}% ${40 + Math.round(Math.random() * 40)}%)` });
    }
  }
  let last = performance.now();
  function frame(t) {
    const dt = (t - last) / 16.67; last = t;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const p = fireworks[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.06 * dt; p.life--;
      ctx.beginPath(); ctx.fillStyle = p.color; ctx.arc(p.x, p.y, Math.max(0, Math.min(3, p.life / 10)), 0, Math.PI * 2); ctx.fill();
      if (p.life <= 0) fireworks.splice(i, 1);
    }
    requestAnimationFrame(frame);
  }
  const sp = setInterval(spawn, 250);
  requestAnimationFrame(frame);
  setTimeout(() => { clearInterval(sp); setTimeout(() => { c.style.display = "none"; }, 1200); }, duration);
}

function maybeShowGraphics(rec) {
  const { seriesMap } = computeAggregates();
  const s = seriesMap[rec.seriesId];
  const ww = s.wins[rec.winner] || 0;
  const lw = s.wins[rec.loser] || 0;
  if (ww >= s.target && lw === 0) startFireworks(3200);
  else simpleConfetti();
}

/* ---------- Cloud write (non-blocking) ---------- */
async function cloudSaveGame(rec) {
  if (!gamesRef) return;
  try {
    // add to Firestore collection - guard with small timeout
    await Promise.race([
  addDoc(gamesRef, { ...rec, secret: "zachariahrenji" }),
  new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000))
]);
console.log("Cloud write OK");
  } catch (e) {
    console.warn("Cloud save failed", e);
  }
}

/* ---------- Delete last / reset ---------- */
window.deleteLastGame = function () {
  if (!(gameData.games && gameData.games.length)) { alert("No games to delete."); return; }
  const pw = prompt("Enter password to delete last game:");
  if (pw !== "zachariahrenji") { alert("❌ Incorrect password"); return; }
  if (!confirm("Delete the most recent game permanently?")) return;
  const g = gameData.games.pop();
  // adjust team stats cleanup handled by aggregation
  saveLocal();
  renderHomeActiveList(); updateStatsUI();
  showLargeConfirm("✅ Last Game Deleted", "Last game removed from history.", () => { showStats(); });
};

window.resetStats = function () {
  const pw = prompt("Enter password to reset all data:");
  if (pw !== "zachariahrenji") { alert("❌ Incorrect password"); return; }
  if (!confirm("⚠️ This will permanently delete ALL stats. Continue?")) return;
  gameData = { games: [] };
  saveLocal();
  renderHomeActiveList(); updateStatsUI();
  showLargeConfirm("✅ Reset Complete", "All statistics erased locally.", () => { goHome(); });
};

/* ---------- Delete series (trash icon) ---------- */
function deleteSeriesConfirm(seriesId) {
  const pw = prompt("Enter password to delete this series and its games:");
  if (pw !== "zachariahrenji") { alert("❌ Incorrect password"); return; }
  if (!confirm("Delete entire series and its game history?")) return;
  // remove games for that series
  // fade out UI card nicely if present
  const container = document.getElementById("activeList");
  // find a card that contains this seriesId (we encode seriesId in details text earlier)
  const cards = container.querySelectorAll(".series-card");
  cards.forEach((c) => {
    if (c.innerHTML.indexOf(seriesId) !== -1) {
      c.style.transition = "all .45s ease";
      c.style.opacity = "0";
      c.style.transform = "scale(.98)";
      setTimeout(() => {
        // final remove
        gameData.games = gameData.games.filter(g => g.seriesId !== seriesId);
        saveLocal();
        renderHomeActiveList(); updateStatsUI();
      }, 480);
    }
  });
  // if not found visually, still remove server-side
  gameData.games = gameData.games.filter(g => g.seriesId !== seriesId);
  saveLocal();
  renderHomeActiveList(); updateStatsUI();
}
window.deleteSeriesConfirm = deleteSeriesConfirm;

/* ---------- Modal helpers ---------- */
function showModal(title, html, onOk, okText = "OK") {
  closeModal();
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "confirm-box";
  box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${title}</div><div style="text-align:left">${html}</div>`;
  const row = document.createElement("div"); row.style.marginTop = "12px"; row.style.display = "flex"; row.style.justifyContent = "center"; row.style.gap = "8px";
  const ok = document.createElement("button"); ok.className = "neu-btn"; ok.innerText = okText; ok.onclick = () => { onOk && onOk(); closeModal(); };
  const cancel = document.createElement("button"); cancel.className = "neu-btn secondary"; cancel.innerText = "Cancel"; cancel.onclick = closeModal;
  row.appendChild(ok); row.appendChild(cancel); box.appendChild(row); overlay.appendChild(box); document.getElementById("modalContainer").appendChild(overlay);
}

function showLargeConfirm(title, html, onOk) {
  closeModal();
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "confirm-box";
  box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${title}</div><div style="text-align:left">${html}</div>`;
  const ok = document.createElement("button"); ok.className = "neu-btn"; ok.innerText = "OK"; ok.onclick = () => { closeModal(); onOk && onOk(); };
  box.appendChild(ok); overlay.appendChild(box); document.getElementById("modalContainer").appendChild(overlay);
}

function closeModal() { const mc = document.getElementById("modalContainer"); if (mc) mc.innerHTML = ""; }

/* ---------- Firestore snapshot: replace local with cloud canonical (best-effort) ---------- */
if (gamesRef) {
  try {
    const q = query(gamesRef, orderBy("time"));
    onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => d.data()).sort((a, b) => new Date(a.time) - new Date(b.time));
      if (docs && docs.length > 0) {
        gameData.games = docs;
        saveLocal();
        renderHomeActiveList(); updateStatsUI();
        console.log("Synced from cloud:", docs.length);
      }
    }, err => { console.warn("onSnapshot error", err); });
  } catch (e) { console.warn("onSnapshot failed", e); }
}

/* ---------- Share to WhatsApp (format requested) ---------- */
window.shareToWhatsApp = function () {
  const { seriesMap, teamStats } = computeAggregates();
  const totalGames = (gameData.games || []).length;
  const completed = Object.values(seriesMap).filter(s => s.finished);
  const completedByTarget = { 5: 0, 10: 0 };
  completed.forEach(s => { if (s.target === 5) completedByTarget[5]++; if (s.target === 10) completedByTarget[10]++; });

  const teamsByWins = Object.keys(teamStats || {}).sort((a, b) => (teamStats[b].wins || 0) - (teamStats[a].wins || 0));
  const topWins = teamsByWins.slice(0, 2).map((t, i) => `${i + 1}️⃣ ${t} — ${teamStats[t].wins || 0} Games | ${teamStats[t].seriesWon || 0} Series`);
  const teamsByLosses = Object.keys(teamStats || {}).sort((a, b) => (teamStats[b].losses || 0) - (teamStats[a].losses || 0));
  const topLosses = teamsByLosses.slice(0, 2).map((t, i) => `${i + 1}️⃣ ${t} — ${teamStats[t].losses || 0} Games | ${teamStats[t].seriesWon || 0} Series`);
  const champion = teamsByWins.length ? teamsByWins[0] : "—";

  // Best games: include flawless (loser 0) as well as top margin
  let bestMargin = -1;
  const completedDetails = completed.map(s => {
    const tally = {};
    s.games.forEach(g => { tally[g.winner] = (tally[g.winner] || 0) + 1; });
    const winnerTeam = s.winner;
    const winnerWins = tally[winnerTeam] || 0;
    const opponents = Array.from(new Set(s.games.flatMap(g => [g.winner, g.loser]))).filter(x => x !== winnerTeam);
    const opponentMaxWins = opponents.length ? Math.max(...opponents.map(o => tally[o] || 0)) : 0;
    const margin = winnerWins - opponentMaxWins;
    if (margin > bestMargin) bestMargin = margin;
    return { series: s, winner: winnerTeam, winnerWins, opponentMaxWins, opponents };
  });

  const flawless = completedDetails.filter(d => d.opponentMaxWins === 0).map(d => ({ winner: d.winner, score: `${d.winnerWins}-${d.opponentMaxWins}`, opponents: d.opponents }));
  const bestMarginList = completedDetails.filter(d => (d.winnerWins - d.opponentMaxWins) === bestMargin).map(d => ({ winner: d.winner, score: `${d.winnerWins}-${d.opponentMaxWins}`, opponents: d.opponents }));

  const finalBest = [];
  const seen = new Set();
  flawless.forEach(it => { const key = `${it.winner}|${it.score}|${it.opponents.join(',')}`; if (!seen.has(key)) { finalBest.push(it); seen.add(key); } });
  bestMarginList.forEach(it => { const key = `${it.winner}|${it.score}|${it.opponents.join(',')}`; if (!seen.has(key)) { finalBest.push(it); seen.add(key); } });

  let msg = `🎴 Bluff Masters — Overall Stats\n\nTotal Games: ${totalGames}\nTotal Series:\n  5 Series → ${completedByTarget[5] || 0} completed\n  10 Series → ${completedByTarget[10] || 0} completed\n\n🏆 Total Wins (Top 2):\n`;
  msg += (topWins.length ? topWins.join('\n') : 'None\n') + '\n\n';
  msg += '💔 Total Losses (Top 2):\n' + (topLosses.length ? topLosses.join('\n') : 'None\n') + '\n\n';
  msg += `👑 Current Champions: ${champion}\n\n`;
  if (finalBest.length) {
    msg += '🔥 Best Game(s):\n';
    finalBest.forEach(it => { msg += `${it.winner} — ${it.score} vs ${it.opponents.join(', ')}\n`; });
  } else {
    msg += '🔥 Best Game(s): None\n';
  }

  const url = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg);
  window.open(url, "_blank");
};

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Particles in champion banner (aura drift) ---------- */
function startParticles() {
  const wrap = document.getElementById("champParticles");
  if (!wrap) return;
  wrap.innerHTML = "";
  const count = 14;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    const size = 3 + Math.random() * 8;
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.borderRadius = "50%";
    el.style.left = (10 + Math.random() * (wrap.clientWidth || 320)) + "px";
    el.style.top = (10 + Math.random() * 40) + "px";
    el.style.background = "rgba(255,200,80," + (0.2 + Math.random() * 0.6) + ")";
    el.style.filter = "blur(1px)";
    el.style.transform = "translateY(0)";
    el.style.opacity = 0.95;
    el.style.transition = "transform 6s linear, opacity 6s linear";
    wrap.appendChild(el);
    // start drift shortly after
    setTimeout(() => {
      el.style.transform = `translateY(-60px) translateX(${Math.random() * 80 - 40}px)`;
      el.style.opacity = "0";
    }, 80 + Math.random() * 400);
  }
  setTimeout(() => { startParticles(); }, 4200);
}
startParticles();

/* ---------- Navigation helpers ---------- */
window.goHome = function () {
  document.getElementById("statsSection").style.display = "none";
  renderHomeActiveList(); updateStatsUI();
  const hero = document.querySelector(".hero");
  if (hero) hero.scrollIntoView({ behavior: "smooth" });
};

window.showStats = function () {
  document.getElementById("statsSection").style.display = "block";
  updateStatsUI();
  const statsSection = document.getElementById("statsSection");
  if (statsSection) statsSection.scrollIntoView({ behavior: "smooth" });
};

/* initial render */
renderHomeActiveList();
updateStatsUI();
console.log("✅ Bluff Masters app.js loaded. Local data ready; Firebase sync (if available) runs in background.");

