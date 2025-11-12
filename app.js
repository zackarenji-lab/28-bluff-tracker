/* app.js - full, drop-in replacement for Bluff Masters
   Save next to index.html. Requires index.html placeholders (modalContainer, fireworks canvas).
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  deleteDoc,
  limit,
  where
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

/* ---------- CONFIG ---------- */
const FIREBASE_CONF = {
  apiKey: "AIzaSyBdAIdEDwfoalevfadgixPTLIoLoEqi8kc",
  authDomain: "bluff-tracker-7542e.firebaseapp.com",
  projectId: "bluff-tracker-7542e",
  storageBucket: "bluff-tracker-7542e.appspot.com",
  messagingSenderId: "280965687037",
  appId: "1:280965687037:web:be0b05da36ef653ab68094"
};
const SECRET_KEY = "zachariahrenji"; // used in Firestore writes to satisfy rules
const STORAGE_KEY = "bluff_tracker_v1";
const TEAM_LIST = [
  "Bibin & Zach","Bimal & Annu","Bibin & Annu","Zach & Daddy","Bibin & Bimal","Zach & Rikku","Bibin & Daddy"
];

/* ---------- FIREBASE (best-effort) ---------- */
let db = null, gamesRef = null;
try {
  const app = initializeApp(FIREBASE_CONF);
  db = getFirestore(app);
  gamesRef = collection(db, "games");
  console.log("Firebase initialized");
} catch (e) {
  console.warn("Firebase init failed (ok for local-only use)", e);
}

/* ---------- APP STATE ---------- */
let gameData = { games: [] }; // persisted to localStorage; each game: {winner,loser,seriesId,seriesTarget,seriesStartedAt,time}
(function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) gameData = JSON.parse(raw);
  } catch (e) { console.warn("local load failed", e); }
})();
function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameData)); } catch (e) { console.warn("local save failed", e); }
}

/* ---------- UTIL ---------- */
function uid(prefix="s"){ return prefix + "_" + Date.now() + "_" + Math.floor(Math.random()*9000+1000); }
function escapeHtml(s){ if(!s) return ""; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

/* Ensure every game has seriesId and seriesStartedAt (backfill older data) */
function ensureSeriesIds() {
  let changed=false;
  for(const g of (gameData.games||[])) {
    if(!g.seriesId){ g.seriesId = uid("series"); changed=true; }
    if(!g.seriesStartedAt) g.seriesStartedAt = g.time || new Date().toISOString();
  }
  if(changed) saveLocal();
}

/* ---------- AGGREGATION ---------- */
function computeAggregates() {
  ensureSeriesIds();
  const seriesMap = {}; // id -> {id,target,games,wins,finished,winner,startedAt}
  const teamStats = {}; // team -> wins,losses,seriesWon,consecutiveSeries
  (gameData.games||[]).forEach(g=>{
    const sid = g.seriesId;
    if(!seriesMap[sid]) seriesMap[sid] = { id:sid, target:g.seriesTarget||5, games:[], wins:{}, finished:false, winner:null, startedAt:g.seriesStartedAt||g.time||new Date().toISOString() };
    const s = seriesMap[sid];
    s.games.push(g);
    s.wins[g.winner] = (s.wins[g.winner]||0) + 1;
    if(s.wins[g.winner] >= s.target && !s.finished){ s.finished=true; s.winner=g.winner; }

    if(!teamStats[g.winner]) teamStats[g.winner] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    if(!teamStats[g.loser]) teamStats[g.loser] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    teamStats[g.winner].wins++;
    teamStats[g.loser].losses++;
  });

  // finished series + streaks
  const finishedSeries = Object.values(seriesMap).filter(s=>s.finished).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  const streaks = {};
  finishedSeries.forEach(s=>{
    const w = s.winner;
    if(!teamStats[w]) teamStats[w] = { wins:0, losses:0, seriesWon:0, consecutiveSeries:0 };
    teamStats[w].seriesWon = (teamStats[w].seriesWon||0) + 1;
    streaks[w] = (streaks[w]||0) + 1;
    Object.keys(streaks).forEach(t=>{ if(t!==w) streaks[t]=0; });
    teamStats[w].consecutiveSeries = streaks[w];
  });

  const activeSeries = Object.values(seriesMap).filter(s=>!s.finished).sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));
  const completedByTarget = {5:0,10:0};
  finishedSeries.forEach(s=>{ if(s.target===5) completedByTarget[5]++; if(s.target===10) completedByTarget[10]++; });

  return { seriesMap, teamStats, activeSeries, completedSeriesCount: finishedSeries.length, completedByTarget, finishedSeries };
}

/* ---------- RENDER HOME / ACTIVE SERIES ---------- */
function renderHomeActiveList(){
  const { activeSeries } = computeAggregates();
  const container = document.getElementById("activeList");
  if(!container) return;
  container.innerHTML = "";
  if(!activeSeries || activeSeries.length===0){ document.getElementById("noActive").style.display="block"; return; }
  document.getElementById("noActive").style.display = "none";

  activeSeries.forEach(s=>{
    const teams = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).slice(0,2);
    const t1 = teams[0] || TEAM_LIST[0];
    const t2 = teams[1] || TEAM_LIST[1];
    const s1 = s.wins[t1]||0;
    const s2 = s.wins[t2]||0;

    const card = document.createElement("div");
    card.className = "series-card" + ((s1!==s2) ? " lead" : "");
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:700">${escapeHtml(t1)} <span style="opacity:.7">vs</span> ${escapeHtml(t2)}</div>
          <div style="font-size:.9rem;color:#9fb7bf">First to ${s.target} • started ${new Date(s.startedAt).toLocaleString()}</div>
        </div>
        <div style="text-align:right;min-width:150px;display:flex;align-items:center;gap:12px;justify-content:flex-end">
          <div style="font-size:1.05rem;font-weight:800">${s1} — ${s2}</div>
          <div>
            <button class="neu-btn" onclick="resumeSeries('${s.id}')">➕ Add</button>
            <button class="neu-btn secondary" onclick="viewSeriesDetails('${s.id}')">Details</button>
          </div>
          <div style="margin-left:6px">
            <button class="trash" title="Delete series" onclick="deleteSeriesConfirm('${s.id}')">🗑️</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ---------- MODALS ---------- */
function closeModal(){ const mc=document.getElementById("modalContainer"); if(mc) mc.innerHTML=""; }
function showModal(title, html, onOk, okText="OK"){
  closeModal();
  const overlay=document.createElement("div"); overlay.className="overlay";
  const box=document.createElement("div"); box.className="confirm-box";
  box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${title}</div><div style="text-align:left">${html}</div>`;
  const row=document.createElement("div"); row.style.marginTop="12px"; row.style.display="flex"; row.style.justifyContent="center"; row.style.gap="8px";
  const ok=document.createElement("button"); ok.className="neu-btn"; ok.innerText=okText; ok.onclick=()=>{ onOk&&onOk(); closeModal(); };
  const cancel=document.createElement("button"); cancel.className="neu-btn secondary"; cancel.innerText="Cancel"; cancel.onclick=closeModal;
  row.appendChild(ok); row.appendChild(cancel); box.appendChild(row); overlay.appendChild(box);
  document.getElementById("modalContainer").appendChild(overlay);
}
function showLargeConfirm(title, html, onOk){
  closeModal();
  const overlay=document.createElement("div"); overlay.className="overlay";
  const box=document.createElement("div"); box.className="confirm-box";
  box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">${title}</div><div style="text-align:left">${html}</div>`;
  const ok=document.createElement("button"); ok.className="neu-btn"; ok.innerText="OK"; ok.onclick=()=>{ closeModal(); onOk&&onOk(); };
  box.appendChild(ok); overlay.appendChild(box); document.getElementById("modalContainer").appendChild(overlay);
}

/* ---------- START / RESUME / DETAILS ---------- */
window.startNewSeries = function(){
  const teamOptions = TEAM_LIST.map(t=>`<option>${escapeHtml(t)}</option>`).join("");
  const html = `
    <div>
      <label>Series target:</label>
      <select id="modalSeriesTarget" style="width:100%;padding:8px;margin-top:6px"><option value="5">First to 5</option><option value="10">First to 10</option></select>
      <label style="margin-top:10px;display:block">Winner (first match):</label>
      <select id="modalWinner" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
      <label style="margin-top:10px;display:block">Loser (first match):</label>
      <select id="modalLoser" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
    </div>
  `;
  showModal("Start New Series", html, async ()=>{
    const target = parseInt(document.getElementById("modalSeriesTarget").value,10) || 5;
    const winner = document.getElementById("modalWinner").value.trim();
    const loser = document.getElementById("modalLoser").value.trim();
    if(!winner || !loser){ alert("Please pick both teams"); return; }
    if(winner===loser){ alert("Winner and loser cannot be same"); return; }
    const sid = uid("series");
    const rec = { winner, loser, seriesId: sid, seriesTarget: target, seriesStartedAt: new Date().toISOString(), time: new Date().toISOString() };
    gameData.games.push(rec); saveLocal(); cloudSaveGame(rec); afterLocalSave(rec);
  }, "Start Series");
};

window.resumeSeries = function(seriesId){
  const { seriesMap } = computeAggregates();
  const s = seriesMap[seriesId];
  if(!s) return alert("Series not found");
  const teams = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser])));
  const opts = (teams.length?teams:TEAM_LIST).map(t=>`<option>${escapeHtml(t)}</option>`).join("");
  const html = `<div><div style="margin-top:6px">Winner:</div><select id="modalWinnerSelect" style="width:100%;padding:8px;margin-top:6px">${opts}</select><div style="margin-top:10px;color:#9fb7bf;font-size:0.9rem">Loser will be determined automatically.</div></div>`;
  showModal("Add Match", html, async ()=>{
    const winner = document.getElementById("modalWinnerSelect").value;
    if(!winner){ alert("Choose winner"); return; }
    const pair = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).filter(t=>t!==winner);
    let loser = pair.length?pair[0]:(TEAM_LIST.find(t=>t!==winner)||"Unknown");
    if(winner===loser){ alert("Winner cannot equal loser"); return; }
    const rec = { winner, loser, seriesId: s.id, seriesTarget: s.target, seriesStartedAt: s.startedAt, time: new Date().toISOString() };
    gameData.games.push(rec); saveLocal(); cloudSaveGame(rec); afterLocalSave(rec);
  }, "Save");
};

window.viewSeriesDetails = function(seriesId){
  const games = (gameData.games||[]).filter(g=>g.seriesId===seriesId).sort((a,b)=>new Date(a.time)-new Date(b.time));
  const rows = games.map((g,i)=>`<div style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.03)">${i+1}. ${new Date(g.time).toLocaleString()} — <b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b></div>`).join('');
  showModal("Series Details", `<div style="max-height:340px;overflow:auto">${rows || '<i>No games yet</i>'}</div>`, ()=>{}, "Close");
};

/* ---------- AFTER SAVE UI ---------- */
function afterLocalSave(rec){
  renderHomeActiveList(); updateStatsUI();
  const msg = buildSeriesProgressMessage(rec);
  showLargeConfirm("✅ Game Saved", msg, ()=>{ showStats(); });
  maybeShowGraphics(rec);
}

/* Build progress message (flawless, hat-trick, streaks) */
function buildSeriesProgressMessage(rec){
  const { seriesMap, teamStats } = computeAggregates();
  const s = seriesMap[rec.seriesId];
  const winner=rec.winner, loser=rec.loser;
  const winnerWins = s.wins[winner]||0, loserWins = s.wins[loser]||0;
  const remaining = Math.max(0, s.target - winnerWins);
  if(winnerWins >= s.target){
    const scoreLine = `${winnerWins}-${loserWins}`;
    if(loserWins===0) return `<div class="confirm-message"><b>FLAWLESS VICTORY! ${scoreLine}!</b><br>${escapeHtml(winner)} sweeps the series!</div><div class="small-muted">Saved locally and syncing to cloud.</div>`;
    const streak = (teamStats[winner] && teamStats[winner].consecutiveSeries) || 1;
    if(streak>=3) return `<div class="confirm-message"><b>🔥 HAT-TRICK! ${escapeHtml(winner)} wins again — ${scoreLine}!</b><br>Incredible streak: ${streak} consecutive series!</div>`;
    if(streak===2) return `<div class="confirm-message"><b>🏆 Series Won — ${scoreLine}</b><br>Yaay.. Another fabulous series. ${escapeHtml(winner)} won ${streak} series in a row! All the best for a Hat-Trick!</div>`;
    return `<div class="confirm-message"><b>🏆 Series Won — ${scoreLine}</b><br>${escapeHtml(winner)} wins this series!</div>`;
  } else {
    return `<div class="confirm-message"><b>${escapeHtml(winner)} beat ${escapeHtml(loser)}</b><br>${escapeHtml(winner)} needs <b>${remaining}</b> more win${remaining===1?'':'s'} to reach ${s.target} wins in this series.</div><div class="small-muted">Saved locally and syncing to cloud.</div>`;
  }
}

/* ---------- GRAPHICS ---------- */
function simpleConfetti(){
  const c=document.createElement("canvas"); c.style.position="fixed"; c.style.left=0; c.style.top=0;
  c.style.width="100%"; c.style.height="100%"; c.style.zIndex=99997; c.style.pointerEvents="none"; document.body.appendChild(c);
  const ctx=c.getContext("2d"); function r(){c.width=innerWidth; c.height=innerHeight;} r(); window.addEventListener("resize", r);
  const colors=['#ffdd57','#ff6b6b','#44ff8a','#6ec0ff','#ff9ce3']; const p=[];
  for(let i=0;i<80;i++) p.push({x:Math.random()*c.width,y:-Math.random()*c.height,w:6+Math.random()*10,h:6+Math.random()*10,vx:-2+Math.random()*4,vy:2+Math.random()*4,color:colors[Math.floor(Math.random()*colors.length)],rot:Math.random()*360,vr:-5+Math.random()*10});
  let last=performance.now();
  function f(t){ const dt=(t-last)/16.67; last=t; ctx.clearRect(0,0,c.width,c.height); p.forEach(a=>{ a.x+=a.vx*dt; a.y+=a.vy*dt; a.vy+=0.05*dt; a.rot+=a.vr*dt; ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(a.rot*Math.PI/180); ctx.fillStyle=a.color; ctx.fillRect(-a.w/2,-a.h/2,a.w,a.h); ctx.restore(); }); if(p.every(a=>a.y>c.height+50)){ c.remove(); return; } requestAnimationFrame(f); } requestAnimationFrame(f);
}
function startFireworks(duration=2800){
  let c=document.getElementById("fireworks"); if(!c){ c=document.createElement("canvas"); c.id="fireworks"; c.className="fireworks-canvas"; document.body.appendChild(c); }
  c.style.display="block"; const ctx=c.getContext("2d"); function r(){c.width=innerWidth; c.height=innerHeight;} r(); window.addEventListener("resize", r);
  const fireworks=[]; function spawn(){ const x=Math.random()*c.width; const y=Math.random()*c.height*0.6; const count=30+Math.round(Math.random()*40); const hue=Math.round(Math.random()*360); for(let i=0;i<count;i++){ const speed=Math.random()*4+1; const angle=Math.random()*Math.PI*2; fireworks.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:60+Math.round(Math.random()*40),color:`hsl(${hue} ${60+Math.round(Math.random()*40)}% ${40+Math.round(Math.random()*40)}%)`}); } }
  let last=performance.now();
  function frame(t){ const dt=(t-last)/16.67; last=t; ctx.fillStyle="rgba(0,0,0,0.18)"; ctx.fillRect(0,0,c.width,c.height); for(let i=fireworks.length-1;i>=0;i--){ const p=fireworks[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=0.06*dt; p.life--; ctx.beginPath(); ctx.fillStyle=p.color; ctx.arc(p.x,p.y,Math.max(0,Math.min(3,p.life/10)),0,Math.PI*2); ctx.fill(); if(p.life<=0) fireworks.splice(i,1); } requestAnimationFrame(frame); }
  const sp=setInterval(spawn,250); requestAnimationFrame(frame);
  setTimeout(()=>{ clearInterval(sp); setTimeout(()=>{ c.style.display="none"; },1200); }, duration);
}
function maybeShowGraphics(rec){
  const { seriesMap } = computeAggregates(); const s = seriesMap[rec.seriesId];
  const ww = s.wins[rec.winner] || 0; const lw = s.wins[rec.loser] || 0;
  if(ww >= s.target && lw === 0) startFireworks(3200); else simpleConfetti();
}

/* ---------- CLOUD SAVE (with secret) ---------- */
async function cloudSaveGame(rec){
  if(!gamesRef) return;
  try{
    // attach secret to satisfy write rule
    await Promise.race([
      addDoc(gamesRef, { ...rec, secret: SECRET_KEY }),
      new Promise((_, rej) => setTimeout(()=>rej(new Error("timeout")), 3000))
    ]);
    console.log("Cloud write OK");
  } catch(e){ console.warn("Cloud save failed", e); }
}

/* ---------- DELETE: ALL / SERIES / LAST ---------- */
window.resetStats = async function(){
  const pw = prompt("Enter password to reset all data:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("⚠️ This will permanently delete ALL stats from everywhere. Continue?")) return;
  try{
    // remove local
    gameData = { games: [] };
    saveLocal();

    // delete cloud
    if(gamesRef){
      const snaps = await getDocs(gamesRef);
      const deletes = [];
      snaps.forEach(d => deletes.push(deleteDoc(d.ref)));
      await Promise.all(deletes);
      console.log("All cloud data deleted");
    }
    renderHomeActiveList(); updateStatsUI();
    showLargeConfirm("✅ Reset Complete", "All statistics erased everywhere.", ()=>{ goHome(); });
  } catch(err){ console.error(err); alert("Error deleting cloud data."); }
};

window.deleteLastGame = async function(){
  const pw = prompt("Enter password to delete last game:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("Delete the most recent game permanently from everywhere?")) return;
  try{
    // local
    if(gameData.games && gameData.games.length){
      const last = gameData.games.pop();
      saveLocal();
    }
    // cloud: delete last doc by time
    if(gamesRef){
      const q = query(gamesRef, orderBy("time","desc"), limit(1));
      const snaps = await getDocs(q);
      const deletes = [];
      snaps.forEach(d => deletes.push(deleteDoc(d.ref)));
      await Promise.all(deletes);
      console.log("Last game deleted from cloud");
    }
    renderHomeActiveList(); updateStatsUI();
    showLargeConfirm("✅ Last Game Deleted", "Statistics updated everywhere.", ()=>{ showStats(); });
  } catch(err){ console.error(err); alert("Error deleting last game from cloud."); }
};

async function deleteSeriesConfirm(seriesId){
  const pw = prompt("Enter password to delete this series and its games:");
  if(pw !== SECRET_KEY){ alert("❌ Incorrect password"); return; }
  if(!confirm("Delete entire series and its game history everywhere?")) return;
  try{
    // local remove
    if(gameData.games && Array.isArray(gameData.games)){
      gameData.games = gameData.games.filter(g => g.seriesId !== seriesId);
      saveLocal();
    }
    // cloud remove where seriesId == ...
    if(gamesRef){
      const q = query(gamesRef, where("seriesId","==",seriesId));
      const snaps = await getDocs(q);
      const deletes = [];
      snaps.forEach(d => deletes.push(deleteDoc(d.ref)));
      await Promise.all(deletes);
      console.log("Series deleted from cloud");
    }
    renderHomeActiveList(); updateStatsUI();
    showLargeConfirm("✅ Series Deleted", "Series removed everywhere.", ()=>{ showStats(); });
  } catch(err){ console.error(err); alert("Error deleting series"); }
}
window.deleteSeriesConfirm = deleteSeriesConfirm;

/* ---------- SHARE ---------- */
window.shareToWhatsApp = function(){
  const { seriesMap, teamStats } = computeAggregates();
  const totalGames = (gameData.games||[]).length;
  const completed = Object.values(seriesMap).filter(s=>s.finished);
  const completedByTarget = {5:0,10:0}; completed.forEach(s=>{ if(s.target===5) completedByTarget[5]++; if(s.target===10) completedByTarget[10]++; });
  const teamsByWins = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].wins||0)-(teamStats[a].wins||0));
  const topWins = teamsByWins.slice(0,2).map((t,i)=>`${i+1}️⃣ ${t} — ${teamStats[t].wins||0} Games | ${teamStats[t].seriesWon||0} Series`);
  const teamsByLosses = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].losses||0)-(teamStats[a].losses||0));
  const topLosses = teamsByLosses.slice(0,2).map((t,i)=>`${i+1}️⃣ ${t} — ${teamStats[t].losses||0} Games | ${teamStats[t].seriesWon||0} Series`);
  const champion = teamsByWins.length?teamsByWins[0]:"—";

  // Best games (flawless + best margin)
  let bestMargin=-1;
  const completedDetails = completed.map(s=>{
    const tally={}; s.games.forEach(g=>{ tally[g.winner]=(tally[g.winner]||0)+1; });
    const winnerTeam=s.winner; const winnerWins=tally[winnerTeam]||0;
    const opponents = Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).filter(x=>x!==winnerTeam);
    const opponentMaxWins = opponents.length?Math.max(...opponents.map(o=>tally[o]||0)):0;
    const margin = winnerWins - opponentMaxWins;
    if(margin>bestMargin) bestMargin=margin;
    return { s, winner:winnerTeam, winnerWins, opponentMaxWins, opponents };
  });

  const flawless = completedDetails.filter(d=>d.opponentMaxWins===0).map(d=>({ winner:d.winner, score:`${d.winnerWins}-${d.opponentMaxWins}`, opponents:d.opponents }));
  const bestMarginList = completedDetails.filter(d=> (d.winnerWins - d.opponentMaxWins)===bestMargin ).map(d=>({ winner:d.winner, score:`${d.winnerWins}-${d.opponentMaxWins}`, opponents:d.opponents }));

  const finalBest=[]; const seen=new Set();
  flawless.forEach(it=>{ const key=`${it.winner}|${it.score}|${it.opponents.join(",")}`; if(!seen.has(key)){ finalBest.push(it); seen.add(key); }});
  bestMarginList.forEach(it=>{ const key=`${it.winner}|${it.score}|${it.opponents.join(",")}`; if(!seen.has(key)){ finalBest.push(it); seen.add(key); }});

  let msg = `🎴 Bluff Masters — Overall Stats\n\nTotal Games: ${totalGames}\nTotal Series:\n  5 Series → ${completedByTarget[5]||0} completed\n  10 Series → ${completedByTarget[10]||0} completed\n\n🏆 Total Wins (Top 2):\n`;
  msg += (topWins.length?topWins.join("\n"):"None\n") + "\n\n";
  msg += "💔 Total Losses (Top 2):\n" + (topLosses.length?topLosses.join("\n"):"None\n") + "\n\n";
  msg += `👑 Current Champions: ${champion}\n\n`;
  if(finalBest.length){ msg += "🔥 Best Game(s):\n"; finalBest.forEach(it=>{ msg+=`${it.winner} — ${it.score} vs ${it.opponents.join(", ")}\n`; }); } else msg += "🔥 Best Game(s): None\n";
  const url = "https://api.whatsapp.com/send?text=" + encodeURIComponent(msg);
  window.open(url, "_blank");
};

/* ---------- UPDATE STATS UI (dashboard) ---------- */
function updateStatsUI(){
  const { seriesMap, teamStats, activeSeries, completedByTarget, completedSeriesCount } = computeAggregates();
  // small header boxes (if present)
  const totalGamesEl = document.getElementById("totalGames");
  if(totalGamesEl) totalGamesEl.textContent = (gameData.games||[]).length;
  const totalSeriesEl = document.getElementById("totalSeries");
  if(totalSeriesEl) totalSeriesEl.textContent = completedSeriesCount;
  // champion
  const teams = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].wins||0)-(teamStats[a].wins||0));
  const champion = teams.length?teams[0]:"—";
  const champText = document.getElementById("championText");
  if(champText) champText.textContent = champion;

  // stats page content
  const statsSection = document.getElementById("statsSection");
  if(!statsSection) return;
  let html = `<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700">Overall Statistics</div><div><button class="neu-btn" onclick="shareToWhatsApp()">📤 Share to WhatsApp</button><button class="neu-btn secondary" onclick="goHome()">← Back</button></div></div>`;
  html += `<div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap"><div style="flex:1;min-width:180px;background:linear-gradient(135deg,#3affd0,#20a56e);padding:12px;border-radius:10px;text-align:center;font-weight:700;color:#07130f"><div>Total Games</div><div id="tg">${(gameData.games||[]).length}</div></div><div style="flex:1;min-width:180px;background:linear-gradient(135deg,#6ec0ff,#4a7bd6);padding:12px;border-radius:10px;text-align:center;font-weight:700;color:#07130f"><div>Total Series</div><div id="ts">${completedSeriesCount}</div></div></div>`;
  html += `<div style="margin-top:12px"><b>Completed Series Breakdown</b><div style="color:#9fb7bf;margin-top:6px">5 Series → ${completedByTarget[5]||0} completed</div><div style="color:#9fb7bf;margin-top:3px">10 Series → ${completedByTarget[10]||0} completed</div></div>`;
  html += `<div style="margin-top:12px"><h3>Top Teams</h3>`;
  const sortedTeams = Object.keys(teamStats||{}).sort((a,b)=> (teamStats[b].wins||0)-(teamStats[a].wins||0));
  if(sortedTeams.length===0) html += `<div style="color:#cfd8e3">No teams yet</div>`;
  sortedTeams.forEach((team,i)=>{
    const s = teamStats[team]; const w = s.wins||0; const l = s.losses||0; const sw = s.seriesWon||0; const cs = s.consecutiveSeries||0; const total = w+l; const wp = total?Math.round(w/total*100):0;
    html += `<div style="background:rgba(255,255,255,0.02);padding:12px;border-radius:10px;margin-top:8px"><div style="font-weight:700">${escapeHtml(team)} ${i===0?'<span style="color:#ffd36d">👑</span>':''}</div><div style="display:flex;gap:8px;margin-top:8px"><div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Wins<br><b>${w}</b></div><div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Losses<br><b>${l}</b></div><div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Series<br><b>${sw}${cs>0?` <small>(${cs} streak)</small>`:""}</b></div><div style="flex:1;background:rgba(0,0,0,0.35);padding:10px;border-radius:8px;text-align:center">Win %<br><b>${wp}%</b></div></div></div>`;
  });
  html += `</div>`;
  html += `<h3 style="margin-top:14px">Game History</h3>`;
  html += (gameData.games||[]).slice().reverse().map(g=>`<div style="background:rgba(255,255,255,0.02);padding:10px;margin:8px 0;border-radius:8px"><small style="opacity:.75">${new Date(g.time).toLocaleString()}</small><br><b>${escapeHtml(g.winner)}</b> beat <b>${escapeHtml(g.loser)}</b> <small style="opacity:.7">[Series:${g.seriesId}, target:${g.seriesTarget||5}]</small></div>`).join("") || '<div style="opacity:.75">No games yet</div>';
  html += `<div style="margin-top:12px"><span style="cursor:pointer;color:#dff6f2;text-decoration:underline" onclick="deleteLastGame()">Delete last game</span> &nbsp;•&nbsp; <span style="cursor:pointer;color:#dff6f2;text-decoration:underline" onclick="resetStats()">Reset all statistics</span></div>`;
  statsSection.innerHTML = html;
}

/* ---------- FIRESTORE realtime listen (best-effort) ---------- */
if(gamesRef){
  try{
    const q = query(gamesRef, orderBy("time"));
    onSnapshot(q, snapshot=>{
      const docs = snapshot.docs.map(d=>d.data()).sort((a,b)=> new Date(a.time) - new Date(b.time));
      if(docs && docs.length>0){
        // ensure seriesId presence for docs from cloud
        docs.forEach(d=>{ if(!d.seriesId) d.seriesId = uid("series"); if(!d.time) d.time = new Date().toISOString(); });
        gameData.games = docs;
        saveLocal();
        renderHomeActiveList();
        updateStatsUI();
        console.log("Synced from cloud:", docs.length);
      }
    }, err=>{ console.warn("onSnapshot error", err); });
  }catch(e){ console.warn("onSnapshot failed", e); }
}

/* ---------- Particles (champion aura) ---------- */
function startParticles(){
  const wrap = document.getElementById("champParticles");
  if(!wrap) return;
  wrap.innerHTML = "";
  const count = 14;
  for(let i=0;i<count;i++){
    const el = document.createElement("div");
    const size = 3 + Math.random()*8;
    el.style.position="absolute";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.borderRadius = "50%";
    el.style.left = (10 + Math.random()*(wrap.clientWidth||320)) + "px";
    el.style.top = (10 + Math.random()*40) + "px";
    el.style.background = "rgba(255,200,80," + (0.2 + Math.random()*0.6) + ")";
    el.style.filter = "blur(1px)";
    el.style.transform = "translateY(0)";
    el.style.opacity = 0.95;
    el.style.transition = "transform 6s linear, opacity 6s linear";
    wrap.appendChild(el);
    setTimeout(()=>{ el.style.transform = `translateY(-60px) translateX(${Math.random()*80-40}px)`; el.style.opacity = "0"; }, 80 + Math.random()*400);
  }
  setTimeout(()=>startParticles(),4200);
}
startParticles();

/* ---------- NAV ---------- */
window.goHome = function(){ document.getElementById("statsSection").style.display="none"; renderHomeActiveList(); updateStatsUI(); const hero=document.querySelector(".hero"); if(hero) hero.scrollIntoView({behavior:"smooth"}); };
window.showStats = function(){ document.getElementById("statsSection").style.display="block"; updateStatsUI(); const s=document.getElementById("statsSection"); if(s) s.scrollIntoView({behavior:"smooth"}); };

/* ---------- INIT ---------- */
renderHomeActiveList();
updateStatsUI();
console.log("✅ Bluff Masters app.js loaded. Local data ready; Firebase sync (if available) runs in background.");
