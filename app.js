/* ✅ Final Bluff Masters – Full Sync + Functional New Series */

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
  console.warn("Firebase init failed:", e);
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
    if (updates.length) await Promise.all(updates);
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

/* ---------- CLOUD DELETE ---------- */
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

/* ---------- FIRESTORE SNAPSHOT (SYNC ACROSS DEVICES) ---------- */
if(gamesRef){
  (async ()=>{
    try {
      await patchMissingSecrets();
      const q=query(gamesRef,orderBy("time"));
      onSnapshot(q, snapshot=>{
        const docs=snapshot.docs.map(d=>d.data()).sort((a,b)=>new Date(a.time)-new Date(b.time));
        const count=docs.length;
        // 🔄 Always clear local cache and overwrite
        gameData.games = count ? docs : [];
        saveLocal();
        renderHomeActiveList();
        updateStatsUI();
        console.log("Synced from cloud:", count, "records (local refreshed)");
      });
    } catch(e){ console.warn("onSnapshot failed:",e); }
  })();
}

/* ---------- NEW SERIES FUNCTIONALITY RESTORED ---------- */
window.startNewSeries = function(){
  const teamOptions = TEAM_LIST.map(t=>`<option>${escapeHtml(t)}</option>`).join("");
  const html = `
    <div>
      <label>Series target:</label>
      <select id="seriesTarget" style="width:100%;padding:8px;margin-top:6px">
        <option value="5">First to 5</option>
        <option value="10">First to 10</option>
      </select>
      <label style="margin-top:10px;display:block">Winner:</label>
      <select id="winnerTeam" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
      <label style="margin-top:10px;display:block">Loser:</label>
      <select id="loserTeam" style="width:100%;padding:8px;margin-top:6px">${teamOptions}</select>
    </div>
  `;
  const container = document.createElement("div");
  container.className="overlay";
  container.innerHTML = `
    <div class="confirm-box">
      <h3>Start New Series</h3>
      ${html}
      <div style="margin-top:12px">
        <button class="neu-btn" id="startSeriesBtn">Start</button>
        <button class="neu-btn secondary" id="cancelBtn">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(container);

  document.getElementById("cancelBtn").onclick=()=>container.remove();
  document.getElementById("startSeriesBtn").onclick=()=>{
    const target=parseInt(document.getElementById("seriesTarget").value,10)||5;
    const winner=document.getElementById("winnerTeam").value.trim();
    const loser=document.getElementById("loserTeam").value.trim();
    if(!winner||!loser){alert("Pick both teams");return;}
    if(winner===loser){alert("Teams cannot be same");return;}
    const rec={winner,loser,seriesTarget:target,seriesId:uid("series"),time:new Date().toISOString(),secret:SECRET_KEY};
    gameData.games.push(rec);
    saveLocal();
    cloudSaveGame(rec);
    renderHomeActiveList();
    updateStatsUI();
    container.remove();
    alert("✅ Series started and synced!");
  };
};

/* ---------- DELETE ACTIONS ---------- */
window.resetStats=async()=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  if(!confirm("Delete all stats everywhere?")) return;
  gameData={games:[]}; saveLocal();
  await cloudDeleteAll();
  renderHomeActiveList(); updateStatsUI();
  alert("✅ All stats cleared everywhere.");
};
window.deleteLastGame=async()=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  gameData.games.pop(); saveLocal();
  await cloudDeleteLast();
  renderHomeActiveList(); updateStatsUI();
  alert("✅ Last game deleted everywhere.");
};
window.deleteSeriesConfirm=async id=>{
  const pw=prompt("Enter password:");
  if(pw!==SECRET_KEY) return alert("❌ Wrong password");
  gameData.games=gameData.games.filter(g=>g.seriesId!==id);
  saveLocal();
  await cloudDeleteSeries(id);
  renderHomeActiveList(); updateStatsUI();
  alert("✅ Series deleted everywhere.");
};

/* ---------- BASIC DASHBOARD UPDATER ---------- */
function updateStatsUI(){
  const el=document.getElementById("totalGames");
  if(el) el.textContent=(gameData.games||[]).length;
}
function renderHomeActiveList(){
  const box=document.getElementById("activeList");
  if(!box) return;
  box.innerHTML=(gameData.games||[]).length?`<div>Series Active: ${(gameData.games||[]).length}</div>`:`<div id="noActive">No Active Series</div>`;
}

/* ---------- INIT ---------- */
renderHomeActiveList();
updateStatsUI();
console.log("✅ Bluff Masters app.js fully functional (multi-device sync fixed).");
