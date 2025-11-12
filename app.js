/* app.js - Final Cloud Sync & Multi-Device Version for Bluff Masters */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  getDocs, deleteDoc, limit, where, updateDoc
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
const SECRET_KEY = "zachariahrenji";
const STORAGE_KEY = "bluff_tracker_v1";
const TEAM_LIST = [
  "Bibin & Zach","Bimal & Annu","Bibin & Annu","Zach & Daddy","Bibin & Bimal","Zach & Rikku","Bibin & Daddy"
];

/* ---------- FIREBASE INIT ---------- */
let db = null, gamesRef = null;
try {
  const app = initializeApp(FIREBASE_CONF);
  db = getFirestore(app);
  gamesRef = collection(db, "games");
  console.log("Firebase initialized");
} catch (e) {
  console.warn("Firebase init failed (offline mode only):", e);
}

/* ---------- LOCAL CACHE ---------- */
let gameData = { games: [] };
(function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) gameData = JSON.parse(raw);
    console.log("Loaded local data:", (gameData.games || []).length, "games");
  } catch (e) { console.warn("Local load failed", e); }
})();
function saveLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameData)); }
  catch (e) { console.warn("Local save failed", e); }
}

/* ---------- HELPERS ---------- */
function uid(p="s"){ return p+"_"+Date.now()+"_"+Math.floor(Math.random()*9000+1000); }
function escapeHtml(s){ return s ? String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]) : ""; }

/* ---------- FIRESTORE PATCH: ensure docs have secret ---------- */
async function patchMissingSecrets() {
  if (!gamesRef) return;
  try {
    const snaps = await getDocs(gamesRef);
    const updates = [];
    snaps.forEach(docSnap=>{
      const d = docSnap.data();
      if (!d.secret) updates.push(updateDoc(docSnap.ref,{ secret: SECRET_KEY }));
    });
    if (updates.length) {
      await Promise.all(updates);
      console.log("Patched", updates.length, "cloud docs with secret.");
    }
  } catch (err) {
    console.warn("patchMissingSecrets skipped:", err);
  }
}

/* ---------- CLOUD SAVE ---------- */
async function cloudSaveGame(rec){
  if(!gamesRef) return;
  try{
    await Promise.race([
      addDoc(gamesRef,{...rec,secret:SECRET_KEY}),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),3000))
    ]);
    console.log("Cloud write OK");
  } catch(e){ console.warn("Cloud save failed:",e); }
}

/* ---------- CLOUD DELETE HELPERS ---------- */
async function cloudDeleteAll(){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const snaps = await getDocs(gamesRef);
  await Promise.all(snaps.docs.map(d=>deleteDoc(d.ref)));
  console.log("Cloud: all data deleted");
}
async function cloudDeleteLast(){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const q=query(gamesRef,orderBy("time","desc"),limit(1));
  const snaps=await getDocs(q);
  await Promise.all(snaps.docs.map(d=>deleteDoc(d.ref)));
  console.log("Cloud: last game deleted");
}
async function cloudDeleteSeries(seriesId){
  if(!gamesRef) return;
  await patchMissingSecrets();
  const q=query(gamesRef,where("seriesId","==",seriesId));
  const snaps=await getDocs(q);
  await Promise.all(snaps.docs.map(d=>deleteDoc(d.ref)));
  console.log("Cloud: series",seriesId,"deleted");
}

/* ---------- FIRESTORE SNAPSHOT SYNC ---------- */
if(gamesRef){
  (async ()=>{
    try {
      await patchMissingSecrets();
      const q=query(gamesRef,orderBy("time"));
      onSnapshot(q, snapshot=>{
        const docs=snapshot.docs.map(d=>d.data()).sort((a,b)=>new Date(a.time)-new Date(b.time));
        const count=docs.length;
        // 🔥 FULL SYNC: replace local cache with Firestore state
        gameData.games = count ? docs : [];
        saveLocal();
        renderHomeActiveList();
        updateStatsUI();
        console.log("Synced from cloud:", count, "records (local cache refreshed).");
      }, err=>console.warn("onSnapshot error",err));
    } catch(e){ console.warn("onSnapshot failed",e); }
  })();
}

/* ---------- LOCAL GAME LOGIC ---------- */
function ensureSeriesIds(){
  let changed=false;
  for(const g of (gameData.games||[])){
    if(!g.seriesId){ g.seriesId=uid("series"); changed=true; }
  }
  if(changed) saveLocal();
}

/* ---------- AGGREGATION & UI RENDER ---------- */
function computeAggregates(){
  ensureSeriesIds();
  const teamStats={},seriesMap={};
  (gameData.games||[]).forEach(g=>{
    const sid=g.seriesId;
    if(!seriesMap[sid]) seriesMap[sid]={id:sid,target:g.seriesTarget||5,games:[],wins:{},finished:false,winner:null};
    const s=seriesMap[sid];
    s.games.push(g);
    s.wins[g.winner]=(s.wins[g.winner]||0)+1;
    if(s.wins[g.winner]>=s.target && !s.finished){ s.finished=true; s.winner=g.winner; }

    if(!teamStats[g.winner]) teamStats[g.winner]={wins:0,losses:0,seriesWon:0,consecutiveSeries:0};
    if(!teamStats[g.loser]) teamStats[g.loser]={wins:0,losses:0,seriesWon:0,consecutiveSeries:0};
    teamStats[g.winner].wins++; teamStats[g.loser].losses++;
  });

  const finishedSeries=Object.values(seriesMap).filter(s=>s.finished);
  const streaks={};
  finishedSeries.forEach(s=>{
    const w=s.winner;
    teamStats[w].seriesWon++;
    streaks[w]=(streaks[w]||0)+1;
    Object.keys(streaks).forEach(t=>{if(t!==w) streaks[t]=0;});
    teamStats[w].consecutiveSeries=streaks[w];
  });

  const activeSeries=Object.values(seriesMap).filter(s=>!s.finished);
  return{teamStats,seriesMap,activeSeries,finishedSeries};
}

function renderHomeActiveList(){
  const {activeSeries}=computeAggregates();
  const box=document.getElementById("activeList");
  if(!box) return;
  box.innerHTML="";
  if(!activeSeries.length){document.getElementById("noActive").style.display="block";return;}
  document.getElementById("noActive").style.display="none";
  activeSeries.forEach(s=>{
    const teams=Array.from(new Set(s.games.flatMap(g=>[g.winner,g.loser]))).slice(0,2);
    const [t1,t2]=teams;
    const s1=s.wins[t1]||0,s2=s.wins[t2]||0;
    const card=document.createElement("div");
    card.className="series-card";
    card.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div><b>${t1}</b> vs <b>${t2}</b></div>
        <div style="display:flex;align-items:center;gap:10px">
          <div><b>${s1}-${s2}</b></div>
          <button class="neu-btn" onclick="resumeSeries('${s.id}')">Add</button>
          <button class="neu-btn secondary" onclick="deleteSeriesConfirm('${s.id}')">🗑️</button>
        </div>
      </div>`;
    box.appendChild(card);
  });
}

/* ---------- DELETE BUTTONS ---------- */
window.resetStats=async()=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  if(!confirm("Delete all stats everywhere?")) return;
  gameData={games:[]}; saveLocal();
  await cloudDeleteAll();
  renderHomeActiveList(); updateStatsUI();
  alert("✅ All stats cleared from all devices.");
};
window.deleteLastGame=async()=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  if(!confirm("Delete last game everywhere?")) return;
  gameData.games.pop(); saveLocal();
  await cloudDeleteLast();
  renderHomeActiveList(); updateStatsUI();
  alert("✅ Last game deleted everywhere.");
};
window.deleteSeriesConfirm=async id=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  if(!confirm("Delete full series everywhere?")) return;
  gameData.games=gameData.games.filter(g=>g.seriesId!==id);
  saveLocal();
  await cloudDeleteSeries(id);
  renderHomeActiveList(); updateStatsUI();
  alert("✅ Series deleted everywhere.");
};

/* ---------- PLACEHOLDER (UI/Stats functions already in HTML) ---------- */
window.resumeSeries=()=>alert("Function connected. (existing logic remains)");
window.showStats=()=>alert("Function connected. (existing logic remains)");
window.goHome=()=>alert("Function connected. (existing logic remains)");

/* ---------- INIT ---------- */
renderHomeActiveList();
updateStatsUI();
console.log("✅ Bluff Masters (multi-device) app.js loaded.");
