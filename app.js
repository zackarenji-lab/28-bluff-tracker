/* app.js - Final version:
   - Two-team series only
   - Detailed Add Game modal (showing current score & games left)
   - Full stats fixed
   - Local + Firestore sync, deletes, patching old docs
   - Console logs enabled
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  getDocs, deleteDoc, limit, where, updateDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

/* ========== CONFIG ========== */
const FIREBASE_CONF = {
  apiKey: "AIzaSyBdAIdEDwfoalevfadgixPTLIoLoEqi8kc",
  authDomain: "bluff-tracker-7542e.firebaseapp.com",
  projectId: "bluff-tracker-7542e",
  storageBucket: "bluff-tracker-7542e.appspot.com",
  messagingSenderId: "280965687037",
  appId: "1:280965687037:web:be0b05da36ef653ab68094"
};
const SECRET_KEY = "zachariahrenji";
const STORAGE_KEY = "bluff_tracker_v1";

/* Edit this list if you change team names in future */
const TEAM_LIST = [
  "Bibin & Zach","Bimal & Annu","Bibin & Annu","Zach & Daddy","Bibin & Bimal","Zach & Rikku","Bibin & Daddy"
];

/* ========== FIRESTORE INIT (best-effort) ========== */
let db = null, gamesRef = null;
try {
  const app = initializeApp(FIREBASE_CONF);
  db = getFirestore(app);
  gamesRef = collection(db, "games");
  console.log("Firebase initialized");
} catch (e) {
  console.warn("Firebase init failed — running in local-only mode", e);
}

/* ========== LOCAL STATE ========== */
let gameData = { games: [] }; // shape: [{ winner, loser, seriesId, seriesTarget, seriesStartedAt, time, secret }]
(function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) gameData = JSON.parse(raw);
    console.log("Loaded local data:", (gameData.games || []).length, "games");
  } catch (e) { console.warn("Local load failed", e); }
})();
function saveLocal(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(gameData)); } catch(e){ console.warn("Local save failed", e); } }

/* ========== HELPERS ========== */
function uid(prefix="s"){ return prefix + "_" + Date.now() + "_" + Math.floor(Math.random()*9000+1000); }
function escapeHtml(s){ if(!s) return ""; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

/* Ensure seriesId & seriesStartedAt exist for local games */
function ensureSeriesIds() {
  let changed = false;
  for (const g of (gameData.games||[])) {
    if(!g.seriesId){ g.seriesId = uid("series"); changed = true; }
    if(!g.seriesStartedAt) g.seriesStartedAt = g.time || new Date().toISOString();
  }
  if(changed) { saveLocal(); console.log("Backfilled series metadata for local games"); }
}

/* ========== AGGREGATION: compute series and team stats ========== */
function computeAggregates() {
  ensureSeriesIds();
  const seriesMap = {}; // seriesId => { id,target,games:[],wins:{team:count},finished:boolean,winner:null,startedAt }
  const teamStats = {};  // team => {wins,losses,seriesWon,consecutiveSeries}

  (gameData.games||[]).forEach(g=>{
    const sid = g.seriesId;
    if(!seriesMap[sid]) seriesMap[sid] = { id: sid, target: g.seriesTarget || 5, games: [], wins: {}, finished: false, winner: null, startedAt: g.seriesStartedAt || g.time || new Date().toISOString() };
    const s = seriesMap[sid];
    s.games.push(g);
    s.wins[g.winner] = (s.wins[g.winner] || 0) + 1;
    if(!teamStats[g.winner]) teamStats[g.winner] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    if(!teamStats[g.loser]) teamStats[g.loser] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    teamStats[g.winner].wins++;
    teamStats[g.loser].losses++;
  });

  // Detect finished series
  Object.values(seriesMap).forEach(s=>{
    Object.keys(s.wins).forEach(t=>{
      if(s.wins[t] >= s.target && !s.finished){
        s.finished = true;
        s.winner = t;
      }
    });
  });

  // compute seriesWon and streaks using chronological order
  const finishedSeries = Object.values(seriesMap).filter(s=>s.finished).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  const streaks = {};
  finishedSeries.forEach(s=>{
    const w = s.winner;
    if(!teamStats[w]) teamStats[w] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    teamStats[w].seriesWon = (teamStats[w].seriesWon || 0) + 1;
    streaks[w] = (streaks[w] || 0) + 1;
    Object.keys(streaks).forEach(t=>{ if(t !== w) streaks[t] = 0; });
    teamStats[w].consecutiveSeries = streaks[w];
  });

  const activeSeries = Object.values(seriesMap).filter(s=>!s.finished).sort((a,b)=> new Date(b.startedAt) - new Date(a.startedAt));
  const completedByTarget = {5:0,10:0};
  finishedSeries.forEach(s=>{ if(s.target === 5) completedByTarget[5]++; if(s.target === 10) completedByTarget[10]++; });

  return { seriesMap, teamStats, activeSeries, finishedSeries, completedByTarget };
}

/* ========== UI: render home active series list (with trash after score) ========== */
function renderHomeActiveList(){
  const { seriesMap, activeSeries } = computeAggregates();
  const container = document.getElementById("activeList");
  if(!container) return;
  container.innerHTML = "";
  document.getElementById("noActive").style.display = (activeSeries.length === 0) ? "block" : "none";

  activeSeries.forEach(s=>{
    // ensure two-team series: pick the two most common names in games or fall back to TEAM_LIST
    const names = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).slice(0,2);
    const teamA = names[0] || TEAM_LIST[0];
    const teamB = names[1] || TEAM_LIST[1];
    const scoreA = s.wins[teamA] || 0;
    const scoreB = s.wins[teamB] || 0;

    const card = document.createElement("div");
    card.className = "series-card";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700">${escapeHtml(teamA)} <span style="opacity:.6">vs</span> ${escapeHtml(teamB)}</div>
          <div style="font-size:0.9rem;color:#9fb7bf">First to ${s.target} • started ${new Date(s.startedAt).toLocaleString()}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-weight:800;font-size:1.05rem">${scoreA} — ${scoreB}</div>
          <button class="neu-btn" onclick="openAddGame('${s.id}')">➕ Add</button>
          <button class="neu-btn secondary" onclick="viewSeriesDetails('${s.id}')">Details</button>
          <button class="trash" title="Delete series" onclick="deleteSeriesConfirm('${s.id}')">🗑️</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ========== Modal helpers ========== */
function closeModal(){ const mc = document.getElementById("modalContainer"); if(mc) mc.innerHTML = ""; }
function showModalBox(title, innerHtml, okText="OK", onOk){
  closeModal();
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "confirm-box";
  box.innerHTML = `<h3 style="margin-top:0">${title}</h3><div>${innerHtml}</div>`;
  const row = document.createElement("div"); row.style.marginTop = "12px"; row.style.display="flex"; row.style.justifyContent="center"; row.style.gap="8px";
  const ok = document.createElement("button"); ok.className="neu-btn"; ok.innerText = okText; ok.onclick = ()=>{ onOk && onOk(); closeModal(); };
  const cancel = document.createElement("button"); cancel.className="neu-btn secondary"; cancel.innerText="Cancel"; cancel.onclick = closeModal;
  row.appendChild(ok); row.appendChild(cancel); box.appendChild(row); overlay.appendChild(box);
  document.getElementById("modalContainer").appendChild(overlay);
}
function showInfoBox(title, innerHtml, okText="OK", onOk){
  closeModal();
  const overlay = document.createElement("div"); overlay.className = "overlay";
  const box = document.createElement("div"); box.className = "confirm-box";
  box.innerHTML = `<h3 style="margin-top:0">${title}</h3><div>${innerHtml}</div>`;
  const ok = document.createElement("button"); ok.className="neu-btn"; ok.innerText = okText; ok.onclick = ()=>{ onOk && onOk(); closeModal(); };
  box.appendChild(ok); overlay.appendChild(box);
  document.getElementById("modalContainer").appendChild(overlay);
}

/* ========== Start New Series (detailed) ========== */
window.startNewSeries = function(){
  const teamOptions = TEAM_LIST.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  const inner = `
    <div>
      <label>Series target</label>
      <select id="modalSeriesTarget" style="width:100%;padding:8px;margin-top:6px">
        <option value="5">First to 5</option>
        <option value="10">First to 10</option>
      </select>
      <label style="margin-top:10px;display:block">Team A</label>
      <select id="modalTeamA" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
      <label style="margin-top:10px;display:block">Team B</label>
      <select id="modalTeamB" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
    </div>
  `;
  showModalBox("Start New Series", inner, "Start", async ()=>{
    const target = parseInt(document.getElementById("modalSeriesTarget").value,10) || 5;
    const teamA = document.getElementById("modalTeamA").value.trim();
    const teamB = document.getElementById("modalTeamB").value.trim();
    if(!teamA || !teamB){ alert("Pick both teams"); return; }
    if(teamA === teamB){ alert("Teams cannot be same"); return; }
    const sid = uid("series");
    const rec = { winner: teamA, loser: teamB, seriesId: sid, seriesTarget: target, seriesStartedAt: new Date().toISOString(), time: new Date().toISOString() };
    // We want a first match saved when series starts (user chose winner/loser fields as first match)
    // The UI above picks Team A as 'winner' initially (this keeps behavior consistent with prior app). If you want no initial match, change logic.
    gameData.games.push(rec);
    saveLocal();
    cloudSaveGame(rec);
    renderHomeActiveList(); updateStatsUI();
    console.log("New series started:", sid, teamA, "vs", teamB, "target", target);
  });
};

/* ========== Open Add Game (detailed modal showing current score & games left) ========== */
window.openAddGame = function(seriesId){
  const { seriesMap } = computeAggregates();
  const s = seriesMap[seriesId];
  if(!s) return alert("Series not found");
  if(s.finished) return alert("Series already finished.");

  // Determine two teams
  const names = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).slice(0,2);
  const teamA = names[0] || TEAM_LIST[0];
  const teamB = names[1] || TEAM_LIST[1];
  const scoreA = s.wins[teamA] || 0;
  const scoreB = s.wins[teamB] || 0;
  const remainingA = Math.max(0, s.target - scoreA);
  const remainingB = Math.max(0, s.target - scoreB);

  const inner = `
    <div>
      <div style="margin-bottom:10px;font-weight:700">Current Score</div>
      <div style="display:flex;gap:12px;align-items:center;justify-content:center;margin-bottom:10px">
        <div style="text-align:center"><div style="font-size:1.4rem;font-weight:800">${escapeHtml(teamA)}</div><div style="font-size:1.2rem">${scoreA}</div></div>
        <div style="font-size:1.4rem;font-weight:800">—</div>
        <div style="text-align:center"><div style="font-size:1.4rem;font-weight:800">${escapeHtml(teamB)}</div><div style="font-size:1.2rem">${scoreB}</div></div>
      </div>
      <div style="margin-bottom:8px;color:#9fb7bf">First to ${s.target}. Remaining: ${escapeHtml(teamA)} needs ${remainingA}, ${escapeHtml(teamB)} needs ${remainingB}</div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
        <button class="neu-btn" id="addWinnerA">${escapeHtml(teamA)} won</button>
        <button class="neu-btn" id="addWinnerB">${escapeHtml(teamB)} won</button>
      </div>
    </div>
  `;

  showModalBox("Who won this game?", inner, "Close", ()=>{ /* handled by the winner buttons */ });

  // Attach click handlers
  setTimeout(()=>{
    const btnA = document.getElementById("addWinnerA");
    const btnB = document.getElementById("addWinnerB");
    if(btnA) btnA.onclick = () => { addGameToSeries(seriesId, teamA, teamB); closeModal(); };
    if(btnB) btnB.onclick = () => { addGameToSeries(seriesId, teamB, teamA); closeModal(); };
  }, 50);
};

/* ========== Add Game to Series (core): creates a new game entry and syncs ========== */
async function addGameToSeries(seriesId, winner, loser){
  // find series target & startedAt from local aggregates (keep consistent)
  const { seriesMap } = computeAggregates();
  const s = seriesMap[seriesId];
  if(!s) return alert("Series not found");
  if(s.finished) return alert("Series already finished — cannot add.");

  const rec = {
    winner, loser,
    seriesId,
    seriesTarget: s.target || 5,
    seriesStartedAt: s.startedAt || new Date().toISOString(),
    time: new Date().toISOString()
  };
  gameData.games.push(rec);
  saveLocal();
  cloudSaveGame(rec);
  console.log("Added game to series:", seriesId, winner, "beat", loser);

  // After save UI behavior
  renderHomeActiveList();
  updateStatsUI();

  // If this add completed the series, show special message & fireworks
  const agg = computeAggregates();
  const updatedSeries = agg.seriesMap[seriesId];
  const wWins = updatedSeries.wins[updatedSeries.winner] || 0;
  const lWins = updatedSeries.wins[Object.keys(updatedSeries.wins).find(t=>t!==updatedSeries.winner)] || 0;
  if(updatedSeries.finished){
    // series finished
    if(lWins === 0){
      // flawless sweep
      showInfoBox("FLAWLESS VICTORY!", `<div style="font-weight:800">${escapeHtml(updatedSeries.winner)} sweeps the series ${wWins}-${lWins}!</div><div class="small-muted">Saved locally and synced to cloud.</div>`, "OK", ()=>{ startFireworks(); });
    } else {
      showInfoBox("Series Complete", `<div style="font-weight:700">${escapeHtml(updatedSeries.winner)} wins the series ${wWins}-${lWins}!</div><div class="small-muted">Saved locally and synced to cloud.</div>`, "OK", ()=>{ simpleConfetti(); });
    }
  } else {
    // ongoing
    const remaining = Math.max(0, updatedSeries.target - (updatedSeries.wins[rec.winner]||0));
    showInfoBox("Game Saved", `<div><b>${escapeHtml(rec.winner)}</b> beat <b>${escapeHtml(rec.loser)}</b></div><div class="small-muted">${escapeHtml(rec.winner)} needs <b>${remaining}</b> more win${remaining===1?'':'s'} to reach ${updatedSeries.target}.</div>`);
  }
}

/* ========== Series Details ========== */
window.viewSeriesDetails = function(seriesId){
  const games = (gameData.games||[]).filter(g=>g.seriesId===seriesId).sort((a,b)=>new Date(a.time)-new Date(b.time));
  if(!games.length) return showInfoBox("Series Details", "<i>No games yet</i>");
  const rows = games.map((g,i)=>`<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.03)">${i+1}. ${new Date(g.time).toLocaleString()} — <b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b></div>`).join("");
  showModalBox("Series Details", `<div style="max-height:320px;overflow:auto">${rows}</div>`, "Close", ()=>{});
};

/* ========== Graphics: confetti/fireworks ========== */
function simpleConfetti(){
  const c = document.createElement("canvas"); c.style.position="fixed"; c.style.left=0; c.style.top=0; c.style.width="100%"; c.style.height="100%"; c.style.zIndex=99997; c.style.pointerEvents="none";
  document.body.appendChild(c); const ctx = c.getContext("2d");
  function resize(){ c.width = innerWidth; c.height = innerHeight; } resize(); window.addEventListener('resize', resize);
  const colors=['#ffdd57','#ff6b6b','#44ff8a','#6ec0ff','#ff9ce3']; const pieces=[];
  for(let i=0;i<70;i++) pieces.push({x:Math.random()*c.width,y:-Math.random()*c.height,w:6+Math.random()*10,h:6+Math.random()*10,vx:-2+Math.random()*4,vy:2+Math.random()*4,color:colors[Math.floor(Math.random()*colors.length)],rot:Math.random()*360,vr:-5+Math.random()*10});
  let last = performance.now();
  function frame(t){
    const dt = (t-last)/16.67; last = t; ctx.clearRect(0,0,c.width,c.height);
    pieces.forEach(p=>{ p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 0.05*dt; p.rot += p.vr*dt; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180); ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore(); });
    if(pieces.every(p=>p.y > c.height+50)){ c.remove(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function startFireworks(duration=3000){
  let c = document.getElementById("fireworks");
  if(!c){ c = document.createElement("canvas"); c.id="fireworks"; c.style.position="fixed"; c.style.left=0; c.style.top=0; c.style.width="100%"; c.style.height="100%"; c.style.zIndex=99996; c.style.pointerEvents="none"; document.body.appendChild(c); }
  const ctx = c.getContext("2d");
  function resize(){ c.width = innerWidth; c.height = innerHeight; } resize(); window.addEventListener('resize', resize);
  const particles = [];
  function spawn(){
    const cx = Math.random()*c.width;
    const cy = Math.random()*c.height*0.6;
    const hue = Math.floor(Math.random()*360);
    const count = 20 + Math.round(Math.random()*40);
    for(let i=0;i<count;i++){
      const ang = Math.random()*Math.PI*2;
      const sp = Math.random()*4+1;
      particles.push({x:cx,y:cy,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,life:50+Math.round(Math.random()*50),color:`hsl(${hue} 70% 60%)`});
    }
  }
  let last = performance.now();
  function frame(t){
    const dt = (t-last)/16.67; last = t; ctx.fillStyle="rgba(0,0,0,0.18)"; ctx.fillRect(0,0,c.width,c.height);
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i]; p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 0.06*dt; p.life--;
      ctx.beginPath(); ctx.fillStyle = p.color; ctx.arc(p.x,p.y,Math.max(0,Math.min(3,p.life/12)),0,Math.PI*2); ctx.fill();
      if(p.life <= 0) particles.splice(i,1);
    }
    requestAnimationFrame(frame);
  }
  const sp = setInterval(spawn, 220);
  requestAnimationFrame(frame);
  setTimeout(()=>{ clearInterval(sp); setTimeout(()=>{ if(c) c.style.display="none"; }, 1200); }, duration);
}

/* ========== Cloud save with secret (write) ========== */
async function cloudSaveGame(rec){
  if(!gamesRef) return;
  try {
    // attach secret to satisfy rules
    await Promise.race([
      addDoc(gamesRef, {...rec, secret: SECRET_KEY}),
      new Promise((_, rej) => setTimeout(()=>rej(new Error("timeout")), 3000))
    ]);
    console.log("Cloud write OK");
  } catch(e){ console.warn("Cloud save failed", e); }
}

/* ========== PATCH OLD CLOUD DOCS (adds secret) ========== */
async function patchMissingSecrets(){
  if(!gamesRef) return;
  try {
    const snaps = await getDocs(gamesRef);
    const updates = [];
    snaps.forEach(docSnap => {
      const d = docSnap.data();
      if(!d || !d.secret) updates.push(updateDoc(docSnap.ref, { secret: SECRET_KEY }));
    });
    if(updates.length){
      await Promise.all(updates);
      console.log("Patched", updates.length, "cloud docs with secret");
    } else {
      console.log("No cloud docs needed patching");
    }
  } catch(err){
    console.warn("patchMissingSecrets failed or blocked (might be expected):", err);
  }
}

/* ========== CLOUD DELETE OPERATIONS ========== */
async function cloudDeleteAll(){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const snaps = await getDocs(gamesRef);
  await Promise.all(snaps.docs.map(d => deleteDoc(d.ref)));
  console.log("Cloud: all data deleted");
}
async function cloudDeleteLast(){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const q = query(gamesRef, orderBy("time", "desc"), limit(1));
  const snaps = await getDocs(q);
  await Promise.all(snaps.docs.map(d => deleteDoc(d.ref)));
  console.log("Cloud: last game deleted");
}
async function cloudDeleteSeries(seriesId){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const q = query(gamesRef, where("seriesId", "==", seriesId));
  const snaps = await getDocs(q);
  await Promise.all(snaps.docs.map(d => deleteDoc(d.ref)));
  console.log("Cloud: series", seriesId, "deleted");
}

/* ========== DELETE UI functions (password protected) ========== */
window.resetStats = async function(){
  const pw = prompt("Enter password to reset all data:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("⚠️ This will permanently delete ALL stats from everywhere. Continue?")) return;
  try {
    gameData = { games: [] }; saveLocal();
    if(gamesRef) await cloudDeleteAll();
    renderHomeActiveList(); updateStatsUI();
    alert("✅ All statistics cleared from all devices.");
  } catch(err){
    console.error("Error deleting all data:", err); alert("Error deleting cloud data.");
  }
};

window.deleteLastGame = async function(){
  const pw = prompt("Enter password to delete last game:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("Delete the most recent game permanently from everywhere?")) return;
  try {
    if(gameData.games && gameData.games.length) gameData.games.pop();
    saveLocal();
    if(gamesRef) await cloudDeleteLast();
    renderHomeActiveList(); updateStatsUI();
    alert("✅ Last game deleted everywhere.");
  } catch(err){
    console.error("Error deleting last game:", err); alert("Error deleting last game from cloud.");
  }
};

window.deleteSeriesConfirm = async function(seriesId){
  const pw = prompt("Enter password to delete this series and its games:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("Delete entire series and its game history everywhere?")) return;
  try {
    gameData.games = (gameData.games||[]).filter(g => g.seriesId !== seriesId);
    saveLocal();
    if(gamesRef) await cloudDeleteSeries(seriesId);
    renderHomeActiveList(); updateStatsUI();
    alert("✅ Series deleted everywhere.");
  } catch(err){
    console.error("Error deleting series:", err); alert("Error deleting series");
  }
};

/* ========== SHARE: WhatsApp summary (matches requested format) ========== */
window.shareToWhatsApp = function(){
  const { seriesMap, teamStats, finishedByTarget } = (() => {
    const agg = computeAggregates();
    return { seriesMap: agg.seriesMap, teamStats: agg.teamStats, finishedByTarget: agg.completedByTarget };
  })();
  const totalGames = (gameData.games||[]).length;
  const completedByTarget = computeAggregates().completedByTarget;
  const teamsByWins = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].wins||0)-(teamStats[a].wins||0));
  const topWins = teamsByWins.slice(0,2).map((t,i)=>`${i+1}. ${t} — ${teamStats[t].wins||0} Games, ${teamStats[t].seriesWon||0} Series`);
  const teamsByLosses = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].losses||0)-(teamStats[a].losses||0));
  const topLosses = teamsByLosses.slice(0,2).map((t,i)=>`${i+1}. ${t} — ${teamStats[t].losses||0} Games, ${teamStats[t].seriesWon||0} Series`);
  const champion = teamsByWins.length ? teamsByWins[0] : "—";

  // Best games: find flawless sweeps and best margin finishes
  const finished = computeAggregates().finishedSeries || [];
  let bestMargin = -1;
  const finishedDetails = finished.map(s=>{
    const tally = {};
    s.games.forEach(g => { tally[g.winner] = (tally[g.winner]||0) + 1; });
    const winner = s.winner;
    const winnerWins = tally[winner] || 0;
    const opponents = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).filter(x=>x!==winner);
    const opponentMax = opponents.length ? Math.max(...opponents.map(o=>tally[o]||0)) : 0;
    const margin = winnerWins - opponentMax;
    if(margin > bestMargin) bestMargin = margin;
    return { s, winner, winnerWins, opponentMax, opponents };
  });
  const flawless = finishedDetails.filter(d => d.opponentMax === 0);
  const bestMarginList = finishedDetails.filter(d => (d.winnerWins - d.opponentMax) === bestMargin);
  const finalBest = [];
  const seen = new Set();
  flawless.forEach(it=> { const key = `${it.winner}|${it.winnerWins}-${it.opponentMax}|${it.opponents.join(",")}`; if(!seen.has(key)){ finalBest.push(it); seen.add(key); } });
  bestMarginList.forEach(it=> { const key = `${it.winner}|${it.winnerWins}-${it.opponentMax}|${it.opponents.join(",")}`; if(!seen.has(key)){ finalBest.push(it); seen.add(key); } });

  let msg = `🎴 Bluff Masters — Overall Stats\n\nTotal Games: ${totalGames}\nTotal Series:\n  5 Series → ${completedByTarget[5]||0}\n  10 Series → ${completedByTarget[10]||0}\n\n🏆 Total Wins (Top 2):\n`;
  msg += (topWins.length ? topWins.join("\n") : "None\n") + "\n\n";
  msg += "💔 Total Losses (Top 2):\n" + (topLosses.length ? topLosses.join("\n") : "None\n") + "\n\n";
  msg += `👑 Current Champion: ${champion}\n\n`;
  if(finalBest.length){
    msg += "🔥 Best Game(s):\n";
    finalBest.forEach(it => msg += `${it.winner} — ${it.winnerWins}-${it.opponentMax} vs ${it.opponents.join(", ")}\n`);
  } else { msg += "🔥 Best Game(s): None\n"; }
  const url = "https://api.whatsapp.com/send?text=" + encodeURIComponent(msg);
  window.open(url, "_blank");
};

/* ========== UI: Stats page update (table as requested) ========== */
function updateStatsUI(){
  const statsSection = document.getElementById("statsSection");
  if(!statsSection) return;
  const agg = computeAggregates();
  const totalGames = (gameData.games||[]).length;
  const totalSeriesCompleted = (agg.finishedSeries || []).length;
  const byTarget = agg.completedByTarget || {5:0,10:0};
  // Top wins & losses
  const teams = Object.keys(agg.teamStats || {}).sort((a,b)=>(agg.teamStats[b].wins||0)-(agg.teamStats[a].wins||0));
  const topWins = teams.slice(0,2).map(t=>`${t} — ${agg.teamStats[t].wins||0} Games, ${agg.teamStats[t].seriesWon||0} Series`);
  const teamsLoss = Object.keys(agg.teamStats || {}).sort((a,b)=>(agg.teamStats[b].losses||0)-(agg.teamStats[a].losses||0));
  const topLoss = teamsLoss.slice(0,2).map(t=>`${t} — ${agg.teamStats[t].losses||0} Games, ${agg.teamStats[t].seriesWon||0} Series`);
  const champion = teams.length ? teams[0] : "—";

  // Best games logic (same as share)
  const finished = agg.finishedSeries || [];
  let bestMargin=-1;
  const finishedDetails = finished.map(s=>{
    const tally = {};
    s.games.forEach(g=>{ tally[g.winner] = (tally[g.winner]||0) + 1; });
    const winner = s.winner;
    const winnerWins = tally[winner] || 0;
    const opponents = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).filter(x=>x!==winner);
    const opponentMax = opponents.length ? Math.max(...opponents.map(o=>tally[o]||0)) : 0;
    const margin = winnerWins - opponentMax;
    if(margin > bestMargin) bestMargin = margin;
    return { s, winner, winnerWins, opponentMax, opponents };
  });
  const flawless = finishedDetails.filter(d=>d.opponentMax === 0);
  const bestMarginList = finishedDetails.filter(d=> (d.winnerWins - d.opponentMax) === bestMargin);
  const finalBest = []; const seen = new Set();
  flawless.forEach(it => { const k=`${it.winner}|${it.winnerWins}-${it.opponentMax}|${it.opponents.join(",")}`; if(!seen.has(k)){ finalBest.push(it); seen.add(k); } });
  bestMarginList.forEach(it => { const k=`${it.winner}|${it.winnerWins}-${it.opponentMax}|${it.opponents.join(",")}`; if(!seen.has(k)){ finalBest.push(it); seen.add(k); } });

  // Generate HTML table as requested
  let html = `
    <h2>Overall Stats</h2>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px;padding:12px;border-radius:10px;background:linear-gradient(135deg,#3affd0,#20a56e);color:#07130f;font-weight:700;text-align:center">Total Games<br>${totalGames}</div>
      <div style="flex:1;min-width:180px;padding:12px;border-radius:10px;background:linear-gradient(135deg,#6ec0ff,#4a7bd6);color:#07130f;font-weight:700;text-align:center">Total Series Completed<br>${totalSeriesCompleted}</div>
    </div>
    <div style="margin-top:12px">5 Series → ${byTarget[5]||0} completed • 10 Series → ${byTarget[10]||0} completed</div>
    <hr style="margin:12px 0">
    <div style="display:flex;gap:12px">
      <div style="flex:1">
        <h3>Total Wins (Top 2)</h3>
        ${topWins.length?topWins.map(x=>`<div>${x}</div>`).join(""):'<div>None</div>'}
      </div>
      <div style="flex:1">
        <h3>Total Losses (Top 2)</h3>
        ${topLoss.length?topLoss.map(x=>`<div>${x}</div>`).join(""):'<div>None</div>'}
      </div>
    </div>
    <div style="margin-top:12px"><b>Champions:</b> ${escapeHtml(champion)}</div>
    <div style="margin-top:12px"><b>Best Game(s):</b>
      ${finalBest.length? finalBest.map(it=>`<div>${escapeHtml(it.winner)} — ${it.winnerWins}-${it.opponentMax} vs ${it.opponents.join(", ")}</div>`).join("") : '<div>None</div>'}
    </div>
    <hr style="margin:12px 0">
    <h3>Game History</h3>
    ${ (gameData.games||[]).slice().reverse().map(g=>`<div style="padding:8px;background:rgba(255,255,255,0.02);margin:8px 0;border-radius:8px"><small>${new Date(g.time).toLocaleString()}</small><br><b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b> <small style="opacity:.7">[series:${g.seriesId} target:${g.seriesTarget||5}]</small></div>`).join("") || '<div>No games yet</div>'}
    <div style="margin-top:12px"><button class="neu-btn" onclick="shareToWhatsApp()">📤 Share</button> <button class="neu-btn secondary" onclick="resetStats()">Reset All</button></div>
  `;
  statsSection.innerHTML = html;
}

/* ========== Firestore realtime sync: replace local cache entirely on updates ========== */
if(gamesRef){
  (async ()=>{
    try {
      await patchMissingSecrets();
    } catch(e){ console.warn("Initial patch may have failed:", e); }

    try {
      const q = query(gamesRef, orderBy("time"));
      onSnapshot(q, snapshot => {
        const docs = snapshot.docs.map(d=>d.data()).sort((a,b)=> new Date(a.time) - new Date(b.time));
        const count = docs.length;
        // Always replace local cache with cloud snapshot (prevents stale local data)
        gameData.games = count ? docs : [];
        saveLocal();
        renderHomeActiveList();
        updateStatsUI();
        console.log("Synced from cloud:", count, "records (local refreshed)");
      }, err => {
        console.warn("onSnapshot error:", err);
      });
    } catch(e){ console.warn("onSnapshot failed:", e); }
  })();
}

/* ========== INIT UI ========== */
renderHomeActiveList();
updateStatsUI();
console.log("✅ Bluff Masters app.js loaded — features: detailed add, full stats, cloud sync.");

/* ========== Expose a few helpers for debugging ========== */
window._dumpLocal = () => JSON.stringify(gameData, null, 2);
window._forceSync = async () => { if(gamesRef){ const snaps = await getDocs(query(gamesRef, orderBy("time"))); gameData.games = snaps.docs.map(d=>d.data()); saveLocal(); renderHomeActiveList(); updateStatsUI(); console.log("Forced sync"); } };
/* === UI Navigation === */
window.showStats = function() {
  document.getElementById("homeSection").style.display = "none";
  document.getElementById("statsSection").style.display = "block";
  updateStatsUI();
};

window.showHome = function() {
  document.getElementById("statsSection").style.display = "none";
  document.getElementById("homeSection").style.display = "block";
  renderHomeActiveList();
};


